const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const tecniche = import("../www/src/tecniche.mjs");
const editor = import("../www/src/coach-mockup-model.mjs");
const runtime = import("../www/src/workout-metrics.mjs");
const dates = { dal: "2026-11-30", al: "2026-12-06" };
const tipo = (list) => (list || []).map((x) => x && x.t);

test("le frasi standard del Metodo nella nota diventano tecniche sull'ultima serie", async () => {
  const { tecnicheDaNota, etichettaTecnica } = await tecniche;
  const strip = tecnicheDaNota("Quattro serie da 10-12. ULTIMA SERIE - stripping: arrivato a cedimento scala il carico del 20% e chiudi altre reps, poi scala ancora e chiudi di nuovo a cedimento.", 4);
  assert.deepEqual(tipo(strip), [null, null, null, "stripping"]);
  assert.equal(strip[3].blocchi, 2);
  assert.equal(strip[3].calo, 20);
  assert.equal(etichettaTecnica(strip[3]), "Stripping · 2 scarichi −20%");

  const drop = tecnicheDaNota('ULTIMA SERIE - drop set: spara quanti più colpi possibili, recupera 20" e con lo stesso carico chiudi altre reps.', 3);
  assert.deepEqual(tipo(drop), [null, null, "drop"]);
  assert.deepEqual([drop[2].blocchi, drop[2].pausa], [1, 20]);

  const inter = tecnicheDaNota('ULTIMA SERIE - serie interrotte: con un carico da 8 reps esegui 5 ripetizioni, recupera 20", altre 5, recupera 20" e chiudi le ultime 5 a fatica.', 3);
  assert.deepEqual([inter[2].t, inter[2].blocchi, inter[2].reps, inter[2].pausa], ["interrotte", 2, 5, 20]);

  const rp = tecnicheDaNota('ULTIMA SERIE - rest-pause: arriva a cedimento, recupera 15" e strappa qualche altra ripetizione, ripeti per due volte.', 2);
  assert.deepEqual([rp[1].t, rp[1].blocchi, rp[1].pausa], ["rest_pause", 2, 15]);

  assert.deepEqual(tipo(tecnicheDaNota("Top set e bake off. Nel top set punta al massimo.", 3)), ["top", "bake_off", "bake_off"]);
  assert.deepEqual(tipo(tecnicheDaNota("ULTIME DUE SERIE - rest-pause, recupera 10\" per due volte.", 4)), [null, null, "rest_pause", "rest_pause"]);
  assert.equal(tecnicheDaNota("Prima serie con il carico della volta scorsa. Nella seconda aumenta il peso.", 4), null);
  assert.equal(tecnicheDaNota("Non fare lo stripping questa settimana.", 4), null);
});

test("i passi della catena: pause col timer e blocchi; lo stripping scala del 20% ai dischi da 1,25", async () => {
  const { passiTecnica, caricoScalato } = await tecniche;
  assert.deepEqual(passiTecnica({ t: "rest_pause" }).map((p) => p.tipo), ["pausa", "blocco", "pausa", "blocco"]);
  assert.deepEqual(passiTecnica({ t: "stripping" }).map((p) => p.tipo), ["blocco", "blocco"]);
  assert.equal(passiTecnica({ t: "top" }).length, 0);
  assert.equal(caricoScalato(40, 20), 31.25);
  assert.equal(caricoScalato("32,5", 20), 25);
  assert.equal(caricoScalato(0, 20), null);
});

