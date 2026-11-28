const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const athleteModule = fs.readFileSync(path.join(root, "www/src/athlete.mjs"), "utf8");
const athletePage = fs.readFileSync(path.join(root, "www/athlete.html"), "utf8");
const program = (name) => ({ nome: name, settimane: [{ n: 1, giorni: [] }] });
const initialSnapshot = () => ({ v: 1, salvato: 1, profilo: { nome: "Ari", cognome: "Rossi" }, bia: [], sessioni: [], pesi: [], progressi: [], giornate: {}, statoSett: {}, noteSessione: {} });

async function startAthlete({ onSave, getState, getProgram } = {}) {
  let snapshot = { ...initialSnapshot(), PROGRAMMA: program("Originale"), versioneSchedaLocale: "version-1" };
  const timers = new Map();
  const subscriptions = new Map();
  const subscriptionStatuses = new Map();
  const rpcCalls = [];
  const applied = [];
  const alerts = [];
  let flushPendingSave = () => {};
  let timerId = 0;
  let watchedNutrition = null;
  const ok = (data) => ({ data, error: null });
  const remoteState = () => getState ? getState() : { revision: 1, snapshot: initialSnapshot() };
  const remoteProgram = () => getProgram ? getProgram() : { version_id: "version-1", program: program("Originale") };
  const sessionStorage = new Map([["lippolis_uid", "athlete-1"]]);
  const window = {
    addEventListener() {},
    lippolisAthleteApi: {
      storageKey: "athlete-1",
      snapshot: () => structuredClone(snapshot),
      applySnapshot(value) {
        snapshot = { ...snapshot, ...structuredClone(value) };
        applied.push(structuredClone(value));
      },
      applyMessages() {},
      applyNutrition(value) { watchedNutrition = value; },
      flushPendingSave() { flushPendingSave(); }
    }
  };
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "token" } }, error: null }),
      onAuthStateChange() {}
    },
    from(table) {
      return {
        select() { return this; }, eq() { return this; }, order() { return this; },
        maybeSingle: async () => ok(table === "athlete_states" ? remoteState() : remoteProgram()),
        limit: async () => ok([])
      };
    },
    channel() {
      let table;
      return {
        on(_name, filter, handler) { table = filter.table; subscriptions.set(table, handler); return this; },
        subscribe(handler) { subscriptionStatuses.set(table, handler); return this; }
      };
    },
    async rpc(_name, args) {
      if (_name === "athlete_app_settings") return { data: {}, error: null };
      rpcCalls.push(structuredClone(args));
      return onSave ? onSave(rpcCalls.length, args) : ok(args.p_expected_revision + 1);
    }
  };
  const context = vm.createContext({
    window, supabase, supabaseConfigured: true, structuredClone, preparaTecniche: (program) => program,
    document: { getElementById: () => null, addEventListener() {} },
    localStorage: { getItem: () => JSON.stringify(snapshot) },
    sessionStorage: { getItem: (key) => sessionStorage.get(key), setItem: (key, value) => sessionStorage.set(key, value) },
    getAuthorizedSession: async () => ({ user: { uid: "athlete-1" }, profile: { firstName: "Ari", lastName: "Rossi" } }),
    watchAthleteNutrition(uid, callback) { callback({ state: "ready", plan: { uid } }); return () => {}; },
    createNotifications: () => ({ mount() {}, notify() {} }),
    markChatRead() {},
    rememberAccount: async () => {}, otherSavedAccounts: () => [], openAccountMenu() {},
    friendlyAuthError: (error) => error.message,
    alert: (message) => alerts.push(message),
    location: { replace: (value) => alerts.push(value) },
    setTimeout(handler) { timers.set(++timerId, handler); return timerId; },
    clearTimeout(id) { timers.delete(id); }
  });
  const source = athleteModule.replace(/^import .*;\r?\n/gm, "");
  await vm.runInContext(`(async () => {\n${source}\n})();`, context, { filename: "athlete.mjs" });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  await settle();
  assert.deepEqual(alerts, []);
  assert.deepEqual(rpcCalls, []);
  function write(draft) {
    snapshot = { ...snapshot, ...structuredClone(draft) };
    window.lippolisCloudSync.queue(snapshot);
  }
  return {
    applied, rpcCalls, window, settle, snapshot: () => snapshot,
    nutrition: () => watchedNutrition,
    write,
    stage(draft) { flushPendingSave = () => { flushPendingSave = () => {}; write(draft); }; },
    async runScheduledSave() {
      const scheduled = [...timers.values()];
      timers.clear();
      for (const handler of scheduled) handler();
      await settle();
    },
    emit(table, value) { return subscriptions.get(table)({ eventType: "UPDATE", new: value }); },
    async reconnect(table) { subscriptionStatuses.get(table)("SUBSCRIBED"); await settle(); }
  };
}

