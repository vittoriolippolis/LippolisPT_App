// Esporta in PDF la scheda di allenamento e i consigli alimentari del cliente.
// jsPDF è incluso nel sito (www/vendor) e si carica solo al primo export: funziona anche offline nell'APK.

// Tecniche per serie (dal pannello) che la nota del PT non nomina già: «Serie 4: Stripping · 2 scarichi −20%».
function tecnicheNota(ex) {
  const note = String(ex?.note || "").toLocaleLowerCase("it");
  return (Array.isArray(ex?.tecniche) ? ex.tecniche : []).map((tec, i) => {
    const testo = String(tec?.testo || "");
    const nome = testo.split(" · ")[0].toLocaleLowerCase("it");
    return testo && !note.includes(nome) ? `Serie ${i + 1}: ${testo}` : "";
  }).filter(Boolean).join("\n");
}

const BRAND = [18, 199, 162];      // #12C7A2
const INK = [19, 33, 31];          // #13211F
const MUTED = [99, 113, 110];
const SOFT = [232, 248, 244];
const LINE = [220, 229, 226];

// I font standard dei PDF coprono solo l'alfabeto occidentale: niente emoji o simboli rari.
const SOSTITUZIONI = { "’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "-", "−": "-", "…": "...", "″": '"', "′": "'", "≈": "~", "→": "->", "•": "·", " ": " ", " ": " " };
export function pdfText(value) {
  return String(value ?? "").replace(/[^\x00-\xff]/g, (c) => SOSTITUZIONI[c] ?? "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").trim();
}

const firma = (week) => JSON.stringify((week?.giorni || []).map((g) => [g.titolo, (g.esercizi || []).map((e) => [e.nome, e.serie, e.reps, e.repsSerie, e.rec, e.rir, e.carico, e.carichiSerie, e.note, e.tempo, (e.tecniche || []).map((x) => x?.testo || "")])]));
const elenco = (list) => (Array.isArray(list) && list.some((v) => v !== "" && v != null) ? list.map((v) => (v === "" || v == null ? "-" : v)).join(" / ") : "");

// Scheda → modello da stampare. Settimane consecutive identiche diventano un solo blocco («Settimane 1-4»).
export function workoutPdfModel(program, { cliente = "", fmtRec = (ex) => String(ex.rec || ""), isUnilat = () => false } = {}) {
  const weeks = Array.isArray(program?.settimane) ? program.settimane : [];
  const blocchi = [];
  weeks.forEach((week, i) => {
    const n = week.n ?? i + 1, sig = firma(week), last = blocchi[blocchi.length - 1];
    if (last && last.sig === sig) { last.a = n; last.al = week.al || last.al; return; }
    blocchi.push({ sig, da: n, a: n, dal: week.dal, al: week.al, week });
  });
  return {
    titolo: pdfText(program?.nome || "Scheda di allenamento"),
    cliente: pdfText(cliente),
    periodo: weeks.length ? [fmtDate(weeks[0].dal), fmtDate(weeks[weeks.length - 1].al)].filter(Boolean).join(" - ") : "",
    blocchi: blocchi.map((b) => ({
      etichetta: b.da === b.a ? `Settimana ${b.da}` : `Settimane ${b.da}-${b.a}`,
      date: [fmtDate(b.dal), fmtDate(b.al)].filter(Boolean).join(" - "),
      giorni: (b.week.giorni || []).map((g, gi) => ({
        titolo: pdfText(g.titolo || `Allenamento ${gi + 1}`),
        meta: [g.dn, `${(g.esercizi || []).length} esercizi`, g.min ? `~${g.min} min` : ""].filter(Boolean).map(pdfText).join(" · "),
        esercizi: (g.esercizi || []).map((ex, ei) => {
          const uni = isUnilat(ex), perLato = /per (lato|gamba|braccio)/i.test(String(ex.reps || ""));
          const timed = ex.cardio || ex.timed;
          return {
            n: pdfText(ex.badge || ei + 1),
            gruppo: ex.ss || ex.ssType === "multiset" ? pdfText({ superset: "Superset", giant_set: "Giant set", circuit: "Circuito", multiset: "Multiserie" }[ex.ssType] || "Superset") : "",
            ss: ex.ss || "",
            nome: pdfText(ex.nome),
            muscolo: pdfText(ex.muscolo || ""),
            serie: timed ? "-" : pdfText(`${ex.serie ?? ""}${uni && !perLato ? " per lato" : ""}`),
            reps: pdfText(timed ? ex.tempo || ex.reps || "" : elenco(ex.repsSerie) || ex.reps || "") + (ex.unita === "sec" && !timed ? " sec" : ""),
            rec: pdfText(fmtRec(ex) || "-"),
            rir: pdfText(ex.rirTxt ?? ex.rir ?? "-"),
            carico: pdfText(elenco(ex.carichiSerie) || ex.carico || "-"),
            note: pdfText([ex.note || "", tecnicheNota(ex)].filter(Boolean).join("\n"))
          };
        })
      }))
    }))
  };
}

const num = (v) => { const x = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(x) && x > 0 ? x : 0; };
export function nutritionPdfModel(plan, { cliente = "" } = {}) {
  return {
    titolo: pdfText(plan?.nome || "Consigli alimentari"),
    cliente: pdfText(cliente),
    descrizione: pdfText(plan?.descrizione || ""),
    giorni: (plan?.giorni || []).map((day, i) => {
      const p = num(day.proteine), c = num(day.carboidrati), f = num(day.grassi);
      const kcal = num(day.energia) || Math.round(p * 4 + c * 4 + f * 9);
      return {
        titolo: pdfText(day.nome || `Giorno ${i + 1}`),
        macro: [kcal ? `${kcal} kcal` : "", c ? `Carboidrati ${Math.round(c)} g` : "", p ? `Proteine ${Math.round(p)} g` : "", f ? `Grassi ${Math.round(f)} g` : ""].filter(Boolean).join("   ·   "),
        note: pdfText(day.note || ""),
        pasti: (day.pasti || []).map((meal) => ({
          tipo: pdfText(meal.tipo || "Pasto"),
          alimenti: (meal.items || []).map((item) => ({
            nome: pdfText(item.nome), g: item.g !== "" && item.g != null ? `${pdfText(item.g)} g` : "",
            alternative: (item.alternative || []).map((a) => ({ nome: pdfText(a.nome), g: a.g !== "" && a.g != null ? `${pdfText(a.g)} g` : "" }))
          }))
        }))
      };
    })
  };
}

function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

export function pdfFileName(kind, titolo) {
  const base = pdfText(titolo).replace(/°/g, "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || kind;
  return `${base}.pdf`;
}

// ---- disegno ----
function header(doc, kicker, titolo, righe) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...INK); doc.rect(0, 0, W, 30, "F");
  doc.setFillColor(...BRAND); doc.roundedRect(14, 9, 12, 12, 2.5, 2.5, "F");
  doc.setDrawColor(...INK); doc.setLineWidth(1.4); doc.line(17.5, 15, 22.5, 15); doc.line(17.5, 12.6, 17.5, 17.4); doc.line(22.5, 12.6, 22.5, 17.4);
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(255, 255, 255);
  doc.text("LIPPOLIS", 30, 17.6);
  doc.setTextColor(...BRAND); doc.text("PT", 30 + doc.getTextWidth("LIPPOLIS "), 17.6);
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(185, 200, 196);
  doc.text(kicker.toUpperCase(), W - 14, 17.6, { align: "right", charSpace: 0.6 });
  let y = 43;
  doc.setTextColor(...INK); doc.setFontSize(19);
  const lines = doc.splitTextToSize(titolo, W - 28);
  doc.text(lines, 14, y); y += lines.length * 7.6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...MUTED);
  for (const r of righe.filter(Boolean)) { doc.text(r, 14, y); y += 5.2; }
  return y + 3;
}

