const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const mod = import("../www/src/automazioni.mjs");

test("automazioni: valori predefiniti spenti, limiti su fascia oraria e allenamenti, testi di riserva", async () => {
  const { normalizzaAutomazioni } = await mod;
  const d = normalizzaAutomazioni({});
  assert.equal(d.benvenuto.attiva, false);
  assert.equal(d.fineScheda.attiva, false);
  assert.deepEqual(d.fascia, { da: 8, a: 21 });
  assert.equal(d.fineScheda.allenamenti, 3);
  const x = normalizzaAutomazioni({ fascia: { da: 22, a: 7 }, fineScheda: { attiva: true, allenamenti: 99, testo: "  " }, compleanno: { attiva: "true" } });
  assert.deepEqual(x.fascia, { da: 8, a: 21 }, "fascia rovesciata → predefinita");
  assert.equal(x.fineScheda.allenamenti, 20);
  assert.match(x.fineScheda.testo, /\{mancano\}/);
  assert.equal(x.compleanno.attiva, false, "solo true booleano accende l'automazione");
});

test("anteprima: stessi segnaposto del database", async () => {
  const { anteprimaTesto, SEGNAPOSTI } = await mod;
  assert.equal(anteprimaTesto("Ciao {nome}, mancano {mancano} a «{scheda}» ({fatti}/{totali})", { nome: "Davide", scheda: "5° livello", mancano: 2, fatti: 4, totali: 6 }), "Ciao Davide, mancano 2 a «5° livello» (4/6)");
  const sql = read("supabase/migrations/202611280001_automazioni_app_cliente.sql");
  for (const s of SEGNAPOSTI) assert.ok(sql.includes(`'${s}'`), s);
});

test("app cliente: si salvano solo le sezioni spente e i due interruttori", async () => {
  const { normalizzaApp } = await mod;
  assert.deepEqual(normalizzaApp({ sezioni: { consigli: false, chat: true, inventata: false }, dataAllenamento: true, nascondiMacro: 1 }),
    { sezioni: { consigli: false }, dataAllenamento: true, nascondiMacro: false });
});

test("database: tabelle protette, cliente legge solo la parte app, motore pianificato ogni 15 minuti", () => {
  const sql = read("supabase/migrations/202611280001_automazioni_app_cliente.sql");
  for (const table of ["coach_settings", "automation_log"]) assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(sql, /function public\.athlete_app_settings\(\)[\s\S]*select s\.app from public\.coach_settings/);
  assert.match(sql, /unique \(athlete_id, kind, event_key\)/, "ogni evento parte una volta sola");
  assert.match(sql, /cron\.schedule\('lpt-automazioni', '\*\/15 \* \* \* \*', 'select private\.run_automations\(\)'\)/);
  assert.match(sql, /at time zone 'Europe\/Rome'/);
  assert.match(sql, /revoke all on function private\.run_automations\(\) from public, anon, authenticated/);
  assert.match(sql, /x ->> 'programVersionId' = a\.version_id/, "conta solo le sedute della scheda attiva");
});

test("pannello: voci App cliente e Automazioni nelle impostazioni, data di nascita nella scheda cliente", () => {
  const html = read("www/coach.html");
  assert.match(html, /\['app','App cliente'\],\['automazioni','Automazioni'\]/);
  assert.match(html, /id="cliBday"/);
  const js = read("www/src/coach-mockup.mjs");
  assert.match(js, /rpc\("save_coach_settings"/);
  assert.match(js, /rpc\("coach_set_birth_date"/);
  assert.match(js, /if\(tab==="automazioni"\)return void automationsPanel\(panel\)/);
});

test("app cliente: rispetta sezioni, data degli allenamenti e macro nascosti (anche nel PDF)", async () => {
  const page = read("www/athlete.html");
  assert.match(page, /NAV\.filter\(n=>tabVisibile\(n\.id\)\)/);
  assert.match(page, /ALTRO\.filter\(it=>!ALTRO_SEZ\[it\.t\]\|\|sezioneVisibile/);
  assert.match(page, /applyAppSettings:/);
  assert.match(page, /APP_CFG\.nascondiMacro\?\{kcal:0/);
  assert.match(page, /function dataSeduta\(g,i\)/);
  assert.match(read("www/src/athlete.mjs"), /rpc\("athlete_app_settings"\)/);
  const { nutritionPdfModel } = await import("../www/src/pdf-export.mjs");
  const plan = { giorni: [{ nome: "ON", proteine: 150, carboidrati: 200, grassi: 60, pasti: [] }] };
  assert.match(nutritionPdfModel(plan).giorni[0].macro, /kcal/);
  assert.equal(nutritionPdfModel(plan, { nascondiMacro: true }).giorni[0].macro, "");
});
