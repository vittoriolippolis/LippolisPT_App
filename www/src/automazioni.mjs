// Impostazioni del PT: messaggi automatici in chat e app cliente.
// Modulo puro: lo usano il pannello coach e i test; il motore che invia i messaggi è nel database
// (private.run_automations, ogni 15 minuti) e legge esattamente questa struttura.

export const SEGNAPOSTI = Object.freeze(["{nome}", "{scheda}", "{mancano}", "{fatti}", "{totali}"]);

export const AUTOMAZIONI_PREDEFINITE = Object.freeze({
  fascia: { da: 8, a: 21 },
  benvenuto: { attiva: false, testo: "Ciao {nome}, benvenuto nell'app LIPPOLIS PT! Qui trovi la tua scheda, i consigli alimentari e la chat con me: per qualsiasi dubbio scrivimi qui." },
  fineScheda: { attiva: false, allenamenti: 3, testo: "Ciao {nome}, ti mancano {mancano} allenamenti alla fine della scheda «{scheda}». Preparami il check così imposto la prossima." },
  compleanno: { attiva: false, testo: "Buon compleanno {nome}! Goditi la giornata." },
  avanzamento: { attiva: false, testo50: "{nome}, sei a metà della scheda «{scheda}»: {fatti} allenamenti su {totali}. Continua così!", testo100: "{nome}, hai completato tutta la scheda «{scheda}». Ottimo lavoro!" }
});

// Sezioni dell'app cliente che il PT può nascondere (Workout e Profilo restano sempre).
export const SEZIONI_APP = Object.freeze([
  ["consigli", "Consigli alimentari"], ["chat", "Chat con il coach"], ["storico", "Storico pesi"], ["metriche", "Metriche"],
  ["progressi", "Progressi fisici"], ["documenti", "Documenti"], ["questionari", "Questionari"], ["agenda", "Agenda"], ["abbonamenti", "Abbonamenti"]
]);
export const APP_PREDEFINITA = Object.freeze({ sezioni: {}, dataAllenamento: false, nascondiMacro: false });

const text = (value, max = 1000) => String(value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);
const ora = (value, fallback) => { const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.min(24, Math.max(0, n)) : fallback; };

export function normalizzaAutomazioni(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  const d = AUTOMAZIONI_PREDEFINITE;
  const blocco = (key, extra = {}) => ({ attiva: src[key]?.attiva === true, ...extra });
  let da = ora(src.fascia?.da, d.fascia.da), a = ora(src.fascia?.a, d.fascia.a);
  if (a <= da) { da = d.fascia.da; a = d.fascia.a; }
  const n = Math.round(Number(src.fineScheda?.allenamenti));
  return {
    fascia: { da, a },
    benvenuto: blocco("benvenuto", { testo: text(src.benvenuto?.testo) || d.benvenuto.testo }),
    fineScheda: blocco("fineScheda", { allenamenti: Number.isFinite(n) ? Math.min(20, Math.max(1, n)) : d.fineScheda.allenamenti, testo: text(src.fineScheda?.testo) || d.fineScheda.testo }),
    compleanno: blocco("compleanno", { testo: text(src.compleanno?.testo) || d.compleanno.testo }),
    avanzamento: blocco("avanzamento", { testo50: text(src.avanzamento?.testo50) || d.avanzamento.testo50, testo100: text(src.avanzamento?.testo100) || d.avanzamento.testo100 })
  };
}

export function normalizzaApp(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  const sezioni = {};
  for (const [key] of SEZIONI_APP) if (src.sezioni?.[key] === false) sezioni[key] = false;
  return { sezioni, dataAllenamento: src.dataAllenamento === true, nascondiMacro: src.nascondiMacro === true };
}

/** Anteprima del messaggio con dati d'esempio (stesse sostituzioni del database). */
export function anteprimaTesto(template, valori = {}) {
  const v = { nome: "Marika", scheda: "Marika Cardano - 9° livello", mancano: 3, fatti: 9, totali: 18, ...valori };
  return String(template ?? "").replaceAll("{nome}", v.nome).replaceAll("{scheda}", v.scheda)
    .replaceAll("{mancano}", String(v.mancano)).replaceAll("{fatti}", String(v.fatti)).replaceAll("{totali}", String(v.totali)).trim();
}

export const NOMI_AUTOMAZIONI = Object.freeze({ benvenuto: "Benvenuto", fine_scheda: "Fine scheda", compleanno: "Compleanno", avanzamento: "Avanzamento scheda" });