test("stesso esercizio nello stesso gruppo = multiserie; ogni riga ha la sua chiave di progressione", async () => {
  const { preparaTecniche } = await tecniche;
  const program = { settimane: [{ giorni: [{ esercizi: [
    { nome: "Affondo inverso con ginocchio alto", serie: 1, reps: "20", rec: "20", ss: "A" },
    { nome: "Affondo inverso con ginocchio alto", serie: 1, reps: "30", rec: "90", ss: "A" },
    { nome: "Curl con bilanciere presa larga", serie: 3, reps: "10", rec: "0", ss: "B" },
    { nome: "French press cavo basso", serie: 3, reps: "10", rec: "90", ss: "B", note: 'ULTIMA SERIE - drop set: recupera 20" e chiudi altre reps.' }
  ] }] }] };
  const list = preparaTecniche(program).settimane[0].giorni[0].esercizi;
  assert.deepEqual(list.map((e) => [e.ssType, e.ms]), [["multiset", 1], ["multiset", 2], [undefined, undefined], [undefined, undefined]]);
  assert.equal(list[3].tecniche[2].testo, 'Drop set · pausa 20" · stesso carico');
  assert.deepEqual(list[3].tecniche[2].passi.map((p) => p.tipo), ["pausa", "blocco"]);
});

test("pannello: multiserie e tecnica per serie arrivano nella scheda del cliente e tornano nel builder", async () => {
  const { mockupToProgram, programToMockup } = await editor;
  const { toAthleteProgram } = await runtime;
  const { preparaTecniche } = await tecniche;
  const base = { nome: "Leg extension", serie: "4", rip: "10-12", rec: "01:30", rir: "1", carico: "40", note: "" };
  const template = { nome: "Gambe", weeks: [{ nome: "Settimana 1", giorni: [{ nome: "Lower", giorno: "1", esercizi: [
    { ...base, tecnica: { t: "stripping", serie: "ultima" } },
    { nome: "Affondo", serie: "1", rip: "20", rec: "00:20", rir: "", carico: "PC" },
    { nome: "Affondo", serie: "1", rip: "30", rec: "01:30", rir: "", carico: "PC", link: "multiserie" },
    { ...base, nome: "Leg curl", tecnica: { t: "top_bake" } }
  ] }] }] };
  const program = mockupToProgram(template, dates);
  const blocks = program.settimane[0].giorni[0].blocks;
  assert.deepEqual(blocks.map((b) => [b.method, b.exercises.length]), [["straight", 1], ["multiset", 2], ["straight", 1]]);
  assert.deepEqual(blocks[0].exercises[0].sets.map((s) => s.technique?.t || null), [null, null, null, "stripping"]);

  const athlete = preparaTecniche(toAthleteProgram(program)).settimane[0].giorni[0].esercizi;
  assert.deepEqual(tipo(athlete[0].tecniche), [null, null, null, "stripping"]);
  assert.deepEqual(athlete.slice(1, 3).map((e) => [e.ssType, e.ms, e.rec]), [["multiset", 1, "20"], ["multiset", 2, "90"]]);
  assert.equal(athlete[1].ss, athlete[2].ss);
  assert.deepEqual(tipo(athlete[3].tecniche), ["top", "bake_off", "bake_off", "bake_off"]);

  const back = programToMockup(program).weeks[0].giorni[0].esercizi;
  assert.deepEqual(back.map((e) => e.link || null), [null, null, "multiserie", null]);
  assert.deepEqual(back[0].tecnica, { t: "stripping", blocchi: 2, pausa: 0, calo: 20, serie: "ultima" });
  assert.deepEqual(back[3].tecnica, { t: "top_bake" });
  // Rilettura e nuovo salvataggio senza perdere nulla.
  const again = mockupToProgram({ ...template, weeks: [{ ...template.weeks[0], giorni: [{ ...template.weeks[0].giorni[0], esercizi: back }] }] }, dates);
  assert.deepEqual(again.settimane[0].giorni[0].blocks.map((b) => b.method), ["straight", "multiset", "straight"]);
});