function footer(doc) {
  const n = doc.getNumberOfPages(), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const oggi = new Date().toLocaleDateString("it-IT");
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(14, H - 12, W - 14, H - 12);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text(`Lippolis PT · esportato il ${oggi}`, 14, H - 7.5);
    doc.text(`Pagina ${i} di ${n}`, W - 14, H - 7.5, { align: "right" });
  }
}

function ensureSpace(doc, y, need) {
  if (y + need > doc.internal.pageSize.getHeight() - 18) { doc.addPage(); return 16; }
  return y;
}

function bar(doc, y, text, right, { color = SOFT, ink = INK, size = 11.5 } = {}) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...color); doc.roundedRect(14, y, W - 28, 9, 2, 2, "F");
  doc.setFillColor(...BRAND); doc.rect(14, y, 1.6, 9, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(size); doc.setTextColor(...ink);
  doc.text(text, 19, y + 6.1);
  if (right) { doc.setFont("helvetica", "normal"); doc.setFontSize(8.8); doc.setTextColor(...MUTED); doc.text(right, W - 17, y + 6.1, { align: "right" }); }
  return y + 9;
}

const tableBase = {
  theme: "plain", margin: { left: 14, right: 14, bottom: 18, top: 16 },
  styles: { font: "helvetica", fontSize: 9, textColor: INK, cellPadding: { top: 2.2, bottom: 2.2, left: 2, right: 2 }, lineColor: LINE, valign: "middle", overflow: "linebreak" },
  headStyles: { fontStyle: "bold", fontSize: 7.6, textColor: MUTED, fillColor: false, lineWidth: { bottom: 0.3 }, lineColor: LINE }
};

