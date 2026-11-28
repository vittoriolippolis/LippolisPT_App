const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const editor = import("../www/src/coach-mockup-model.mjs");
const runtime = import("../www/src/workout-metrics.mjs");
const dates = { dal: "2026-11-13", al: "2026-11-19" };
const exercise = { nome: "Squat", serie: "3", rip: "8-10", rec: "01:30", rir: "2", carico: "40", note: "Pausa in basso" };
const template = (...esercizi) => ({
  nome: "Full body",
  weeks: [{ nome: "Settimana 1", giorni: [{ nome: "Gambe", giorno: "1", esercizi }] }]
});

test("la home PT integra il calendario e mantiene la scheda cliente e i due editor", () => {
  const html = fs.readFileSync(path.join(__dirname, "../www/coach.html"), "utf8");
  for (const tile of ["priorita", "clienti", "workout", "nutrizione"]) {
    assert.match(html, new RegExp(`id:'${tile}'`));
  }
  assert.doesNotMatch(html, /id:'(?:revisione|abbonamenti|agenda|impostazioni)'/);
  assert.match(html, /id="coachSettings"/);
  assert.match(html, /id="pdDelete".*Elimina giornata/);
  assert.match(html, /id="homeCalendar"/);
  assert.match(html, /id="calAdd"/);
  for (const field of ["copyWk", "addWk", "addDay", "assignMockProgram", "assignPiano", "savePianoDraft", "pdDelete", "impBtn", "impPiano", "addEx"]) {
    assert.match(html, new RegExp(`id="${field}"`));
  }
  assert.match(html, /coach-mockup\.mjs/);
  assert.doesNotMatch(html, /Salvataggio automatico \(localStorage\)|142 clienti|800 programmi/);
});

test("l'importazione Excel rifiuta settimane fuori limite e fogli senza esercizi", () => {
  const html = fs.readFileSync(path.join(__dirname, "../www/coach.html"), "utf8");
  const source = html.slice(html.indexOf("  function _norm(v)"), html.indexOf("  function applyScheda(res)"));
  const { parseSchedaRows } = vm.runInNewContext(source + "\n({parseSchedaRows})");
  const headings = ["Nome_Programma", "Numero_Settimane", "Giorno_Numero", "Nome_Esercizio", "Serie"];
  assert.throws(() => parseSchedaRows([headings, ["Test", 1000000, 1, "Squat", 3]]), /tra 1 e 52|compreso tra 1 e 52/);
  assert.throws(() => parseSchedaRows([headings, ["Test", 2, 1, "", 3]]), /nessun esercizio/);
  assert.equal(parseSchedaRows([headings, ["Test", 2, 1, "Squat", 3]]).weeks.length, 2);
});

test("salva e rilegge prescrizioni, istruzioni, video privato e superserie", async () => {
  const { mockupToProgram, programToMockup } = await editor;
  const { toAthleteProgram } = await runtime;
  const { validateProgram } = await import("../supabase/functions/_shared/validation.mjs");
  const program = mockupToProgram(template(exercise, {
    ...exercise, nome: "Affondi", link: "superserie", videoStoragePath: "coach/video.mp4", descrizione: "Controlla l’appoggio", note: "Alterna i lati"
  }), dates);
  const published = validateProgram(JSON.parse(JSON.stringify(program)), { forPublish: true });
  const day = toAthleteProgram(published).settimane[0].giorni[0];
  assert.equal(day.esercizi[0].rec, "90");
  assert.equal(day.esercizi[0].prescriptions[0].load_value, 40);
  assert.equal(day.esercizi[0].prescriptions[0].target_rir, 2);
  assert.equal(day.esercizi[0].ss, day.esercizi[1].ss);
  assert.equal(day.esercizi[1].videoStoragePath, "coach/video.mp4");
  assert.equal(day.esercizi[1].instructions, "Controlla l’appoggio");
  assert.equal(day.esercizi[0].note, "Pausa in basso");
  assert.equal(day.esercizi[1].note, "Alterna i lati\nControlla l’appoggio");
  const reopened = programToMockup(published).weeks[0].giorni[0].esercizi;
  assert.equal(reopened[1].link, "superserie");
  assert.equal(reopened[1].note, "Alterna i lati");
  assert.equal(reopened[0].carico, "40");
  assert.equal(reopened[0].rip, "8-10");
});

