const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
const athlete = read("www/athlete.html");
const coach = read("www/coach.html");
const slice = (src, start, end) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));

test("variazione con segno e virgola italiana", () => {
  const ctx = vm.createContext({});
  vm.runInContext(slice(athlete, "  function fmtKgIt(v)", "\n") + "\n" + slice(athlete, "  function variazione(", "\n"), ctx);
  assert.equal(ctx.variazione(1.875, "kg"), "+1,88 kg");
  assert.equal(ctx.variazione(-0.4, "cm"), "−0,4 cm");
  assert.equal(ctx.variazione(0, "kg"), "±0 kg");
});

test("storico esercizio: grafico della serie migliore per seduta, dal più vecchio al più recente", () => {
  const ctx = vm.createContext({ MESI: ["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"] });
  const src = ["  function fmtKgIt(v)", "  function fmtData(ts)", "  function variazione(", "  function attrPunti(", "  function esc(v)"].map(s => slice(athlete, s, "\n")).join("\n")
    + "\n" + slice(athlete, "  function graficoEsercizioHTML(", "  function buildPesoChart(") + slice(athlete, "  function smoothPath(", "  function buildChart(");
  vm.runInContext(src, ctx);
  const sessions = [
    { ts: Date.UTC(2026, 10, 23), prog: "4° livello", sett: 2, serie: [{ kg: 30, reps: 8 }, { kg: 32.5, reps: 6 }] },
    { ts: Date.UTC(2026, 10, 16), prog: "4° livello", sett: 1, serie: [{ kg: 30, reps: 7 }] },
  ];
  const html = ctx.graficoEsercizioHTML(sessions, false);
  assert.match(html, /32,5 kg × 6/);
  assert.match(html, /\+2,5 kg dal 16 nov/);
  assert.match(html, /data-punti="/);
  assert.equal(ctx.graficoEsercizioHTML(sessions.slice(0, 1), false), "", "con una sola seduta niente grafico");
  assert.equal(ctx.graficoEsercizioHTML(sessions, true), "", "esercizi a tempo esclusi");
});

test("manopola del volume: passi da 5, limiti 10-100, frecce e Home/End", () => {
  const handlers = {}, attrs = {};
  const node = () => ({ setAttribute() {}, style: {} });
  const el = { querySelector: s => node(), addEventListener: (t, f) => { handlers[t] = f; }, setAttribute: (k, v) => { attrs[k] = v; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
  const ctx = vm.createContext({});
  vm.runInContext(slice(athlete, "  function montaManopola(", "  // Numeri che scorrono"), ctx);
  const changes = [];
  ctx.montaManopola(el, 72, () => {}, v => changes.push(v));
  assert.equal(attrs["aria-valuenow"], 70);
  handlers.keydown({ key: "ArrowUp", preventDefault() {} });
  handlers.keydown({ key: "End", preventDefault() {} });
  handlers.keydown({ key: "ArrowUp", preventDefault() {} });
  handlers.keydown({ key: "Home", preventDefault() {} });
  assert.deepEqual(changes, [75, 100, 100, 10]);
});

test("anello settimana, numeri che scorrono e radar del volume", () => {
  assert.match(athlete, /class="ucidx uc-ring"/);
  assert.match(athlete, /data-conta="\$\{v\}"/);
  assert.match(coach, /class="tile-metric" data-conta=/);
  assert.match(coach, /function radarVolume\(arr\)/);
  assert.match(coach, /\['Pettorali','Dorsali'\],\['Quadricipiti','Femorali'\],\['Bicipiti','Tricipiti'\]/);
});
