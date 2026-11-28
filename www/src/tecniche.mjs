// Tecniche d'intensità del Metodo Lippolis e multiserie.
// Modulo puro (niente DOM): lo usano l'app cliente (athlete.mjs prepara la scheda), il pannello coach e i test.
//
// Una tecnica vale per una singola serie: `ex.tecniche` è un array lungo quanto le serie prescritte,
// con `null` sulle serie normali e un oggetto sulle serie con la tecnica, ad esempio
//   [null, null, null, { t: "stripping", blocchi: 2, calo: 20 }]
// Le tecniche «a catena» (stripping, drop set, serie interrotte, rest-pause) aggiungono dei blocchi
// alla serie: si eseguono in seduta uno dopo l'altro, con le pause guidate dal timer.
// Fonte delle regole: DIZIONARIO TECNICHE del Metodo (stripping −20% senza pause; drop set 20" con lo
// stesso carico; serie interrotte 5 reps + 20" + 5 + 20" + 5; rest-pause 15" per due volte).

export const TECNICHE = Object.freeze({
  stripping: Object.freeze({ nome: "Stripping", catena: true, blocchi: 2, pausa: 0, calo: 20, stessoCarico: false }),
  drop: Object.freeze({ nome: "Drop set", catena: true, blocchi: 1, pausa: 20, calo: 0, stessoCarico: true }),
  interrotte: Object.freeze({ nome: "Serie interrotte", catena: true, blocchi: 2, pausa: 20, calo: 0, stessoCarico: true, reps: 5 }),
  rest_pause: Object.freeze({ nome: "Rest-pause", catena: true, blocchi: 2, pausa: 15, calo: 0, stessoCarico: true }),
  top: Object.freeze({ nome: "Top set", catena: false }),
  bake_off: Object.freeze({ nome: "Bake off", catena: false }),
  tensione: Object.freeze({ nome: "Tensione continua", catena: false })
});
export const TECNICHE_ORDINE = Object.freeze(["stripping", "drop", "interrotte", "rest_pause", "top", "bake_off", "tensione"]);

const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const text = (value) => String(value ?? "").trim();
const normName = (value) => text(value).toLocaleLowerCase("it").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");

/** Normalizza una tecnica (accetta anche alias e stringhe semplici). Restituisce null se non valida. */
export function normalizzaTecnica(value) {
  if (!value) return null;
  const raw = typeof value === "string" ? { t: value } : value;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const alias = { drop_set: "drop", dropset: "drop", "drop set": "drop", "rest-pause": "rest_pause", restpause: "rest_pause", "rest pause": "rest_pause",
    "serie interrotte": "interrotte", interrotta: "interrotte", "top set": "top", top_set: "top", "bake off": "bake_off", bakeoff: "bake_off",
    back_off: "bake_off", "back off": "bake_off", "tensione continua": "tensione" };
  const key = text(raw.t ?? raw.tipo ?? raw.tecnica).toLocaleLowerCase("it");
  const t = TECNICHE[key] ? key : alias[key];
  if (!t) return null;
  const def = TECNICHE[t];
  const out = { t };
  if (def.catena) {
    out.blocchi = clampInt(raw.blocchi ?? raw.n, 1, 4, def.blocchi);
    out.pausa = def.pausa ? clampInt(raw.pausa, 5, 90, def.pausa) : 0;
    if (t === "stripping") out.calo = clampInt(raw.calo, 5, 50, def.calo);
    if (t === "interrotte") out.reps = clampInt(raw.reps, 1, 30, def.reps);
  }
  const etichetta = text(raw.etichetta).slice(0, 60);
  if (etichetta) out.etichetta = etichetta;
  return out;
}

/** Testo breve per la riga della serie, es. «Stripping · 2 scarichi −20%». */
export function etichettaTecnica(value) {
  const tec = normalizzaTecnica(value);
  if (!tec) return "";
  const def = TECNICHE[tec.t];
  const nome = tec.etichetta || def.nome;
  if (tec.t === "stripping") return `${nome} · ${tec.blocchi} ${tec.blocchi === 1 ? "scarico" : "scarichi"} −${tec.calo}%`;
  if (tec.t === "drop") return `${nome} · pausa ${tec.pausa}" · stesso carico`;
  if (tec.t === "interrotte") return `${nome} · ${tec.blocchi + 1}×${tec.reps} · pausa ${tec.pausa}"`;
  if (tec.t === "rest_pause") return `${nome} · ${tec.blocchi}× pausa ${tec.pausa}"`;
  return nome;
}

