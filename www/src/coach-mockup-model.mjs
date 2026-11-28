import { convertLegacyProgram, validateV2Program } from "./workout-metrics.mjs";
import { parseExerciseVideo } from "./exercise-video.mjs";
import { normalizzaTecnica } from "./tecniche.mjs";

const clone = (value) => structuredClone(value);
const clean = (value) => String(value ?? "").trim();
const secs = (value) => {
  const parts = clean(value).split(":").map(Number);
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
};
const textReps = (s) => s?.reps_mode === "amrap" ? "AMRAP" : s?.reps_mode === "time" ? `${Math.floor((s.reps_min || 0) / 60)}:${String((s.reps_min || 0) % 60).padStart(2, "0")}` : s?.reps_min == null ? "" : s.reps_max !== s.reps_min ? `${s.reps_min}-${s.reps_max}` : String(s.reps_min);
const textLoad = (s) => s?.load_unit === "bodyweight" ? "PC" : s?.load_note || (s?.load_value != null ? String(s.load_value) + (String(s.load_unit).startsWith("percent") ? "%" : "") : "");

// Tecnica scelta nel builder ({t, serie}) → indici delle serie a cui si applica.
export function serieTecnica(scope, total) {
  const n = Math.max(0, Number(total) || 0);
  if (!n) return [];
  if (scope === "tutte") return Array.from({ length: n }, (_, i) => i);
  if (scope === "prima") return [0];
  if (scope === "ultime2") return n >= 2 ? [n - 2, n - 1] : [n - 1];
  const index = Number(scope);
  if (Number.isInteger(index) && index >= 1 && index <= n) return [index - 1];
  return [n - 1];
}
// Applica la tecnica del builder alle righe v2: «top_bake» = top set sulla prima, bake off sulle altre.
export function applicaTecnica(sets, tecnica) {
  sets.forEach((set) => { delete set.technique; });
  const t = tecnica?.t;
  if (!t) return sets;
  if (t === "top_bake") {
    sets.forEach((set, i) => { set.technique = { t: i === 0 ? "top" : "bake_off" }; });
    return sets;
  }
  const tec = normalizzaTecnica(tecnica);
  if (!tec) return sets;
  for (const i of serieTecnica(tecnica.serie, sets.length)) sets[i].technique = { ...tec };
  return sets;
}
// Righe v2 → scelta del builder (la più comune: una tecnica sulle serie indicate).
export function tecnicaDaSerie(sets) {
  const rows = Array.isArray(sets) ? sets : [];
  const marked = rows.map((set, i) => set?.technique?.t ? i : -1).filter((i) => i >= 0);
  if (!marked.length) return null;
  const types = rows.map((set) => set?.technique?.t || "");
  if (types[0] === "top" && types.slice(1).every((x) => x === "bake_off")) return { t: "top_bake" };
  const tec = normalizzaTecnica(rows[marked[0]].technique);
  if (!tec) return null;
  const n = rows.length;
  const serie = marked.length === n ? "tutte" : marked.length === 1 && marked[0] === n - 1 ? "ultima" : marked.length === 1 && marked[0] === 0 ? "prima"
    : marked.length === 2 && marked[0] === n - 2 && marked[1] === n - 1 ? "ultime2" : String(marked[0] + 1);
  return { ...tec, serie };
}

