const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");

function load({ stored = {}, session, setSessionResult }) {
  const store = new Map(Object.entries({ lpt_account_salvati: JSON.stringify(stored) }));
  const calls = [];
  let current = session;
  const supabase = { auth: {
    storageKey: "sb-x-auth-token",
    getSession: async () => ({ data: { session: current } }),
    onAuthStateChange: () => {},
    setSession: async (tokens) => { calls.push(tokens); const r = setSessionResult(tokens); if (r.data?.session) current = r.data.session; return r; },
  } };
  const replaced = [];
  const ctx = vm.createContext({
    supabase, destinationFor: (p) => (p.role === "coach" ? "coach.html" : "athlete.html"),
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k), [Symbol.iterator]: null },
    sessionStorage: { removeItem() {} }, window: { LIPPOLIS_SUPABASE_CONFIG: { url: "https://x.supabase.co" } },
    location: { href: "https://app.test/coach.html", replace: (u) => replaced.push(u) }, URL, Date, JSON, Object, Error, String,
  });
  const src = read("www/src/account-switch.mjs").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  vm.runInContext(src + "\nthis.api={savedAccounts,switchToAccount,rememberAccount,forgetAccount,otherSavedAccounts};", ctx);
  return { api: ctx.api, store, calls, replaced };
}

const sess = (uid, n) => ({ user: { id: uid, email: uid + "@x.it" }, access_token: "a" + n, refresh_token: "r" + n });

test("cambia account: salva l'ultimo accesso di quello aperto e apre l'area giusta dell'altro", async () => {
  const stored = {
    coach: { uid: "coach", name: "Vittorio PT", role: "coach", email: "c@x.it", access_token: "a0", refresh_token: "r0" },
    me: { uid: "me", name: "Vittorio", role: "athlete", email: "v@x.it", access_token: "b0", refresh_token: "s0" },
  };
  const { api, store, calls, replaced } = load({ stored, session: sess("coach", 5), setSessionResult: (t) => ({ data: { session: { ...sess("me", 9) } }, error: null }) });
  let left = false;
  assert.equal(await api.switchToAccount("me", { beforeLeave: async () => (left = true) }), true);
  assert.equal(left, true);
  assert.deepEqual({ ...calls[0] }, { access_token: "b0", refresh_token: "s0" });
  const saved = JSON.parse(store.get("lpt_account_salvati"));
  assert.equal(saved.coach.refresh_token, "r5", "il PT riparte dall'accesso più recente, non da quello vecchio");
  assert.equal(saved.me.refresh_token, "r9");
  assert.equal(replaced[0], "https://app.test/athlete.html");
  assert.deepEqual(api.otherSavedAccounts("me").map((a) => a.uid), ["coach"]);
});

test("cambia account: se il salvataggio dei dati non riesce si resta dove si è", async () => {
  const stored = { me: { uid: "me", name: "V", role: "athlete", email: "v", access_token: "b0", refresh_token: "s0" } };
  const { api, calls, replaced } = load({ stored, session: sess("coach", 1), setSessionResult: () => ({ data: {}, error: null }) });
  assert.equal(await api.switchToAccount("me", { beforeLeave: async () => false }), false);
  assert.equal(calls.length, 0); assert.equal(replaced.length, 0);
});

test("cambia account: accesso scaduto → tolto dai salvati e si torna all'account di prima", async () => {
  const stored = { me: { uid: "me", name: "Vittorio", role: "athlete", email: "v", access_token: "b0", refresh_token: "s0" } };
  const { api, store, calls } = load({ stored, session: sess("coach", 3), setSessionResult: (t) => (t.refresh_token === "s0" ? { data: { session: null }, error: new Error("expired") } : { data: { session: sess("coach", 3) }, error: null }) });
  await assert.rejects(api.switchToAccount("me"), /scaduto/);
  assert.equal(calls[1].refresh_token, "r3");
  assert.deepEqual(JSON.parse(store.get("lpt_account_salvati")), {});
});

test("il tasto c'è nell'app e nel pannello, «Esci» toglie solo l'account aperto, il cambio non fa signOut", () => {
  const sw = read("www/src/account-switch.mjs");
  assert.doesNotMatch(sw.replace(/\/\/.*$/gm, ""), /signOut\(/);
  assert.match(read("www/athlete.html"), /id="accountSwitch"[^>]*hidden/);
  assert.match(read("www/coach.html"), /id="coachSwitch"[^>]*hidden/);
  assert.match(read("www/src/auth.mjs"), /lpt_account_salvati/);
  assert.match(read("www/index.html"), /id="savedAccounts"/);
  assert.match(read("www/src/athlete.mjs"), /syncBeforeLeave\(user\.uid, "cambiare account"\)/);
});