export function drawWorkoutPdf(doc, model) {
  let y = header(doc, "Scheda di allenamento", model.titolo, [model.cliente, model.periodo]);
  for (const blocco of model.blocchi) {
    if (model.blocchi.length > 1 || blocco.etichetta !== "Settimana 1") {
      y = ensureSpace(doc, y, 30);
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...BRAND);
      doc.text(`${blocco.etichetta.toUpperCase()}${blocco.date ? "   ·   " + blocco.date : ""}`, 14, y + 3, { charSpace: 0.4 });
      y += 6;
    }
    for (const g of blocco.giorni) {
      y = ensureSpace(doc, y, 32);
      y = bar(doc, y, g.titolo, g.meta) + 1;
      const body = [];
      g.esercizi.forEach((ex, i) => {
        const next = g.esercizi[i + 1];
        const sub = [ex.gruppo ? ex.gruppo.toUpperCase() : "", ex.muscolo].filter(Boolean).join(" · ");
        // nome, gruppo muscolare e nota del PT nella stessa cella: non si separano mai a cambio pagina
        const cell = { content: [ex.nome, sub, ex.note].filter(Boolean).join("\n"), _ex: { nome: ex.nome, sub, note: ex.note } };
        const row = [{ content: ex.n, styles: { fontStyle: "bold", textColor: BRAND, halign: "center" } }, cell, ex.serie, ex.reps, ex.rec, String(ex.rir), ex.carico];
        row._end = !(ex.ss && next && next.ss === ex.ss);
        body.push(row);
      });
      doc.autoTable({
        ...tableBase, startY: y, rowPageBreak: "avoid",
        head: [["#", "ESERCIZIO", "SERIE", "RIPETIZIONI", "REC.", "RIR", "CARICO"]],
        body,
        columnStyles: { 0: { cellWidth: 9, halign: "center" }, 1: { cellWidth: "auto" }, 2: { cellWidth: 19, halign: "center" }, 3: { cellWidth: 30, halign: "center" }, 4: { cellWidth: 14, halign: "center" }, 5: { cellWidth: 11, halign: "center" }, 6: { cellWidth: 21, halign: "center" } },
        didParseCell: (data) => {
          if (data.section !== "body") return;
          if (body[data.row.index]?._end) data.cell.styles.lineWidth = { bottom: 0.25 };
        },
        willDrawCell: (data) => { if (data.section === "body" && data.cell.raw?._ex) data.cell.text = []; },
        didDrawCell: (data) => {
          const info = data.section === "body" && data.cell.raw?._ex;
          if (!info) return;
          const c = data.cell, wdt = c.width - 4, x = c.x + 2;
          let ty = c.y + 2.2 + 3.1;
          doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...INK);
          const n = doc.splitTextToSize(info.nome, wdt); doc.text(n, x, ty); ty += n.length * 3.9;
          if (info.sub) { doc.setFont("helvetica", "normal"); doc.setFontSize(7.4); doc.setTextColor(...MUTED); doc.text(info.sub, x, ty - 0.4); ty += 3.6; }
          if (info.note) { doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(...MUTED); const l = doc.splitTextToSize(info.note, wdt); doc.text(l, x, ty + 0.4); }
        }
      });
      y = doc.lastAutoTable.finalY + 7;
    }
  }
  footer(doc);
  return doc;
}