export function mockupToProgram(template, dates) {
  const { dal, al } = dates;
  const weeks = template.weeks || [];
  const program = convertLegacyProgram({
    nome: clean(template.nome), dal, al,
    settimane: weeks.map((week, wi) => ({
      n: wi + 1, fase: clean(week.nome),
      giorni: (week.giorni || []).map((day) => ({
        titolo: clean(day.nome), dt: clean(day.giorno), giorno_settimana: Number(day.giorno) || null,
        esercizi: (day.esercizi || []).map((exercise) => ({
          nome: clean(exercise.nome), serie: Number(exercise.serie),
          reps: exercise.tipo === "tempo" ? (secs(exercise.rip) > 0 ? `${secs(exercise.rip)}s` : "") : clean(exercise.rip),
          rec: clean(exercise.rec), rir: clean(exercise.rir), tempo: clean(exercise.tut),
          carico: clean(exercise.carico), muscolo: clean(exercise.muscolo), note: clean(exercise.note),
          video_ref: clean(exercise.video), instructions: clean(exercise.descrizione), videoStoragePath: clean(exercise.videoStoragePath)
        }))
      }))
    }))
  });
  delete program.legacyBackup;
  program.legacyFields = { mockupId: template.id || null, livello: clean(template.livello), tipologia: clean(template.tipologia), descrizione: clean(template.descrizione) };
  weeks.forEach((week, wi) => (week.giorni || []).forEach((day, di) => {
    const target = program.settimane[wi].giorni[di];
    target.weekday = Number(day.giorno) || null;
    const inputs = day.esercizi || [];
    const blocks = [];
    for (let i = 0; i < inputs.length; i++) {
      const original = inputs[i], block = target.blocks[i], exercise = block.exercises[0];
      if (!clean(original.nome) || !Number.isInteger(Number(original.serie)) || Number(original.serie)<1 || Number(original.serie)>100) throw new Error(`Settimana ${wi+1}, ${day.nome}: inserisci nome e numero di serie per ogni esercizio.`);
      exercise.instructions = clean(original.descrizione);
      exercise.client_note = clean(original.note);
      block.client_note = "";
      exercise.video_ref = clean(original.video) || null;
      if (exercise.video_ref && !parseExerciseVideo(exercise.video_ref)) throw new Error(`Video non valido: ${original.nome}`);
      exercise.legacyFields = { videoStoragePath: clean(original.videoStoragePath), alternativa: original.link === "alternativa" };
      if (original._advanced?.sets && original._advanced.signature === exerciseSignature(original)) exercise.sets = clone(original._advanced.sets);
      else exercise.sets.forEach((set) => { set.effort_by_feel = !clean(original.carico); set.client_note = ""; });
      applicaTecnica(exercise.sets, original.tecnica);
      if (original.link === "multiserie" && blocks.length) {
        // Multiserie: stesso esercizio in più righe, ognuna con serie, ripetizioni e recupero propri.
        const previous = blocks.at(-1);
        previous.method = "multiset";
        exercise.position = previous.exercises.length + 1; previous.exercises.push(exercise);
      } else if (original.link === "superserie" && blocks.length) {
        const previous = blocks.at(-1);
        previous.method = original._advanced?.method==="circuit" ? "circuit" : previous.exercises.length>=2 ? "giant_set" : "superset";
        exercise.position = previous.exercises.length + 1; previous.exercises.push(exercise);
      } else {
        block.position = blocks.length + 1;
        if (original._advanced?.method && !["superset","giant_set","multiset","circuit"].includes(original._advanced.method)) block.method = original._advanced.method;
        blocks.push(block);
      }
    }
    target.blocks = blocks;
  }));
  const checked = validateV2Program(program,{forPublish:true});
  if (!checked.valid) throw new Error(checked.errors[0]?.message || "Controlla date e prescrizioni.");
  return checked.program;
}

function exerciseSignature(e) { return JSON.stringify([e.serie,e.tipo,e.rip,e.rec,e.rir,e.tut,e.carico]); }

export function programToMockup(input, id) {
  const program=convertLegacyProgram(input);
  const weeks=program.settimane.map((week, i)=>({
    nome: clean(week.fase) || `Settimana ${i+1}`,
    giorni: week.giorni.map((day, di)=>({
      nome: day.title || `Allenamento ${di+1}`, giorno: String(day.weekday || ((di%7)+1)),
      esercizi: day.blocks.flatMap((block)=>block.exercises.map((exercise, ei)=>{
        const first=exercise.sets.find(s=>s.set_type!=="warmup") || exercise.sets[0];
        const item={ nome:exercise.name, muscolo:(exercise.primary_muscles||[]).join(" · "), serie:String(exercise.sets.length),
          tipo:first?.reps_mode==="time"?"tempo":"ripetizioni", rip:textReps(first),
          rec:first?.rest_seconds==null?"":`${String(Math.floor(first.rest_seconds/60)).padStart(2,"0")}:${String(first.rest_seconds%60).padStart(2,"0")}`,
          rir:first?.target_rir==null?"":String(first.target_rir), tut:first?.tempo||"", carico:textLoad(first), note:exercise.client_note ?? (block.client_note || first?.client_note || ""),
          descrizione:exercise.instructions||"", video:exercise.video_ref||"", videoStoragePath:exercise.legacyFields?.videoStoragePath||"",
          link:exercise.legacyFields?.alternativa?"alternativa":ei?(block.method==="multiset"?"multiserie":"superserie"):undefined };
        const tecnica=tecnicaDaSerie(exercise.sets);
        if(tecnica) item.tecnica=tecnica;
        item._advanced={sets:clone(exercise.sets),method:block.method,signature:exerciseSignature(item)};
        return item;
      }))
    }))
  }));
  return {id:id||crypto.randomUUID(),nome:program.nome,livello:program.legacyFields?.livello||"",tipologia:program.legacyFields?.tipologia||"",descrizione:program.legacyFields?.descrizione||"",dal:program.dal,al:program.al,weeks:weeks.length?weeks:[{nome:"Settimana 1",giorni:[]}],viewMode:"col",clienti:0};
}

