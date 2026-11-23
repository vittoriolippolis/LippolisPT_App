const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const page = fs.readFileSync(path.resolve(__dirname, "../www/athlete.html"), "utf8");
const a = page.indexOf("  const DISCO_MIN="), b = page.indexOf("  function suggSets(");
const lib = vm.runInNewContext(page.slice(a, b) + "\n({upKg,downKg,fmtKgS,tecnica1,parseTarget})");
const seq = (range, ...sets) => sets.map(([kg, reps]) => ({ kg, reps, t: lib.parseTarget(range) }));
const plain = (out) => JSON.parse(JSON.stringify(out.map((s) => [s.dir, s.kg])));

test("carichi solo multipli di 1,25 kg (dischi 1,25 · 2,5 · 5 · 10 · 15 · 20) e scritti per intero", () => {
  assert.equal(lib.upKg(5), 6.25);
  assert.equal(lib.upKg(80), 83.75);
  assert.equal(lib.upKg(7), 7.5);
  assert.equal(lib.upKg(6.25), 7.5);
  assert.equal(lib.upKg(40), 42.5);
  assert.equal(lib.downKg(50), 47.5);
  assert.equal(lib.fmtKgS(6.25), "6,25");
  assert.equal(lib.fmtKgS(1.25), "1,25");
  for (const kg of [3, 5, 7, 12.5, 22, 37.5, 80, 101]) assert.equal(Math.round(lib.upKg(kg) / 1.25 * 1000) % 1000, 0, String(kg));
});

test("Tecnica 1: tutte le serie allo stesso carico → sale solo la 2ª (anche nel range 12-15, niente «+reps»)", () => {
  assert.deepEqual(plain(lib.tecnica1(seq("12-15", [5, 15], [5, 13]))), [["keep", 5], ["up", 6.25]]);
  assert.deepEqual(plain(lib.tecnica1(seq("8-10", [60, 10], [60, 9], [60, 8], [60, 8]))), [["keep", 60], ["up", 62.5], ["keep", 60], ["keep", 60]]);
});

test("Tecnica 1: 2ª chiusa col carico nuovo → sale anche la 3ª, poi la 4ª, poi la 1ª", () => {
  assert.deepEqual(plain(lib.tecnica1(seq("8-10", [60, 10], [62.5, 8], [60, 9], [60, 8]))), [["keep", 60], ["keep", 62.5], ["up", 62.5], ["keep", 60]]);
  assert.deepEqual(plain(lib.tecnica1(seq("8-10", [60, 10], [62.5, 9], [62.5, 8], [60, 9]))), [["keep", 60], ["keep", 62.5], ["keep", 62.5], ["up", 62.5]]);
  assert.deepEqual(plain(lib.tecnica1(seq("8-10", [60, 10], [62.5, 9], [62.5, 8], [62.5, 8]))), [["up", 62.5], ["keep", 62.5], ["keep", 62.5], ["keep", 62.5]]);
});

test("screen del 23/11: 7×12 · 8×12 · 8×11 (10-12) → tutte a 8 kg, non 9 e 10 kg", () => {
  assert.deepEqual(plain(lib.tecnica1(seq("10-12", [7, 12], [8, 12], [8, 11]))), [["up", 8], ["keep", 8], ["keep", 8]]);
});

test("carico nuovo non chiuso: 1 rep sotto → riprova; 2+ sotto → torna al carico di prima e +1 rep (Tecnica 2)", () => {
  assert.deepEqual(plain(lib.tecnica1(seq("8-10", [60, 10], [62.5, 7], [60, 9]))), [["keep", 60], ["keep", 62.5], ["keep", 60]]);
  assert.deepEqual(plain(lib.tecnica1(seq("8-10", [60, 10], [62.5, 6], [60, 9]))), [["keep", 60], ["push", 60], ["keep", 60]]);
});

test("niente più riga «In grigio…» sopra le serie", () => {
  assert.doesNotMatch(page, /In grigio: quello che hai fatto/);
  assert.match(page, /if\(mode==='range'\)\{/);
});
