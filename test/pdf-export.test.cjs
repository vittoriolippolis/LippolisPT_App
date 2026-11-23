const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const pdf = import("../www/src/pdf-export.mjs");

const ex = (nome, extra = {}) => ({ nome, serie: 3, reps: "10-12", rec: "1:30", rir: 1, carico: "20", ...extra });
const week = (n, giorni) => ({ n, dal: `2026-11-${String(15 + n).padStart(2, "0")}`, al: `2026-11-${String(21 + n).padStart(2, "0")}`, giorni });

test("PDF scheda: settimane uguali in un blocco, scarico a parte, unilaterali per lato", async () => {
  const { workoutPdfModel } = await pdf;
  const giorno = { titolo: "Petto", dn: "Lunedì", min: 60, esercizi: [ex("Panca piana", { note: "Scapole addotte — piedi a terra" }), ex("Curl singolo", { reps: "10" })] };
  const scarico = { ...giorno, titolo: "Petto — Scarico", esercizi: giorno.esercizi.map((e) => ({ ...e, serie: 2 })) };
  const m = workoutPdfModel({ nome: "Marika Cardano - 9° livello", settimane: [week(1, [giorno]), week(2, [giorno]), week(3, [giorno]), week(4, [scarico])] }, { cliente: "Marika Cardano", isUnilat: (e) => /singolo/.test(e.nome) });
  assert.deepEqual(m.blocchi.map((b) => b.etichetta), ["Settimane 1-3", "Settimana 4"]);
  assert.equal(m.blocchi[1].giorni[0].titolo, "Petto - Scarico");
  const [panca, curl] = m.blocchi[0].giorni[0].esercizi;
  assert.equal(panca.note, "Scapole addotte - piedi a terra");
  assert.equal(curl.serie, "3 per lato");
  assert.equal(m.periodo, "16/11/2026 - 25/11/2026");
});

test("PDF consigli: calorie dai macro se mancano, alternative incluse", async () => {
  const { nutritionPdfModel, pdfFileName, pdfText } = await pdf;
  const m = nutritionPdfModel({ nome: "CONSIGLI ALIMENTARI - Marika Cardano 3", giorni: [{ nome: "Giorno ON", proteine: "100", carboidrati: "100", grassi: "10", pasti: [{ tipo: "Colazione", items: [{ nome: "Yogurt greco", g: "250", alternative: [{ nome: "Skyr", g: "230" }] }] }] }] });
  assert.match(m.giorni[0].macro, /^890 kcal/);
  assert.equal(m.giorni[0].pasti[0].alimenti[0].alternative[0].g, "230 g");
  assert.equal(pdfFileName("Scheda", "Marika Cardano - 9° livello"), "Marika Cardano - 9 livello.pdf");
  assert.match(pdfText("Ok 💪 “bene”"), /^Ok\s+"bene"$/);
});

test("il PDF usa jsPDF incluso nel sito e i tasti sono nell'app cliente", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../www/athlete.html"), "utf8");
  assert.ok(fs.existsSync(path.resolve(__dirname, "../www/vendor/jspdf.umd.min.js")));
  assert.ok(fs.existsSync(path.resolve(__dirname, "../www/vendor/jspdf.plugin.autotable.min.js")));
  assert.match(html, /pdfButton\('workout'/);
  assert.match(html, /pdfButton\('nutrition'/);
});