export function nutritionSummary(plan) {
  return {
    title: clean(plan.nome).slice(0,120),
    notes: clean(plan.descrizione).slice(0,4000),
    meals: (plan.giorni || []).slice(0,12).map((day,index)=>({
      label:(clean(day.nome)||`Giorno ${index+1}`).slice(0,80),
      text:[clean(day.note),...(day.pasti||[]).map(meal=>`${clean(meal.tipo)}: ${(meal.items||[]).map(item=>[clean(item.nome),item.g?`${item.g} g`:""].filter(Boolean).join(" ")).join(", ")}`)].filter(Boolean).join("\n").slice(0,2000)
    })).filter(item=>item.text)
  };
}

export function athleteWeightHistory(snapshot = {}) {
  const timestamp = value => {
    if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
    const ms = typeof value === "string" && !/^\d+$/.test(value) ? Date.parse(value) : Number(value);
    return ms > 0 && Number.isFinite(new Date(ms).getTime()) ? ms : null;
  };
  const number = value => {
    if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
    const result = Number(String(value).replace(",", "."));
    return Number.isFinite(result) && result >= 0 ? result : null;
  };
  const list = value => Array.isArray(value) ? value : [];
  const newestFirst = (a, b) => b.ts - a.ts;
  const weighIns = list(snapshot.pesi).map(item => ({ ts: timestamp(item?.ts), v: number(item?.v) }))
    .filter(item => item.ts !== null && item.v > 0)
    .sort(newestFirst);

  const sessions = list(snapshot.sessioni).map(session => ({ ...session, ts: timestamp(session?.ts) }))
    .filter(session => session.ts !== null).sort(newestFirst);
  const exercises = new Map();
  for (const session of sessions) {
    for (const exercise of list(session.esercizi)) {
      const name = clean(exercise?.nome);
      if (!name) continue;
      const unit = exercise.unita === "sec" ? "sec" : "reps";
      const perSide = exercise.perLato === true;
      const sides = new Map();
      const sets = list(exercise.sets).flatMap((set, index) => {
        const kg = number(set?.kg), reps = number(set?.reps), rir = number(set?.rir);
        if (kg === null && reps === null && rir === null) return [];
        const slot = Number.isInteger(set.slot) && set.slot >= 0 ? set.slot : null;
        const side = clean(exercise.lati?.[index]);
        const sideCount = (sides.get(side) || 0) + 1;
        sides.set(side, sideCount);
        const series = side ? `${slot===null ? sideCount : Math.floor(slot / 2) + 1} ${side}` : String((slot??index) + 1);
        const row = { series, kg, reps, rir };
        if (clean(set?.kgTesto)) row.kgText = clean(set.kgTesto);
        if (clean(set?.repsTesto)) row.repsText = clean(set.repsTesto);
        return [row];
      });
      if (!sets.length) continue;
      const key = JSON.stringify([name.toLocaleLowerCase("it"), unit, perSide]);
      if (!exercises.has(key)) exercises.set(key, { key, name, unit, perSide, entries: [] });
      exercises.get(key).entries.push({
        ts: session.ts, title: clean(session.titolo), program: clean(session.prog), sets
      });
    }
  }
  return { weighIns, exercises: [...exercises.values()].sort((a, b) => a.name.localeCompare(b.name, "it")) };
}