test("lo storico PT legge pesate e serie eseguite anche da salvataggi precedenti", async () => {
  const { athleteWeightHistory } = await editor;
  const ts = Date.parse("2026-11-13T12:00:00Z");
  const history = athleteWeightHistory({
    pesi: [{ ts: "2026-11-10", v: "81,4" }, { ts, v: 80.2 }, { ts, v: "" }, { ts: "errato", v: 88 }],
    sessioni: [
      { ts, titolo: "Seduta A", esercizi: [
        { nome: "Affondi", perLato: true, lati: ["SX", "DX"], sets: [{ kg: 10, reps: 8 }, { slot: 3, kg: "12,5", reps: 7, rir: 0 }] },
        { nome: "Plank", unita: "sec", sets: [{ kg: 0, reps: 30 }] },
        { nome: "Vuoto", sets: [{ kg: "", reps: null }] }
      ] },
      { ts: "2026-11-10", titolo: "Seduta B", esercizi: [{ nome: " affondi ", perLato: true, sets: [{ kg: 8, reps: 9 }] }] }
    ]
  });
  assert.deepEqual(history.weighIns.map(item => item.v), [80.2, 81.4]);
  assert.deepEqual(history.exercises.map(item => item.name), ["Affondi", "Plank"]);
  assert.deepEqual(history.exercises[0].entries.map(entry => entry.title), ["Seduta A", "Seduta B"]);
  assert.deepEqual(history.exercises[0].entries[0].sets[1], { series: "2 DX", kg: 12.5, reps: 7, rir: 0 });
  assert.equal(history.exercises[1].unit, "sec");
  assert.equal(history.exercises[1].entries[0].sets[0].kg, 0);
  assert.deepEqual(athleteWeightHistory(), { weighIns: [], exercises: [] });
});

test("l'importazione a tempo registra secondi e l'editor blocca le prescrizioni incomplete", async () => {
  const { mockupToProgram } = await editor;
  const { toAthleteProgram } = await runtime;
  const program = mockupToProgram(template({ ...exercise, tipo: "tempo", rip: "01:20", carico: "PC" }), dates);
  const timed = toAthleteProgram(program).settimane[0].giorni[0].esercizi[0];
  assert.equal(timed.unita, "sec");
  assert.equal(timed.prescriptions[0].reps_min, 80);
  assert.throws(() => mockupToProgram(template({ ...exercise, serie: "" }), dates), /numero di serie/);
  assert.throws(() => mockupToProgram(template({ ...exercise, video: "http://example.test/video.mp4" }), dates), /Video non valido/);
});

