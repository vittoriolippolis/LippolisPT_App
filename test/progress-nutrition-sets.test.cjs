const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const page = fs.readFileSync(path.resolve(__dirname, "../www/athlete.html"), "utf8");
const slice = (from, to) => { const a = page.indexOf(from), b = page.indexOf(to, a); assert.ok(a > 0 && b > a, from); return page.slice(a, b); };
const groups = import("../www/src/progress-photo-groups.mjs");
const model = import("../www/src/coach-mockup-model.mjs");

function serie() {
  const fmt = page.slice(page.indexOf("  function fmtKgIt("), page.indexOf("\n", page.indexOf("  function fmtKgIt(")));
  return vm.runInNewContext(slice("  function valoreSerie(", "  function isDone(") + fmt + "\n({leggiSerie,partiReps,partiKg})", { isUnilat: () => false });
}

test("drop set: le ripetizioni con la virgola non bloccano più la conclusione", () => {
  const { leggiSerie } = serie();
  const ex = { carico: "20" };
  assert.deepEqual({ ...leggiSerie(ex, { kg: "22,5", reps: "13,9", rir: "0" }, 0) }, { kg: 22.5, reps: 13, rir: 0, repsTesto: "13 + 9" });
  assert.equal(leggiSerie(ex, { kg: "22,5", reps: "13+9", rir: "" }, 0).repsTesto, "13 + 9");
  assert.equal(leggiSerie(ex, { kg: "22,5", reps: "12", rir: "" }, 0).repsTesto, undefined);
  assert.equal(leggiSerie(ex, { kg: "22,5", reps: "abc", rir: "" }, 0), null);
});

test("kg: la virgola resta decimale, gli altri separatori indicano più carichi", () => {
  const { partiKg } = serie();
  assert.deepEqual([...partiKg("22,5")], [22.5]);
  assert.deepEqual([...partiKg("1,25")], [1.25]);
  assert.deepEqual([...partiKg("17,50")], [17.5]);
  assert.deepEqual([...partiKg("22,5/15")], [22.5, 15]);
  assert.deepEqual([...partiKg("22,5 + 15")], [22.5, 15]);
  assert.deepEqual([...partiKg("30,20")], [30, 20]);
  assert.deepEqual([...partiKg("30-20-10")], [30, 20, 10]);
  assert.equal(partiKg("venti"), null);
  const { leggiSerie } = serie();
  assert.equal(leggiSerie({ carico: "20" }, { kg: "22,5/15", reps: "13,9", rir: "" }, 0).kgTesto, "22,5 / 15");
});

test("il pannello coach mostra i valori multipli della serie", async () => {
  const { athleteSessions } = await model;
  const [s] = athleteSessions({ sessioni: [{ id: "a", ts: 1, titolo: "A", esercizi: [{ nome: "Curl", sets: [{ kg: 22.5, reps: 13, repsTesto: "13 + 9", kgTesto: "22,5 / 15" }] }] }] });
  assert.equal(s.exercises[0].sets[0].repsText, "13 + 9");
  assert.equal(s.exercises[0].sets[0].kgText, "22,5 / 15");
});

test("foto: nomi con la posa, formato vecchio ancora letto, gruppi per caricamento", async () => {
  const { parseProgressFileName, progressFileName, groupProgressPhotos } = await groups;
  const batch = "0f8fad5b-d9cb-469f-a165-70867728950e";
  assert.equal(progressFileName(batch, "lato"), `${batch}-athlete-progress-lato.jpg`);
  assert.deepEqual(parseProgressFileName(`${batch}-athlete-progress-retro.jpg`), { batch, pose: "retro" });
  assert.deepEqual(parseProgressFileName(`${batch}-athlete-progress.jpg`), { batch: null, pose: null });
  assert.equal(parseProgressFileName(`${batch}-athlete-progress-schiena.jpg`), null);
  assert.throws(() => progressFileName(batch, "sopra"));
  const d = (iso) => new Date(iso);
  const out = groupProgressPhotos([
    { path: "r", batch, pose: "retro", date: d("2026-11-02T10:00:03") },
    { path: "f", batch, pose: "fronte", date: d("2026-11-02T10:00:01") },
    { path: "l", batch, pose: "lato", date: d("2026-11-02T10:00:02") },
    { path: "old1", batch: null, pose: null, date: d("2026-04-29T09:00:00") },
    { path: "old2", batch: null, pose: null, date: d("2026-04-29T09:01:00") },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].photos.map((p) => p.path), ["f", "l", "r"]);
  assert.deepEqual(out[1].photos.map((p) => p.path), ["old1", "old2"]);
});

test("consigli alimentari: tutti i giorni a fisarmonica con calorie e macro; recupero in barra; Altro più coprente", () => {
  assert.match(page, /data-nd-day="\$\{i\}"/);
  assert.match(page, /const giorni=assigned\.giorni\|\|\[\];/);
  const { macroGiorno } = vm.runInNewContext(slice("  function macroGiorno(", "  function tortaMacro(") + "\n({macroGiorno})");
  assert.deepEqual({ ...macroGiorno({ energia: "3001", proteine: "194", carboidrati: "358", grassi: "88" }) }, { kcal: 3001, p: 194, c: 358, f: 88 });
  assert.equal(macroGiorno({ proteine: "100", carboidrati: "100", grassi: "10" }).kcal, 890);
  assert.match(page, /class="tg-timer rec-bar"/);
  assert.doesNotMatch(page, /const recChip=/);
  assert.match(page, /\.targets\.targets-fill > \*\{flex:1 1 auto/);
  assert.match(page, /\.mcard\{[^}]*color-mix\(in srgb,var\(--surface\) 92%/);
});

test("serie: «20 kg», «pc», «C.L.» e «12 reps» valgono; esercizi chiusi di partenza; recupero centrato", () => {
  const { leggiSerie, partiKg, partiReps } = serie();
  assert.deepEqual([...partiKg("20 kg")], [20]);
  assert.deepEqual([...partiKg("20kg")], [20]);
  assert.deepEqual([...partiKg("pc")], [0]);
  assert.deepEqual([...partiKg("C.L.")], [0]);
  assert.deepEqual([...partiReps("12 reps")], [12]);
  assert.ok(leggiSerie({ carico: "20" }, { kg: "20 kg", reps: "12", rir: "1" }, 0));
  assert.match(page, /c\.className='card'\+\(st\.aperta\?' open':''\)/);
  assert.match(page, /<span>Recupero<\/span><b>\$\{fmtT\(recS\)\}<\/b>/);
  assert.match(page, /\.rec-bar\{display:flex; justify-content:center;/);
});

test("in grigio i valori della volta scorsa; reps scritte senza peso → peso della volta scorsa", () => {
  assert.match(page, /placeholder="\$\{esc\(prev\[i\]\?\.kgTxt\|\|targetLoad\)\}"/);
  assert.match(page, /placeholder="\$\{esc\(prev\[i\]\?\.repsTxt\|\|/);
  assert.match(page, /if\(st\.sets\[s\]\.reps&&!st\.sets\[s\]\.kg&&prev\[s\]\?\.kgTxt/);
  assert.match(page, /\.card\.done\{border:1\.5px solid var\(--accent\)/);
});