// Elenco delle programmazioni del cliente, come in CoachPlus: in corso e concluse.
// Unisce le schede pubblicate nell'app con i programmi che compaiono solo nello storico
// allenamenti (livelli fatti su CoachPlus o col vecchio APK).
export function clientProgramList({ snapshot = {}, active = null, versions = [], today = new Date().toISOString().slice(0, 10) } = {}) {
  const list = value => Array.isArray(value) ? value : [];
  const day = ts => new Date(ts).toISOString().slice(0, 10);
  const key = name => clean(name).toLocaleLowerCase("it");
  const sessions = list(snapshot.sessioni).filter(s => s && Number.isFinite(Number(s.ts)) && list(s.esercizi).length);
  const byProgram = new Map();
  for (const s of sessions) {
    const k = key(s.prog);
    if (!k) continue;
    if (!byProgram.has(k)) byProgram.set(k, { name: clean(s.prog), sessions: [] });
    byProgram.get(k).sessions.push(s);
  }
  const rows = [], seen = new Set();
  const published = [...(active ? [{ ...active, id: active.version_id, isActive: true }] : []),
    ...list(versions).filter(v => v && v.id !== active?.version_id)];
  for (const item of published) {
    const p = item.program || {}, name = clean(p.nome || p.name), k = key(name);
    if (!name || seen.has(item.id)) continue;
    seen.add(item.id);
    const start = clean(p.dal || p.startDate), end = clean(p.al || p.endDate);
    const inRange = s => (!start || day(s.ts) >= start) && (!end || day(s.ts) <= end);
    const group = byProgram.get(k);
    const done = (group?.sessions || []).filter(inRange).length;
    if (group) group.sessions = group.sessions.filter(s => !inRange(s));
    const weeks = list(p.settimane);
    const expected = weeks.reduce((sum, w) => sum + list(w.giorni).length, 0) || null;
    const elapsed = weeks.filter(w => clean(w.al) && clean(w.al) < today).reduce((sum, w) => sum + list(w.giorni).length, 0);
    const ongoing = !!item.isActive && (!end || end >= today);
    const due = ongoing ? elapsed : expected;
    rows.push({ id: item.id, name, start, end, ongoing, published: true, item,
      done, expected, skipped: due === null ? null : Math.max(0, due - done) });
    if (group && !group.sessions.length) byProgram.delete(k);
  }
  for (const { name, sessions: own } of byProgram.values()) {
    const times = own.map(s => Number(s.ts));
    rows.push({ id: null, name, start: day(Math.min(...times)), end: day(Math.max(...times)), ongoing: false, published: false,
      item: null, done: own.length, expected: null, skipped: null });
  }
  const newestFirst = (a, b) => (b.start || "").localeCompare(a.start || "") || b.name.localeCompare(a.name, "it", { numeric: true });
  return { inCorso: rows.filter(r => r.ongoing).sort(newestFirst), concluse: rows.filter(r => !r.ongoing).sort(newestFirst) };
}

// Sedute registrate, dalla più recente, con le serie di ogni esercizio (per «Storico pesi → Sessioni»).
export function athleteSessions(snapshot = {}) {
  const list = value => Array.isArray(value) ? value : [];
  const num = value => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(String(value).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };
  return list(snapshot.sessioni).filter(s => s && Number.isFinite(Number(s.ts))).map(s => ({
    id: clean(s.id), ts: Number(s.ts), title: clean(s.titolo) || "Seduta", program: clean(s.prog), week: num(s.settimana), note: clean(s.nota),
    exercises: list(s.esercizi).map(e => ({
      name: clean(e?.nome), unit: e?.unita === "sec" ? "sec" : "reps", note: clean(e?.note),
      sets: (() => { const sides = new Map();
        return list(e?.sets).map((set, i) => { const side = clean(e.lati?.[i]); const n = (sides.get(side) || 0) + 1; sides.set(side, n);
          const row = { series: side ? `${n} ${side}` : String(i + 1), kg: num(set?.kg), reps: num(set?.reps), rir: num(set?.rir) };
          if (clean(set?.kgTesto)) row.kgText = clean(set.kgTesto);
          if (clean(set?.repsTesto)) row.repsText = clean(set.repsTesto);
          return row; })
          .filter(x => x.kg !== null || x.reps !== null); })()
    })).filter(e => e.name && e.sets.length)
  })).filter(s => s.exercises.length).sort((a, b) => b.ts - a.ts);
}
