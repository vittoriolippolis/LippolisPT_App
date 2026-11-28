const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
const athlete = read("www/athlete.html");
const coach = read("www/coach.html");
const login = read("www/index.html");

test("la foto della palestra resta solo nella pagina di accesso", () => {
  assert.match(login, /url\("sfondo\.jpg"\)/);
  assert.doesNotMatch(athlete, /sfondo\.jpg/);
  assert.doesNotMatch(coach, /sfondo\.jpg/);
});

test("niente grassetti 700-900, niente maiuscoletto spaziato", () => {
  for (const [name, html] of [["athlete", athlete], ["coach", coach], ["index", login]]) {
    assert.doesNotMatch(html, /font-weight: ?(700|800|900)\b/, name);
    assert.doesNotMatch(html, /font: ?(700|800|900) /, name);
    assert.doesNotMatch(html, /text-transform: ?uppercase/, name);
  }
});

test("niente ombre colorate con l'accento (i focus ring restano)", () => {
  for (const html of [athlete, coach]) {
    for (const [, value] of html.matchAll(/box-shadow:([^;}"']*rgba\(var\(--accent-rgb\)[^;}"']*)/g)) {
      assert.match(value.trim(), /^0 0 0 /, value);
    }
  }
});

test("titoli dei giorni in maiuscolo mostrati in forma normale", () => {
  const src = athlete.match(/function titoloGiorno\(t\)\{[^\n]*\}/)[0];
  const titoloGiorno = new Function(`${src}; return titoloGiorno;`)();
  assert.equal(titoloGiorno("PETTO/SPALLE/TRICIPITI"), "Petto/Spalle/Tricipiti");
  assert.equal(titoloGiorno("GAMBE — Scarico"), "Gambe — Scarico");
  assert.equal(titoloGiorno("Total Body A"), "Total Body A");
  assert.equal(titoloGiorno(""), "");
});

test("card esercizio: nome sulla prima riga, sintesi e azioni sulla seconda", () => {
  assert.match(athlete, /<div class="ex-main"><div class="ex-name">\$\{esc\(ex\.nome\)\}<\/div><\/div>/);
  assert.match(athlete, /<div class="card-sub"><div class="ex-muscle"><b class="ex-sum">/);
  assert.match(athlete, /<div class="card-acts">\$\{historyButton\}<button class="flagbtn/);
});

test("pannello coach a tutta larghezza, senza saluto in home", () => {
  assert.doesNotMatch(coach, /max-width:1140px/);
  assert.doesNotMatch(coach, /Ciao, '/);
  assert.match(coach, /<h1>Oggi<\/h1>/);
});