/** Passi della catena dopo la serie principale: pause (timer) e blocchi da registrare. */
export function passiTecnica(value) {
  const tec = normalizzaTecnica(value);
  if (!tec || !TECNICHE[tec.t].catena) return [];
  const passi = [];
  for (let b = 1; b <= tec.blocchi; b++) {
    if (tec.pausa > 0) passi.push({ tipo: "pausa", sec: tec.pausa });
    passi.push({
      tipo: "blocco", n: b,
      nome: tec.t === "stripping" ? `Scarico ${b}` : tec.t === "interrotte" ? `Blocco ${b + 1}` : `Mini-serie ${b}`,
      calo: tec.t === "stripping" ? tec.calo : 0,
      reps: tec.t === "interrotte" ? tec.reps : null,
      stessoCarico: TECNICHE[tec.t].stessoCarico
    });
  }
  return passi;
}

/** Carico dello scarico: −calo% arrotondato per difetto al disco (1,25 kg). */
export function caricoScalato(kg, calo = 20, step = 1.25) {
  const base = Number(String(kg ?? "").replace(",", "."));
  if (!Number.isFinite(base) || base <= 0) return null;
  const r = Math.floor((base * (1 - calo / 100) + 1e-9) / step) * step;
  return r > 0 ? Number(r.toFixed(2)) : null;
}

// ---- Lettura delle note (schede importate dall'Excel con le frasi standard del Metodo) ----
const KEYWORDS = [
  { t: "stripping", re: /stripping/i },
  { t: "drop", re: /drop[\s-]?set/i },
  { t: "interrotte", re: /serie\s+interrott[ea]|\binterrott[ea]\b/i },
  { t: "rest_pause", re: /rest[\s-]?pause/i }
];
const NUM = { una: 1, uno: 1, due: 2, tre: 3, quattro: 4 };
const ORD = { prima: 0, seconda: 1, terza: 2, quarta: 3, quinta: 4, sesta: 5 };

function scopeIndexes(before, total) {
  // Prende la frase di «ambito» più vicina che precede la tecnica nella stessa frase.
  const patterns = [
    { re: /ultim[ea]\s+(due|tre|quattro|\d)\s+serie/gi, f: (m) => { const n = NUM[m[1].toLowerCase()] || Number(m[1]) || 1; return range(Math.max(0, total - n), total); } },
    { re: /penultima\s+serie/gi, f: () => total >= 2 ? [total - 2] : [] },
    { re: /ultima\s+serie/gi, f: () => [total - 1] },
    { re: /(tutte\s+le\s+serie|ogni\s+serie|in\s+tutte)/gi, f: () => range(0, total) },
    { re: /\b(prima|seconda|terza|quarta|quinta|sesta)\s+serie/gi, f: (m) => { const i = ORD[m[1].toLowerCase()]; return i < total ? [i] : []; } },
    { re: /\b(\d)\s*[ªa°]\s*serie/gi, f: (m) => { const i = Number(m[1]) - 1; return i >= 0 && i < total ? [i] : []; } }
  ];
  let best = null;
  for (const p of patterns) for (const m of before.matchAll(p.re)) if (!best || m.index >= best.index) best = { index: m.index, sets: p.f(m) };
  return best ? best.sets : [total - 1];
}
function range(a, b) { const out = []; for (let i = a; i < b; i++) out.push(i); return out; }