test("app cliente: riga della serie con la tecnica, catena con pause e blocchi registrati nella stessa serie", () => {
  const page = fs.readFileSync(path.resolve(__dirname, "../www/athlete.html"), "utf8");
  assert.match(page, /multiset:'Multiserie'/);
  assert.match(page, /function catenaHTML\(ex,i,tec,prevSet\)/);
  assert.match(page, /class="set-tec/);
  assert.match(page, /chain-pausa/);
  // La lettura della serie unisce i blocchi: «12 + 6 + 4» e carichi «40 / 31,25 / 25».
  const a = page.indexOf("  function fmtKgIt("), b = page.indexOf("\n", a);
  const c = page.indexOf("  function valoreSerie("), d = page.indexOf("  function isDone(");
  const src = page.slice(a, b) + "\n" + page.slice(c, d) + "\nfunction isUnilat(){return false}\n({leggiSerie})";
  const { leggiSerie } = vm.runInNewContext(src);
  const ex = { nome: "Leg extension", carico: "40", tecniche: [null, { t: "stripping", passi: [
    { tipo: "blocco", n: 1, calo: 20, stessoCarico: false }, { tipo: "blocco", n: 2, calo: 20, stessoCarico: false }] }] };
  const out = leggiSerie(ex, { kg: "40", reps: "12", rir: "0", blocchi: [{ kg: "", reps: "6" }, { kg: "", reps: "4" }] }, 1);
  assert.equal(out.reps, 12);
  assert.equal(out.repsTesto, "12 + 6 + 4");
  assert.equal(out.kgTesto, "40 / 31,25 / 25");
  assert.equal(out.tecnica, "stripping");
  const drop = { nome: "Curl", tecniche: [{ t: "drop", passi: [{ tipo: "pausa", sec: 20 }, { tipo: "blocco", n: 1, calo: 0, stessoCarico: true }] }] };
  const d2 = leggiSerie(drop, { kg: "20", reps: "10", rir: "", blocchi: [{ reps: "3" }] }, 0);
  assert.equal(d2.repsTesto, "10 + 3");
  assert.equal(d2.kgTesto, undefined);
  assert.equal(leggiSerie(ex, { kg: "40", reps: "12", rir: "" }, 0).tecnica, undefined);
});

test("pannello: scelta Multiserie, campo Tecnica e import Excel dello stesso esercizio come multiserie", () => {
  const html = fs.readFileSync(path.join(__dirname, "../www/coach.html"), "utf8");
  assert.match(html, /data-link="multiserie"/);
  assert.match(html, /data-tec="t"/);
  assert.match(html, /'Multiserie' : 'Superserie'/);
  const source = html.slice(html.indexOf("  function _norm(v)"), html.indexOf("  function applyScheda(res)"));
  const { parseSchedaRows } = vm.runInNewContext(source + "\n({parseSchedaRows})");
  const head = ["Nome_Programma", "Numero_Settimane", "Giorno_Numero", "Nome_Esercizio", "Serie", "Ripetizioni_Tempo", "Superserie"];
  const res = parseSchedaRows([head,
    ["Test", 1, 1, "Affondo", 1, "20", "A"], ["Test", 1, 1, "Affondo", 1, "30", "A"],
    ["Test", 1, 1, "Curl", 3, "10", "B"], ["Test", 1, 1, "French", 3, "10", "B"]]);
  assert.deepEqual(JSON.parse(JSON.stringify(res.weeks[0].giorni[0].esercizi.map((e) => e.link || null))), [null, "multiserie", null, "superserie"]);
});

test("v2: la multiserie è un metodo valido con almeno due righe", async () => {
  const { validateV2Program } = await runtime;
  const { mockupToProgram } = await editor;
  const program = mockupToProgram({ nome: "T", weeks: [{ nome: "S1", giorni: [{ nome: "G", giorno: "1", esercizi: [
    { nome: "Affondo", serie: "1", rip: "20", rec: "00:20", carico: "PC" },
    { nome: "Affondo", serie: "1", rip: "30", rec: "01:30", carico: "PC", link: "multiserie" }] }] }] }, dates);
  assert.equal(validateV2Program(program, { forPublish: true }).valid, true);
  program.settimane[0].giorni[0].blocks[0].exercises.pop();
  assert.equal(validateV2Program(program).valid, false);
});
