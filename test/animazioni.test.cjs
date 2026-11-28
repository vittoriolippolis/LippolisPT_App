const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
const athlete = read("www/athlete.html");
const coach = read("www/coach.html");
const slice = (start, end) => athlete.slice(athlete.indexOf(start), athlete.indexOf(end, athlete.indexOf(start)));

function fakeEl(width = 0) {
  const handlers = {}, classes = new Set();
  return {
    style: {}, clientWidth: width, offsetWidth: 40, handlers,
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: c => classes.has(c) },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    setPointerCapture() {},
  };
}

function mount(onConfirm) {
  const knob = fakeEl(), fill = fakeEl(), el = fakeEl(348);
  el.querySelector = sel => (sel === ".sc-knob" ? knob : fill);
  const ctx = vm.createContext({ setTimeout: fn => fn(), window: {}, navigator: {} });
  vm.runInContext(slice("  function vibra(ms)", "\n") + "\n" + slice("  function montaScorriConferma(", "  // Riepilogo"), ctx);
  ctx.montaScorriConferma(el, onConfirm);
  return { el, knob };
}
const ev = (x) => ({ clientX: x, pointerId: 1, preventDefault() {} });

test("scorri per concludere: conferma solo oltre l'85% della corsa", () => {
  let calls = 0;
  const { knob } = mount(() => { calls++; return true; });
  knob.handlers.pointerdown(ev(0)); knob.handlers.pointermove(ev(200)); knob.handlers.pointerup(ev(200));
  assert.equal(calls, 0, "a metà corsa torna indietro");
  knob.handlers.pointerdown(ev(0)); knob.handlers.pointermove(ev(290)); knob.handlers.pointerup(ev(290));
  assert.equal(calls, 1);
});

test("scorri per concludere: Invio conferma, e un rifiuto rimette il cursore a zero", () => {
  let calls = 0;
  const { el, knob } = mount(() => { calls++; return false; });
  el.handlers.keydown({ key: "Enter", preventDefault() {} });
  assert.equal(calls, 1);
  assert.equal(el.classList.contains("ok"), false);
  assert.equal(knob.style.transform, "translateX(0px)");
});

test("concludi mostra il riepilogo invece del solo messaggio", () => {
  const fn = slice("  function concludiSessione(day){", "  function coachNoteHTML(");
  assert.match(fn, /riepilogoSessione\(sessioni\[sessioni\.length-1\]\)/);
  assert.doesNotMatch(fn, /toastMsg\('Allenamento salvato'\)/);
  assert.match(athlete, /<div class="slide-confirm" id="finishWorkout" role="button" tabindex="0"/);
});

test("grafici che si disegnano e animazioni brevi, senza molle", () => {
  for (const html of [athlete, coach]) {
    assert.match(html, /class="ch-line" pathLength="1"/);
    assert.match(html, /@keyframes ch-draw\{to\{stroke-dashoffset:0;\}\}/);
    assert.match(html, /prefers-reduced-motion:reduce/);
  }
  const anim = athlete.slice(athlete.indexOf("/* ===== Animazioni (28/11/2026)"));
  for (const [, d] of anim.matchAll(/animation:[a-z-]+ \.(\d+)s/g)) assert.ok(Number("0." + d) <= 0.7);
  assert.doesNotMatch(anim, /cubic-bezier\([^)]*1\.[1-9]/, "niente overshoot");
});

test("timer di recupero con anello che si svuota", () => {
  assert.match(athlete, /<svg class="tb-ring"/);
  assert.match(athlete, /stroke-dashoffset:\$\{tmr\.total\?\(1-pct\/100\)\.toFixed\(4\):1\}/);
});