export function drawNutritionPdf(doc, model) {
  let y = header(doc, "Consigli alimentari", model.titolo, [model.cliente]);
  if (model.descrizione) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...INK);
    const lines = doc.splitTextToSize(model.descrizione, doc.internal.pageSize.getWidth() - 28);
    y = ensureSpace(doc, y, lines.length * 4.6); doc.text(lines, 14, y); y += lines.length * 4.6 + 4;
  }
  for (const day of model.giorni) {
    y = ensureSpace(doc, y, 40);
    y = bar(doc, y, day.titolo, "", { size: 12.5 }) + 1;
    if (day.macro) { doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...MUTED); doc.text(day.macro, 15, y + 4.6); y += 7; }
    if (day.note) { doc.setFont("helvetica", "italic"); doc.setFontSize(8.6); const l = doc.splitTextToSize(day.note, doc.internal.pageSize.getWidth() - 30); doc.text(l, 15, y + 3.6); y += l.length * 4.2 + 2; }
    const body = [];
    for (const meal of day.pasti) {
      body.push([{ content: meal.tipo, colSpan: 2, styles: { fontStyle: "bold", fontSize: 10, textColor: INK, cellPadding: { top: 4, bottom: 1.6, left: 2, right: 2 } } }]);
      for (const item of meal.alimenti) {
        body.push([{ content: item.nome }, { content: item.g, styles: { fontStyle: "bold", halign: "right" } }]);
        item.alternative.forEach((a, i) => body.push([{ content: `${i === 0 ? "oppure  " : "             "}${a.nome}`, styles: { fontSize: 8.2, textColor: MUTED, cellPadding: { top: 0.6, bottom: 0.6, left: 6, right: 2 } } }, { content: a.g, styles: { fontSize: 8.2, textColor: MUTED, halign: "right", cellPadding: { top: 0.6, bottom: 0.6, left: 2, right: 2 } } }]));
      }
      body[body.length - 1]._end = true;
    }
    doc.autoTable({
      ...tableBase, startY: y, showHead: "never", body,
      columnStyles: { 0: { cellWidth: "auto" }, 1: { cellWidth: 28 } },
      didParseCell: (data) => { if (data.section === "body" && body[data.row.index]?._end) data.cell.styles.lineWidth = { bottom: 0.25 }; }
    });
    y = doc.lastAutoTable.finalY + 8;
  }
  footer(doc);
  return doc;
}

// ---- caricamento e salvataggio ----
let loading;
export function loadJsPdf(base = "vendor/") {
  if (window.jspdf?.jsPDF?.API?.autoTable) return Promise.resolve(window.jspdf.jsPDF);
  const script = (src) => new Promise((resolve, reject) => { const s = document.createElement("script"); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("Impossibile preparare il PDF: riprova.")); document.head.append(s); });
  loading ||= script(base + "jspdf.umd.min.js").then(() => script(base + "jspdf.plugin.autotable.min.js")).then(() => window.jspdf.jsPDF).catch((e) => { loading = null; throw e; });
  return loading;
}

export async function newPdf() {
  const jsPDF = await loadJsPdf();
  return new jsPDF({ unit: "mm", format: "a4", compress: true });
}

// Nell'app installata: condividi (WhatsApp, Drive, «Salva in File»…). Nel browser: scarica il file.
export async function deliverPdf(doc, fileName) {
  const C = window.Capacitor, native = C?.isNativePlatform?.() && C.Plugins?.Filesystem && C.Plugins?.Share;
  if (native) {
    const data = doc.output("datauristring").split(",")[1];
    const { uri } = await C.Plugins.Filesystem.writeFile({ path: fileName, data, directory: "CACHE" });
    await C.Plugins.Share.share({ title: fileName.replace(/\.pdf$/, ""), url: uri, dialogTitle: "Esporta PDF" });
    return "shared";
  }
  doc.save(fileName);
  return "saved";
}