function paramsFromSentence(t, s) {
  const sec = s.match(/(\d{1,3})\s*(?:"|”|″|''|sec(?:ondi)?\b)/i);
  const pct = s.match(/(\d{1,2})\s*%/);
  const volte = s.match(/\b(due|tre|quattro|[1-4])\s+volte/i);
  const recuperi = (s.match(/recuper/gi) || []).length;
  const out = { t };
  if (sec) out.pausa = Number(sec[1]);
  if (t === "stripping") {
    const scale = (s.match(/\bscal/gi) || []).length;
    out.blocchi = /tripl/i.test(s) ? 3 : /doppi/i.test(s) ? 2 : scale >= 2 ? scale : scale === 1 ? 1 : 2;
    if (pct) out.calo = Number(pct[1]);
  } else if (t === "drop") {
    out.blocchi = Math.max(1, recuperi);
  } else if (t === "interrotte") {
    const reps = s.match(/(\d{1,2})\s+ripetizioni/i);
    if (reps) out.reps = Number(reps[1]);
    out.blocchi = Math.max(1, recuperi || 2);
  } else if (t === "rest_pause") {
    out.blocchi = volte ? (NUM[volte[1].toLowerCase()] || Number(volte[1])) : 2;
  }
  return normalizzaTecnica(out);
}

/** Ricava le tecniche per serie dalla nota dell'esercizio. null se la nota non ne contiene. */
export function tecnicheDaNota(note, totalSets) {
  const total = Math.max(0, Math.trunc(Number(totalSets) || 0));
  const source = text(note);
  if (!total || !source) return null;
  const out = Array(total).fill(null);
  let found = false;
  const sentences = source.split(/(?<=[.!?;])\s+|\n+/);
  for (const sentence of sentences) {
    // Top set e bake off: la prima serie è il top set, le altre il bake off.
    if (/top\s*set/i.test(sentence) && /ba[ck]k?e?\s*off/i.test(sentence) && total >= 2) {
      out[0] = { t: "top" };
      for (let i = 1; i < total; i++) if (!out[i]) out[i] = { t: "bake_off" };
      found = true;
    }
    for (const k of KEYWORDS) {
      const m = sentence.match(k.re);
      if (!m) continue;
      if (/\b(non|niente|senza)\s+(fare\s+|usare\s+)?(lo\s+|il\s+|la\s+|le\s+)?$/i.test(sentence.slice(0, m.index))) continue;
      const tec = paramsFromSentence(k.t, sentence.slice(m.index));
      for (const i of scopeIndexes(sentence.slice(0, m.index), total)) {
        const prev = out[i];
        out[i] = prev && !TECNICHE[prev.t].catena ? { ...tec, etichetta: `${TECNICHE[prev.t].nome} + ${TECNICHE[tec.t].nome.toLowerCase()}` } : tec;
      }
      found = true;
    }
  }
  return found ? out : null;
}

/** Tecniche risolte per un esercizio della scheda cliente: esplicite > nota > campo `prog` sull'ultima serie. */
export function tecnicheEsercizio(ex) {
  const total = Math.max(0, Math.trunc(Number(ex?.serie) || 0));
  if (!total || ex?.cardio || ex?.timed) return null;
  if (Array.isArray(ex.tecniche) && ex.tecniche.some(Boolean)) {
    const out = Array.from({ length: total }, (_, i) => normalizzaTecnica(ex.tecniche[i]));
    return out.some(Boolean) ? out : null;
  }
  const fromNote = tecnicheDaNota(ex.note, total);
  if (fromNote) return fromNote;
  if (["stripping", "drop", "interrotte"].includes(ex.prog)) {
    const out = Array(total).fill(null);
    out[total - 1] = normalizzaTecnica(ex.prog);
    return out;
  }
  return null;
}

/** Stesso esercizio in righe consecutive dello stesso gruppo = multiserie (come in CoachPlus). */
export function gruppoMultiserie(group) {
  if (!Array.isArray(group) || group.length < 2) return false;
  const first = normName(group[0]?.nome);
  return Boolean(first) && group.every((ex) => normName(ex?.nome) === first);
}

/** Prepara la scheda per l'app cliente: riconosce le multiserie e risolve le tecniche per serie. */
export function preparaTecniche(program) {
  const weeks = program?.settimane || program?.weeks;
  if (!Array.isArray(weeks)) return program;
  for (const week of weeks) for (const day of (week?.giorni || week?.days || [])) {
    const list = Array.isArray(day?.esercizi) ? day.esercizi : null;
    if (!list) continue;
    for (let i = 0; i < list.length;) {
      const ex = list[i];
      let j = i + 1;
      if (ex?.ss) while (j < list.length && list[j]?.ss === ex.ss) j++;
      const group = list.slice(i, j);
      const multi = ex?.ssType === "multiset" || (group.length > 1 && gruppoMultiserie(group));
      group.forEach((item, k) => {
        if (!item || typeof item !== "object") return;
        if (multi) { item.ssType = "multiset"; item.ms = k + 1; }
        else delete item.ms;
        const tec = tecnicheEsercizio(item);
        // Testo e passi già pronti: l'app cliente (script classico) li legge senza ricalcolarli.
        if (tec) item.tecniche = tec.map((x) => x && { ...x, testo: etichettaTecnica(x), passi: passiTecnica(x) });
        else delete item.tecniche;
      });
      i = j;
    }
  }
  return program;
}