test("una scheda pubblicata attende il salvataggio delle serie e appare senza ricaricare", async () => {
  assert.doesNotMatch(athleteModule, /location\.reload\s*\(/);
  assert.match(athletePage, /applySnapshot:\s*\(value\)=>/);
  assert.match(athletePage, /switchAccount:\s*\(uid\)=>/);
  const athlete = await startAthlete();
  athlete.stage({ salvato: 2, statoSett: { 0: { 0: { 0: { sets: [{ kg: "40", reps: "8" }] } } } } });
  await athlete.emit("programs", { version_id: "version-2", program: program("Nuova scheda") });
  assert.equal(athlete.snapshot().PROGRAMMA.nome, "Originale");
  await athlete.runScheduledSave();
  assert.equal(athlete.rpcCalls[0].p_snapshot.statoSett[0][0][0].sets[0].kg, "40");
  assert.equal("versioneSchedaLocale" in athlete.rpcCalls[0].p_snapshot, false);
  assert.equal(athlete.snapshot().PROGRAMMA.nome, "Nuova scheda");
  assert.equal(athlete.window.__LIPPOLIS_PROGRAM_VERSION__, "version-2");
  assert.equal(athlete.nutrition().plan.uid, "athlete-1");
});

test("lo storico atleta mostra i nomi come testo e tratta le serie malformate come mancanti", () => {
  const source = (start, end) => athletePage.slice(athletePage.indexOf(start), athletePage.indexOf(end));
  const name = '<img src=x onerror="window.test=true">';
  const view = { innerHTML: "", querySelectorAll: () => [] };
  const context = vm.createContext({
    view, I: { chevL: "", chevR: "" }, sessioni: [{ titolo: name, settimana: name, ts: 1, esercizi: [{ nome: name, sets: [{ kg: 15, reps: name }] }] }],
    altroStoricoEx: null, ultimiPesi: { [name]: {} }, infoEsercizio: () => ({}), fmtDataAnno: () => "13 nov",
    fmtKgIt: value => String(value), document: { getElementById: () => ({}) }
  });
  vm.runInContext([
    source("  function titoloGiorno(", "  function card("),
    source("  function valoreSerie(", "  function leggiSerie("),
    source("  function savedSetLabel(", "  function storicoSessionsHTML("),
    source("  function esc(v)", "  const biaDateFormat"),
    source("  let storicoVista=", "  // ====== TIMER (recupero")
  ].join("\n"), context);
  vm.runInContext("renderStoricoPesi()", context);
  assert.match(view.innerHTML, /&lt;img/);
  assert.doesNotMatch(view.innerHTML, /<img/);
  vm.runInContext("storicoVista='sessioni'; renderStoricoPesi()", context);
  assert.match(view.innerHTML, /<td>15 kg<\/td><td>—<\/td>/);
  assert.doesNotMatch(view.innerHTML, /<img/);
});

test("un salvataggio fallito non sovrascrive le modifiche fatte mentre era in corso", async () => {
  let finishFirstSave;
  const athlete = await startAthlete({ onSave: (count, args) => count === 1
    ? new Promise((resolve) => { finishFirstSave = resolve; })
    : { data: args.p_expected_revision + 1, error: null } });
  athlete.write({ salvato: 2, noteSessione: { "0-0": "Prima modifica" } });
  await athlete.runScheduledSave();
  athlete.write({ salvato: 3, noteSessione: { "0-0": "Ultima modifica" } });
  finishFirstSave({ data: null, error: { code: "NETWORK", message: "Connessione interrotta" } });
  await athlete.settle();
  await athlete.runScheduledSave();
  assert.equal(athlete.rpcCalls.length, 2);
  assert.equal(athlete.rpcCalls[1].p_snapshot.noteSessione["0-0"], "Ultima modifica");
  assert.equal(athlete.rpcCalls[1].p_snapshot.salvato, 3);
});

test("dopo un conflitto il dispositivo mostra anche la cronologia ricevuta dal server", async () => {
  let state = { revision: 1, snapshot: initialSnapshot() };
  const athlete = await startAthlete({
    getState: () => state,
    onSave: (count, args) => count === 1
      ? { data: null, error: { code: "PT409", message: "STATE_CONFLICT" } }
      : { data: args.p_expected_revision + 1, error: null }
  });
  state = { revision: 2, snapshot: { ...initialSnapshot(), salvato: 2, bia: [{ id: "bia-from-coach", measuredAt: "2026-11-12", weightKg: 80 }] } };
  athlete.write({ salvato: 3, noteSessione: { "0-0": "Seduta in corso" } });
  await athlete.runScheduledSave();
  assert.equal(athlete.rpcCalls[1].p_expected_revision, 2);
  assert.equal(athlete.rpcCalls[1].p_snapshot.bia[0].id, "bia-from-coach");
  assert.equal(athlete.snapshot().bia[0].id, "bia-from-coach");
  assert.equal(athlete.snapshot().noteSessione["0-0"], "Seduta in corso");
});

test("la correzione e la rimozione BIA del PT prevalgono sulla copia offline", async () => {
  const report = { id: "bia-1", measuredAt: "2026-11-12", weightKg: 80 };
  let state = { revision: 1, snapshot: { ...initialSnapshot(), bia: [report] } };
  const athlete = await startAthlete({ getState: () => state });
  state = { revision: 2, snapshot: { ...state.snapshot, bia: [{ ...report, weightKg: 81 }] } };
  await athlete.emit("athlete_states", state);
  assert.equal(athlete.snapshot().bia[0].weightKg, 81);
  athlete.write({ bia: [report], noteSessione: { "0-0": "Seduta in corso" } });
  state = { revision: 3, snapshot: { ...state.snapshot, bia: [] } };
  await athlete.emit("athlete_states", state);
  await athlete.runScheduledSave();
  assert.equal(athlete.rpcCalls.at(-1).p_snapshot.bia.length, 0);
  assert.equal(athlete.snapshot().bia.length, 0);
  assert.equal(athlete.snapshot().noteSessione["0-0"], "Seduta in corso");
});

test("alla riconnessione rileva le pubblicazioni e le rimozioni avvenute offline", async () => {
  let latestProgram = { version_id: "version-1", program: program("Originale") };
  const athlete = await startAthlete({ getProgram: () => latestProgram });
  latestProgram = { version_id: "version-2", program: program("Pubblicata offline") };
  await athlete.reconnect("programs");
  assert.equal(athlete.snapshot().PROGRAMMA.nome, "Pubblicata offline");
  latestProgram = null;
  await athlete.reconnect("programs");
  assert.equal(athlete.snapshot().PROGRAMMA, null);
  assert.equal(athlete.window.__LIPPOLIS_PROGRAM_VERSION__, "");
});