test("Workout e Consigli nutrizionali hanno il tasto Elimina in elenco e nell'editor", () => {
  const html = fs.readFileSync(path.join(__dirname, "../www/coach.html"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "../www/src/coach-mockup.mjs"), "utf8");
  assert.match(html, /bindRows\(el,f,openProgramma,deleteProgramma\)/);
  assert.match(html, /bindRows\(el,f,openPiano,deletePiano\)/);
  assert.match(html, /id="deleteMockProgram"/);
  assert.match(html, /id="deletePiano"/);
  assert.match(js, /window\.CoachDB=\{[^}]*deleteProgram,deleteMealPlan/);
  assert.match(js, /archiveProgramDraft",\{draftId:p\._remote\.id\}/);
  assert.match(js, /function fromStoredProgram/);
  assert.match(js, /async function syncWorkspace/);
  assert.match(js, /result\.error\?\.code==="PT409"/);
});

test("le programmazioni importate dal PC (formato app) si aprono nell'editor", async () => {
  const { programToMockup } = await editor;
  const program = { nome: "Scheda standard", dal: "2026-11-16", al: "2026-11-22", settimane: [{ n: 1, dal: "2026-11-16", al: "2026-11-22", fase: "",
    giorni: [{ dn: "Lunedì", dt: "A", titolo: "Gambe", min: 50, esercizi: [{ badge: "A", nome: "Squat", serie: 3, reps: "8-10 per gamba", rir: 2, rec: "1:30", carico: "", step: 2.5, note: "" }] }] }] };
  const m = programToMockup(program, "id1");
  assert.equal(m.nome, "Scheda standard");
  assert.equal(m.weeks[0].giorni[0].esercizi[0].nome, "Squat");
  assert.equal(m.weeks[0].giorni[0].esercizi[0].serie, "3");
});

test("nella scheda cliente i consigli alimentari si aprono e si tolgono", () => {
  const js = fs.readFileSync(path.join(__dirname, "../www/src/coach-mockup.mjs"), "utf8");
  assert.match(js, /id="mockRemoveClientPlan"/);
  assert.match(js, /\$\("mockOpenClientPlan"\)\.onclick/);
  assert.match(js, /await saveSection\(c,"nutrition",\{\}\)/);
});

test("app cliente: notifiche richiudibili, carichi giù in rosso, esercizi chiusi ricordati, Coach solo chat", () => {
  const html = fs.readFileSync(path.join(__dirname, "../www/athlete.html"), "utf8");
  assert.match(html, /<details class="pf-fold" id="athleteAlertFold">/);
  assert.match(html, /\.sg\.down\{background:rgba\(var\(--sg-down-rgb\)/);
  assert.match(html, /st\.aperta\?' open':''/);
  assert.doesNotMatch(html, /id="coUrg"/);
  assert.doesNotMatch(html, /id="coDif"/);
});

test("nomi lunghi a capo, Togli serie, Concludi allenamento in fondo", () => {
  const html = fs.readFileSync(path.join(__dirname, "../www/athlete.html"), "utf8");
  const coach = fs.readFileSync(path.join(__dirname, "../www/coach.html"), "utf8");
  assert.match(coach, /\.row-t\{display:block;[^}]*white-space:normal; overflow-wrap:anywhere;\}/);
  assert.match(html, /class="del-set-btn"/);
  assert.match(html, /function slotCount\(ex, st\)/);
  assert.match(html, /\.session-action\{position:static;/);
});

test("bayesian curl unilaterale di predefinito, a due braccia se scritto nella nota", () => {
  const html = fs.readFileSync(path.join(__dirname, "../www/athlete.html"), "utf8");
  const uni = new RegExp(html.match(/const RX_UNILAT=\/(.+?)\/i;/)[1], "i");
  const bil = new RegExp(html.match(/const RX_BILAT=\/(.+?)\/i;/)[1], "i");
  assert.ok(uni.test("Bayesian curl"));
  assert.ok(bil.test("A due braccia, spremi in cima"));
  assert.ok(!bil.test("tieni le braccia vicine"));
  assert.match(html, /if\(RX_BILAT\.test\(String\(ex\.reps\|\|''\)\)\|\|RX_BILAT\.test\(ex\.note\|\|''\)\) return false;/);
});

test("niente spiegazioni, storico sessioni a tabelle, foto clienti e sfondo colorato", () => {
  const read = f => fs.readFileSync(path.join(__dirname, "..", "www", f), "utf8");
  const athlete = read("athlete.html"), coach = read("coach.html"), mock = read("src/coach-mockup.mjs");
  assert.doesNotMatch(athlete, /saranno aggiunti allo storico al salvataggio/);
  assert.doesNotMatch(athlete, /volume Sveglia/);
  assert.doesNotMatch(athlete, /sono visibili al tuo PT/);
  assert.doesNotMatch(mock, /Rubrica dei collaboratori/);
  assert.match(athlete, /<div class="ses-ex"><div class="n">\$\{esc\(ex\.nome\)\}<\/div>\$\{tab\}/);
  assert.match(athlete, /<table class="sc-table">/);
  assert.match(coach, /\.weight-table th\{background:var\(--accent\)/);
  assert.match(coach, /data-avatar="'\+escapeHTML\(c\.id\|\|''\)\+'"/);
  assert.match(mock, /snapshot->profilo->>foto/);
  assert.match(mock, /PHOTO_RX=\/\^data:image/);
  // 28/11/2026: la foto della palestra resta solo nella pagina di accesso.
  assert.doesNotMatch(coach, /sfondo\.jpg/);
  assert.doesNotMatch(athlete, /sfondo\.jpg/);
  assert.match(read("index.html"), /url\("sfondo\.jpg"\)/);
  assert.ok(fs.existsSync(path.join(__dirname, "..", "www", "sfondo.jpg")));
});

test("esercizi a tempo: timer della serie con preparazione, recupero automatico e ±15s", () => {
  const athlete = fs.readFileSync(path.join(__dirname, "..", "www", "athlete.html"), "utf8");
  assert.match(athlete, /class="tg set-work" data-work="\$\{workSec\}"/);
  assert.match(athlete, /const PREPARA=5;/);
  assert.match(athlete, /startTimer\(rest,'Recupero · '\+label\)/);
  assert.match(athlete, /id="tbMinus"[^>]*>−15s<\/button><button class="tb-b" id="tbPlus"/);
  assert.match(athlete, /function subTime\(n\)/);
  const secondiTarget = new Function("toSec", athlete.slice(athlete.indexOf("  function secondiTarget("), athlete.indexOf("  function scriviSecondi(")) + "return secondiTarget;")(t => { const p = String(t).split(":").map(Number); return p[0] * 60 + p[1]; });
  assert.equal(secondiTarget("40"), 40);
  assert.equal(secondiTarget("30-45"), 45);
  assert.equal(secondiTarget("1:30"), 90);
  assert.equal(secondiTarget("2 min"), 120);
  assert.equal(secondiTarget(""), 0);
});
