import { EXERCISE_VIDEO_ERROR, parseExerciseVideo } from "./exercise-video.mjs";

export const PROGRAM_SCHEMA_VERSION = 2;

export const DEFAULT_WORKOUT_SETTINGS = Object.freeze({
  secondsPerRep: 3,
  amrapReps: 10,
  setupSeconds: 45,
  equipmentChangeSeconds: 30,
  secondaryMuscleWeight: 0.5,
  usefulSetWeights: Object.freeze({ working: 1, top: 1, back_off: 1, drop: 1, mini_set: 1, cluster_group: 1, failure: 1, warmup: 0 })
});

export const DEFAULT_VOLUME_RANGES = Object.freeze({
  petto: { min: 10, max: 20 }, schiena: { min: 10, max: 20 }, spalle: { min: 6, max: 16 },
  bicipiti: { min: 6, max: 16 }, tricipiti: { min: 6, max: 16 }, quadricipiti: { min: 8, max: 18 },
  femorali: { min: 6, max: 16 }, glutei: { min: 6, max: 18 }, polpacci: { min: 4, max: 14 }, addome: { min: 4, max: 14 }
});

const V2_METHODS = new Set(["straight", "superset", "giant_set", "multiset", "drop_set", "rest_pause", "cluster", "myo_reps", "top_back_off", "eccentric", "isometric", "circuit"]);
const SET_TYPES = new Set(["warmup", "working", "top", "back_off", "drop", "mini_set", "cluster_group", "failure"]);

function clone(value) { return structuredClone(value ?? {}); }
function makeId(prefix = "id") { return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
function toText(value) { return String(value ?? "").trim(); }
function numberOrNull(value) { if (value === "" || value == null) return null; const n = Number(String(value).replace(",", ".")); return Number.isFinite(n) ? n : null; }
const DAY_MS = 86400000;
export function calendarDay(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match, year = Number(yearText), month = Number(monthText), day = Number(dayText);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0); date.setUTCHours(0, 0, 0, 0); date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.floor(date.getTime() / DAY_MS);
}
export function formatCalendarDay(dayNumber) { return new Date(Number(dayNumber) * DAY_MS).toISOString().slice(0, 10); }
function validDate(value) { return calendarDay(value) !== null; }
function dateMs(value) { return calendarDay(value); }
function isoDate(dayNumber) { return formatCalendarDay(dayNumber); }
function dateRange(program, index) {
  const week = program.settimane[index] || {};
  const from = week.dal || week.startDate;
  const to = week.al || week.endDate;
  const manualFlag = typeof week.dates_are_manual === "boolean" ? week.dates_are_manual : typeof week.datesAreManual === "boolean" ? week.datesAreManual : null;
  const manual = manualFlag ?? (validDate(from) && validDate(to));
  if (manual) return { dal: validDate(from) ? from : "", al: validDate(to) ? to : "", manual: true };
  const start = dateMs(program.dal || program.startDate), end = dateMs(program.al || program.endDate);
  if (start == null || end == null) return { dal: "", al: "", manual: false };
  const weekStart = start + index * 7;
  if (weekStart > end) return { dal: "", al: "", manual: false };
  return { dal: isoDate(weekStart), al: isoDate(Math.min(weekStart + 6, end)), manual: false };
}
function parseReps(value) {
  const text = toText(value).toUpperCase().replace(/–|—/g, "-");
  if (/^(AMRAP|CEDIMENTO|MAX)$/.test(text)) return { min: null, max: null, mode: "amrap", text };
  const time = text.match(/^(\d+(?:[.,]\d+)?)\s*(?:S|SEC|SECONDI?)$/);
  if (time) { const n = numberOrNull(time[1]); return { min: n, max: n, mode: "time", text }; }
  const range = text.match(/^(\d+(?:[.,]\d+)?)\s*(?:-|A)\s*(\d+(?:[.,]\d+)?)$/);
  if (range) return { min: numberOrNull(range[1]), max: numberOrNull(range[2]), mode: "range", text };
  const single = numberOrNull(text);
  if (single != null) return { min: single, max: single, mode: "range", text };
  return { min: null, max: null, mode: "range", text };
}
function parseLoad(value) {
  const text = toText(value);
  if (!text) return { value: null, unit: "kg", note: "" };
  if (/^(PC|BW|BODY\s*WEIGHT|CORPO\s*LIBERO)$/i.test(text)) return { value: null, unit: "bodyweight", note: "" };
  const percent = text.match(/^([+-]?\d+(?:[.,]\d+)?)\s*%$/);
  if (percent) {
    const n = numberOrNull(percent[1]);
    return { value: n, unit: n < 0 ? "percent_of_top" : "percent_1rm", note: "" };
  }
  const mass = text.match(/^([+-]?\d+(?:[.,]\d+)?)\s*(?:KG)?$/i);
  if (mass) return { value: numberOrNull(mass[1]), unit: "kg", note: "" };
  return { value: null, unit: "kg", note: text };
}
function parseRest(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const text = toText(value).toLowerCase();
  if (!text) return null;
  const clock = text.match(/^(\d+):(\d{1,2})$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const minutes = text.match(/^(\d+(?:[.,]\d+)?)\s*(?:m|min|mins|minute?)$/);
  if (minutes) return Math.round(Number(minutes[1].replace(",", ".")) * 60);
  const seconds = text.match(/^(\d+(?:[.,]\d+)?)\s*(?:s|sec|secondi?)?$/);
  return seconds ? Math.round(Number(seconds[1].replace(",", "."))) : null;
}
function legacySet(exercise, index, total) {
  const reps = parseReps(exercise.reps ?? exercise.ripetizioni ?? "");
  const load = parseLoad(exercise.carico ?? exercise.load ?? "");
  const rest = parseRest(exercise.rec ?? exercise.recupero ?? exercise.rest);
  return {
    id: makeId("set"), position: index + 1, set_type: "working", reps_min: reps.min, reps_max: reps.max,
    reps_mode: reps.mode, reps_text: reps.text, load_value: load.value, load_unit: load.unit, load_note: load.note,
    target_rir: numberOrNull(exercise.rir), tempo: toText(exercise.tempo) || null, rest_seconds: index === total - 1 ? rest : rest,
    intra_rest_seconds: null, parent_set_id: null, round: index + 1,
    client_note: toText(exercise.note), trainer_note: "", effort_by_feel: false
  };
}
function legacyExercise(exercise) {
  const total = Math.max(0, Math.min(100, Math.trunc(Number(exercise.serie ?? exercise.sets ?? 0) || 0)));
  return {
    id: makeId("exercise"), name: toText(exercise.nome || exercise.name) || "Esercizio senza nome",
    legacyFields: clone(exercise),
    primary_muscles: Array.isArray(exercise.primary_muscles) ? exercise.primary_muscles : [],
    secondary_muscles: Array.isArray(exercise.secondary_muscles) ? exercise.secondary_muscles : [],
    equipment: toText(exercise.equipment) || "", video_ref: exercise.video_ref || null,
    instructions: toText(exercise.instructions) || "", sets: Array.from({ length: total }, (_, index) => legacySet(exercise, index, total))
  };
}
function legacyDay(day, dayIndex) {
  const exercises = Array.isArray(day?.esercizi) ? day.esercizi : Array.isArray(day?.exercises) ? day.exercises : [];
  return {
    id: makeId("workout"), code: toText(day?.code || day?.dt) || String.fromCharCode(65 + dayIndex),
    legacyFields: clone(day || {}),
    title: toText(day?.titolo || day?.title || day?.nome) || `Giorno ${String.fromCharCode(65 + dayIndex)}`,
    weekday: day?.weekday ?? day?.giorno_settimana ?? null, day_code: toText(day?.dt) || String.fromCharCode(65 + dayIndex),
    muscle_focus: toText(day?.muscle_focus || day?.focus) || "", available_minutes: numberOrNull(day?.available_minutes),
    client_note: toText(day?.client_note) || "", trainer_note: toText(day?.trainer_note) || "",
    blocks: exercises.map((exercise, index) => ({
      id: makeId("block"), position: index + 1, method: "straight", rest_after_seconds: parseRest(exercise.rec ?? exercise.recupero ?? exercise.rest),
      client_note: toText(exercise.note), trainer_note: "", exercises: [legacyExercise(exercise)]
    }))
  };
}

export function convertLegacyProgram(input = {}) {
  if (Number(input.schemaVersion || input.schema_version) === PROGRAM_SCHEMA_VERSION && Array.isArray(input.settimane)) {
    const program = clone(input);
    program.nome = toText(program.nome || program.name);
    program.dal = toText(program.dal || program.startDate);
    program.al = toText(program.al || program.endDate);
    program.scala_intensita = program.scala_intensita || program.intensity_scale || "RIR";
    program.intensity_scale = program.scala_intensita;
    program.periodizzazione = program.periodizzazione || program.periodization || "linear";
    program.periodization = program.periodizzazione;
    program.settings = { ...DEFAULT_WORKOUT_SETTINGS, ...(program.settings || {}) };
    program.volume_ranges = { ...DEFAULT_VOLUME_RANGES, ...(program.volume_ranges || {}) };
    program.progression_rules = Array.isArray(program.progression_rules) ? program.progression_rules : [];
    return program;
  }
  const source = clone(input), weeks = Array.isArray(source.settimane) ? source.settimane : Array.isArray(source.weeks) ? source.weeks : [];
  const program = {
    schemaVersion: PROGRAM_SCHEMA_VERSION, nome: toText(source.nome || source.name), dal: toText(source.dal || source.startDate),
    al: toText(source.al || source.endDate), scala_intensita: source.scala_intensita === "RPE" || source.intensity_scale === "RPE" ? "RPE" : "RIR",
    periodizzazione: source.periodizzazione || source.periodization || "linear", settings: { ...DEFAULT_WORKOUT_SETTINGS, ...(source.settings || {}) },
    progression_rules: Array.isArray(source.progression_rules) ? source.progression_rules : [],
    volume_ranges: { ...DEFAULT_VOLUME_RANGES, ...(source.volume_ranges || {}) },
    settimane: weeks.map((week, wi) => {
      const range = dateRange({ ...source, settimane: weeks }, wi);
      const days = Array.isArray(week?.giorni) ? week.giorni : Array.isArray(week?.days) ? week.days : [];
      const manual = week?.dates_are_manual === true || week?.datesAreManual === true || (validDate(week?.dal || week?.startDate) && validDate(week?.al || week?.endDate));
      return {
        id: week?.id || makeId("week"), n: Number(week?.n || week?.number || wi + 1), fase: toText(week?.fase || week?.phase),
        legacyFields: clone(week || {}),
        dal: manual ? toText(week.dal || week.startDate) : range.dal, al: manual ? toText(week.al || week.endDate) : range.al,
        dates_are_manual: manual, volume_target: numberOrNull(week?.volume_target), intensity_target: numberOrNull(week?.intensity_target),
        rule_note: toText(week?.rule_note || week?.ruleNote), giorni: days.map(legacyDay)
      };
    }),
    legacyBackup: source.legacyBackup || source
  };
  program.intensity_scale = program.scala_intensita;
  program.periodization = program.periodizzazione;
  return program;
}

const METHOD_ALIASES = Object.freeze({
  singolo: "straight", single: "straight", esercizio_singolo: "straight", superserie: "superset", super_set: "superset", multiserie: "multiset", multi_set: "multiset",
  giant: "giant_set", "giant set": "giant_set", dropset: "drop_set", "drop set": "drop_set",
  "rest-pause": "rest_pause", restpause: "rest_pause", "cluster set": "cluster", clusterset: "cluster",
  myoreps: "myo_reps", "myo-reps": "myo_reps", "top set + back-off": "top_back_off", "top+backoff": "top_back_off",
  eccentrica: "eccentric", isometrica: "isometric", circuito: "circuit"
});
function importedMethod(value) {
  const raw = toText(value).toLocaleLowerCase().replace(/[\s-]+/g, "_");
  return V2_METHODS.has(raw) ? raw : METHOD_ALIASES[toText(value).toLocaleLowerCase()] || "straight";
}
function importedSetType(value) {
  const raw = toText(value).toLocaleLowerCase().replace(/[\s-]+/g, "_");
  const aliases = { riscaldamento: "warmup", lavoro: "working", topset: "top", "top_set": "top", backoff: "back_off", "drop_set": "drop", minisets: "mini_set", gruppo: "cluster_group", cedimento: "failure" };
  const type = SET_TYPES.has(raw) ? raw : aliases[raw] || "working";
  return SET_TYPES.has(type) ? type : "working";
}
function importedExercise(raw = {}, position = 1) {
  const base = legacyExercise({ ...raw, serie: typeof raw.serie === "number" ? raw.serie : 0 });
  const rows = Array.isArray(raw.serie) ? raw.serie : Array.isArray(raw.sets) ? raw.sets : null;
  const sourceRows = rows || [];
  const sets = sourceRows.map((source, index) => {
    const row = source && typeof source === "object" ? source : { reps: source };
    const defaultReps = raw.reps ?? raw.ripetizioni ?? "";
    const reps = row.reps != null || row.ripetizioni != null || row.reps_min != null || row.reps_max != null
      ? parseReps(row.reps ?? row.ripetizioni ?? (row.reps_mode === "time" ? `${row.reps_min ?? row.reps_max}s` : row.reps_min != null ? `${row.reps_min}${row.reps_max != null && row.reps_max !== row.reps_min ? `-${row.reps_max}` : ""}` : ""))
      : parseReps(defaultReps);
    const load = row.load_value != null ? { value: numberOrNull(row.load_value), unit: row.load_unit || "kg", note: toText(row.load_note) } : parseLoad(row.carico ?? row.load ?? raw.carico ?? "");
    const explicitRir = numberOrNull(row.target_rir ?? raw.target_rir ?? row.rir ?? raw.rir);
    const explicitRpe = numberOrNull(row.rpe ?? raw.rpe);
    const storedRir = explicitRir != null ? explicitRir : explicitRpe == null ? null : 10 - explicitRpe;
    return {
      id: toText(row.id) || makeId("set"), position: index + 1, set_type: importedSetType(row.set_type || row.tipo || row.type),
      reps_min: row.reps_min != null ? numberOrNull(row.reps_min) : reps.min, reps_max: row.reps_max != null ? numberOrNull(row.reps_max) : reps.max,
      reps_mode: ["range", "amrap", "time"].includes(row.reps_mode) ? row.reps_mode : reps.mode, reps_text: reps.text,
      load_value: load.value, load_unit: load.unit, load_note: load.note, target_rir: storedRir,
      tempo: toText(row.tempo || row.tempo_esecuzione || raw.tempo) || null,
      rest_seconds: parseRest(row.rest_seconds ?? row.rec ?? row.recupero ?? raw.rec ?? raw.rest_seconds),
      intra_rest_seconds: parseRest(row.intra_rest_seconds ?? row.intra_rest), parent_set_id: row.parent_set_id || null,
      round: Number(row.round || row.giro || index + 1), client_note: toText(row.client_note || row.note || raw.note), trainer_note: toText(row.trainer_note),
      effort_by_feel: row.effort_by_feel === true || row.sforzo === "sensazione"
    };
  });
  return {
    ...base, id: toText(raw.id) || makeId("exercise"), position,
    name: toText(raw.nome || raw.name) || "Esercizio senza nome",
    primary_muscles: Array.isArray(raw.primary_muscles) ? raw.primary_muscles : Array.isArray(raw.muscoli_primari) ? raw.muscoli_primari : [],
    secondary_muscles: Array.isArray(raw.secondary_muscles) ? raw.secondary_muscles : Array.isArray(raw.muscoli_secondari) ? raw.muscoli_secondari : [],
    equipment: toText(raw.equipment || raw.attrezzo), avg_setup_seconds: numberOrNull(raw.avg_setup_seconds),
    video_ref: raw.video_ref || raw.video || null, instructions: toText(raw.instructions || raw.istruzioni || raw.note),
    client_note: raw.client_note == null ? undefined : toText(raw.client_note),
    sets: rows ? sets : base.sets
  };
}
function unknownImportWarnings(source) {
  const warnings = [];
  const known = {
    program: new Set(["schemaVersion", "schema_version", "nome", "name", "dal", "startDate", "al", "endDate", "settimane", "weeks", "scala_intensita", "intensity_scale", "periodizzazione", "periodization", "settings", "volume_ranges", "progression_rules", "legacyBackup", "calculated"]),
    week: new Set(["id", "n", "number", "fase", "phase", "dal", "startDate", "al", "endDate", "dates_are_manual", "datesAreManual", "volume_target", "intensity_target", "rule_note", "ruleNote", "giorni", "days"]),
    day: new Set(["id", "code", "day_code", "dt", "nome", "name", "titolo", "title", "weekday", "giorno_settimana", "muscle_focus", "focus", "available_minutes", "client_note", "trainer_note", "esercizi", "exercises"]),
    exercise: new Set(["id", "nome", "name", "serie", "sets", "reps", "ripetizioni", "rec", "recupero", "rest_seconds", "carico", "load", "note", "client_note", "metodo", "method", "gruppo", "group", "rir", "rpe", "target_rir", "tempo", "tempo_esecuzione", "primary_muscles", "muscoli_primari", "secondary_muscles", "muscoli_secondari", "equipment", "attrezzo", "avg_setup_seconds", "video_ref", "video", "instructions", "istruzioni", "scala_intensita", "intensity_scale"]),
    set: new Set(["id", "tipo", "type", "set_type", "reps", "ripetizioni", "reps_min", "reps_max", "reps_mode", "carico", "load", "load_value", "load_unit", "load_note", "rir", "rpe", "target_rir", "tempo", "tempo_esecuzione", "rec", "recupero", "rest_seconds", "intra_rest", "intra_rest_seconds", "parent_set_id", "round", "giro", "note", "client_note", "trainer_note", "sforzo", "effort_by_feel"])
  };
  const inspect = (node, allowed, path) => { for (const key of Object.keys(node || {})) if (!allowed.has(key)) warnings.push({ path: path ? `${path}.${key}` : key, message: "Campo sconosciuto ignorato durante l’importazione." }); };
  inspect(source, known.program, "");
  const weeks = Array.isArray(source?.settimane) ? source.settimane : Array.isArray(source?.weeks) ? source.weeks : [];
  for (const [wi, week] of weeks.entries()) {
    if (!week || typeof week !== "object" || Array.isArray(week)) continue;
    inspect(week, known.week, `settimane[${wi}]`);
    const days = Array.isArray(week.giorni) ? week.giorni : Array.isArray(week.days) ? week.days : [];
    for (const [di, day] of days.entries()) {
      if (!day || typeof day !== "object" || Array.isArray(day)) continue;
      inspect(day, known.day, `settimane[${wi}].giorni[${di}]`);
      const exercises = Array.isArray(day.esercizi) ? day.esercizi : Array.isArray(day.exercises) ? day.exercises : [];
      for (const [ei, exercise] of exercises.entries()) {
        if (!exercise || typeof exercise !== "object" || Array.isArray(exercise)) continue;
        inspect(exercise, known.exercise, `settimane[${wi}].giorni[${di}].esercizi[${ei}]`);
        const rows = Array.isArray(exercise.serie) ? exercise.serie : Array.isArray(exercise.sets) ? exercise.sets : [];
        rows.forEach((row, si) => { if (row && typeof row === "object") inspect(row, known.set, `settimane[${wi}].giorni[${di}].esercizi[${ei}].serie[${si}]`); });
      }
    }
  }
  return warnings;
}

/** Imports legacy and unversioned enhanced JSON without silently dropping the
 * methods, set rows, intensity scale, or groupings supported by the brief.
 */
export function convertImportedProgram(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? clone(input) : {};
  if (Number(source.schemaVersion || source.schema_version) === PROGRAM_SCHEMA_VERSION && Array.isArray(source.settimane)) {
    const result = validateV2Program(source);
    return result;
  }
  const weeks = Array.isArray(source.settimane) ? source.settimane : Array.isArray(source.weeks) ? source.weeks : [];
  const structureErrors = [];
  weeks.forEach((week, wi) => {
    if (!week || typeof week !== "object" || Array.isArray(week)) { structureErrors.push({ path: `settimane[${wi}]`, message: "La settimana deve essere un oggetto JSON." }); return; }
    const days = Array.isArray(week.giorni) ? week.giorni : Array.isArray(week.days) ? week.days : null;
    if (!days) { structureErrors.push({ path: `settimane[${wi}].giorni`, message: "Inserisci l’elenco delle sedute della settimana." }); return; }
    days.forEach((day, di) => {
      if (!day || typeof day !== "object" || Array.isArray(day)) { structureErrors.push({ path: `settimane[${wi}].giorni[${di}]`, message: "La seduta deve essere un oggetto JSON." }); return; }
      const exercises = Array.isArray(day.esercizi) ? day.esercizi : Array.isArray(day.exercises) ? day.exercises : null;
      if (!exercises) { structureErrors.push({ path: `settimane[${wi}].giorni[${di}].esercizi`, message: "Inserisci l’elenco degli esercizi della seduta." }); return; }
      exercises.forEach((exercise, ei) => {
        if (!exercise || typeof exercise !== "object" || Array.isArray(exercise)) structureErrors.push({ path: `settimane[${wi}].giorni[${di}].esercizi[${ei}]`, message: "L’esercizio deve essere un oggetto JSON." });
      });
    });
  });
  if (structureErrors.length) return { program: null, errors: structureErrors, warnings: [], valid: false };
  const enhanced = weeks.some((week) => (Array.isArray(week.giorni) ? week.giorni : week.days).some((day) => (Array.isArray(day.esercizi) ? day.esercizi : day.exercises).some((exercise) => Array.isArray(exercise.serie) || Array.isArray(exercise.sets) || exercise.metodo || exercise.method || exercise.gruppo || exercise.group)));
  if (!enhanced) {
    const program = convertLegacyProgram({ ...source, nome: source.nome || source.name || "Scheda importata" });
    return { ...validateV2Program(program), warnings: unknownImportWarnings(source) };
  }
  const scale = source.scala_intensita || source.intensity_scale || "RIR";
  const program = {
    nome: toText(source.nome || source.name) || "Scheda importata", dal: toText(source.dal || source.startDate), al: toText(source.al || source.endDate),
    scala_intensita: scale === "RPE" ? "RPE" : "RIR", intensity_scale: scale === "RPE" ? "RPE" : "RIR",
    periodizzazione: source.periodizzazione || source.periodization || "linear", periodization: source.periodizzazione || source.periodization || "linear",
    settings: { ...DEFAULT_WORKOUT_SETTINGS, ...(source.settings || {}) }, volume_ranges: { ...DEFAULT_VOLUME_RANGES, ...(source.volume_ranges || {}) },
    progression_rules: Array.isArray(source.progression_rules) ? source.progression_rules : [], legacyBackup: source.legacyBackup || source,
    schemaVersion: PROGRAM_SCHEMA_VERSION,
    settimane: weeks.map((week, wi) => {
      const base = convertLegacyProgram({ ...source, settimane: [week] }).settimane[0];
      const weekRange = dateRange({ ...source, settimane: weeks }, wi);
      const days = week.giorni || week.days || [];
      return { ...base, dal: weekRange.dal, al: weekRange.al, dates_are_manual: weekRange.manual, n: Number(week.n || week.number || wi + 1), giorni: days.map((day, di) => {
        const rawExercises = day.esercizi || day.exercises || [], blocks = [], byGroup = new Map();
        let previousAutoGroup = "", autoGroupIndex = 0;
        rawExercises.forEach((exercise, ei) => {
          const method = importedMethod(exercise.metodo || exercise.method);
          const group = toText(exercise.gruppo || exercise.group);
          const groupedMethod = ["superset", "giant_set", "multiset", "circuit"].includes(method);
          let key;
          if (group) { key = `group:${group}:${method}`; previousAutoGroup = ""; }
          else if (groupedMethod) {
            if (!previousAutoGroup.startsWith(`method:${method}:`)) autoGroupIndex++;
            key = `method:${method}:${autoGroupIndex}`; previousAutoGroup = key;
          } else { key = `single:${ei}`; previousAutoGroup = ""; }
          let block = byGroup.get(key);
          if (!block) {
            block = { id: makeId("block"), position: blocks.length + 1, method, rest_after_seconds: parseRest(exercise.rest_seconds ?? exercise.rec ?? day.recupero) ?? 90, intra_rest_seconds: parseRest(exercise.intra_rest_seconds) ?? 20, client_note: "", trainer_note: "", exercises: [] };
            byGroup.set(key, block); blocks.push(block);
          }
          const converted = importedExercise(exercise, block.exercises.length + 1);
          if (["drop_set", "rest_pause", "cluster", "myo_reps"].includes(method)) {
            const chain = makeId("chain");
            if (converted.sets.some((row) => ["drop", "mini_set", "cluster_group"].includes(row.set_type))) converted.sets.forEach((row) => { row.parent_set_id ||= chain; });
          }
          block.exercises.push(converted);
          if (block.exercises.length === 1) block.client_note = toText(exercise.note);
        });
        return {
          id: toText(day.id) || makeId("workout"), code: toText(day.code || day.dt) || String.fromCharCode(65 + di),
          day_code: toText(day.day_code || day.dt) || String.fromCharCode(65 + di), title: toText(day.title || day.titolo || day.nome) || `Giorno ${String.fromCharCode(65 + di)}`,
          weekday: day.weekday ?? day.giorno_settimana ?? null, muscle_focus: toText(day.muscle_focus || day.focus),
          available_minutes: numberOrNull(day.available_minutes), client_note: toText(day.client_note), trainer_note: toText(day.trainer_note), blocks
        };
      }) };
    })
  };
  return { ...validateV2Program(program), warnings: unknownImportWarnings(source) };
}

export function repsForCalculation(set, settings = DEFAULT_WORKOUT_SETTINGS) {
  if (set.reps_mode === "time") return numberOrNull(set.reps_min ?? set.reps_max) || 0;
  if (set.reps_mode === "amrap" || set.set_type === "failure") return Number(settings.amrapReps || DEFAULT_WORKOUT_SETTINGS.amrapReps);
  const low = numberOrNull(set.reps_min), high = numberOrNull(set.reps_max);
  if (low == null || high == null) return null;
  return (low + high) / 2;
}
export function secondsPerRep(tempo, settings = DEFAULT_WORKOUT_SETTINGS) {
  const text = toText(tempo).toUpperCase();
  if (!text) return Number(settings.secondsPerRep || DEFAULT_WORKOUT_SETTINGS.secondsPerRep);
  const parts = text.split(/[-–]/);
  if (parts.length !== 4 || parts.some((part) => !/^(\d|X)$/.test(part.trim()))) return Number(settings.secondsPerRep || DEFAULT_WORKOUT_SETTINGS.secondsPerRep);
  return parts.reduce((sum, part) => sum + (part.trim() === "X" ? 1 : Number(part)), 0);
}
function usefulWeight(set, settings) {
  const type = SET_TYPES.has(set?.set_type) ? set.set_type : "working";
  const weight = settings.usefulSetWeights?.[type];
  return Number.isFinite(Number(weight)) ? Number(weight) : (type === "warmup" ? 0 : 1);
}
function workoutEntries(workout) {
  const blocks = Array.isArray(workout?.blocks) ? workout.blocks.slice().sort((a, b) => Number(a.position || 0) - Number(b.position || 0)) : [];
  const entries = [];
  for (const block of blocks) {
    const firstBlockEntry = entries.length;
    const exercises = Array.isArray(block.exercises) ? block.exercises.slice().sort((a, b) => Number(a.position || 0) - Number(b.position || 0)) : [];
    const circuit = ["superset", "giant_set", "circuit"].includes(block.method);
    if (circuit) {
      const rounds = Math.max(0, ...exercises.map((exercise) => exercise.sets?.length || 0));
      for (let round = 0; round < rounds; round++) for (const exercise of exercises) {
        const set = (exercise.sets || []).find((row, index) => Number(row.round || index + 1) === round + 1);
        if (set) entries.push({ block, exercise, set, round, groupEnd: exercise === exercises.at(-1), lastRound: round === rounds - 1 });
      }
    } else {
      for (const exercise of exercises) for (const [index, set] of (exercise.sets || []).entries()) entries.push({ block, exercise, set, round: index, groupEnd: true, lastRound: true });
    }
    if (entries.length > firstBlockEntry) entries[firstBlockEntry].blockFirst = true;
  }
  return entries;
}

export function calculateUsefulSets(workout, settings = DEFAULT_WORKOUT_SETTINGS) {
  return workoutEntries(workout).reduce((sum, entry) => sum + usefulWeight(entry.set, settings), 0);
}

export function estimateWorkout(workout, settings = DEFAULT_WORKOUT_SETTINGS) {
  const entries = workoutEntries(workout);
  if (!entries.some(({ set }) => usefulWeight(set, settings) > 0)) return { minutes: null, seconds: 0, estimatedReps: false, exceedsAvailability: false };
  let seconds = 0, previousExercise = null, previousEquipment = "", estimatedReps = false;
  entries.forEach((entry, index) => {
    const { block, exercise, set } = entry;
    const equipment = toText(exercise.equipment).toLocaleLowerCase();
    if (previousExercise !== exercise.id) {
      if (previousExercise !== null) seconds += Number(exercise.avg_setup_seconds ?? settings.setupSeconds ?? DEFAULT_WORKOUT_SETTINGS.setupSeconds);
      if (entry.blockFirst && previousEquipment && equipment && previousEquipment !== equipment) seconds += Number(settings.equipmentChangeSeconds ?? DEFAULT_WORKOUT_SETTINGS.equipmentChangeSeconds);
      previousExercise = exercise.id;
    }
    const reps = repsForCalculation(set, settings);
    if (reps == null) estimatedReps = true;
    else if (set.reps_mode === "amrap" || set.set_type === "failure") estimatedReps = true;
    seconds += set.reps_mode === "time" ? (reps ?? 0) : (reps ?? 0) * secondsPerRep(set.tempo, settings);

    const next = entries[index + 1];
    const related = set.parent_set_id && next?.set?.parent_set_id === set.parent_set_id;
    const dropChain = (set.set_type === "drop" || next?.set?.set_type === "drop") && (related || (next?.block?.id === block.id && next?.exercise?.id === exercise.id));
    const microMethod = ["rest_pause", "cluster", "myo_reps"].includes(block.method);
    if (microMethod && related) seconds += Number(set.intra_rest_seconds ?? block.intra_rest_seconds ?? 0);
    else if (dropChain) { /* nessun recupero fra drop successivi */ }
    else if (["superset", "giant_set", "circuit"].includes(block.method)) {
      if (entry.groupEnd && !entry.lastRound && next) seconds += Number(block.rest_after_seconds ?? set.rest_seconds ?? 0);
    } else if (next) seconds += Number(set.rest_seconds ?? 0);
    previousEquipment = equipment || previousEquipment;
  });
  const minutes = seconds > 0 ? Math.max(5, Math.round(seconds / 300) * 5) : 0;
  const available = numberOrNull(workout.available_minutes);
  return { minutes, seconds, estimatedReps, exceedsAvailability: available != null && minutes > available };
}

export function calculateAverageRir(workout, scale = "RIR", settings = DEFAULT_WORKOUT_SETTINGS) {
  const values = workoutEntries(workout).filter(({ set }) => set.set_type !== "warmup" && set.target_rir != null && Number.isFinite(Number(set.target_rir)) && usefulWeight(set, settings) > 0).map(({ set }) => Number(set.target_rir));
  if (!values.length) return { rir: null, display: null, scale: scale === "RPE" ? "RPE" : "RIR" };
  const rir = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { rir, display: scale === "RPE" ? 10 - rir : rir, scale: scale === "RPE" ? "RPE" : "RIR" };
}

const MUSCLE_ALIASES = Object.freeze({
  pettorale: "petto", pettorali: "petto", chest: "petto", pecs: "petto",
  dorsale: "schiena", dorsali: "schiena", "gran dorsale": "schiena", back: "schiena",
  deltoide: "spalle", deltoidi: "spalle", shoulder: "spalle", shoulders: "spalle",
  bicipite: "bicipiti", biceps: "bicipiti", tricipite: "tricipiti", triceps: "tricipiti",
  quadricipite: "quadricipiti", quad: "quadricipiti", quadriceps: "quadricipiti",
  femorale: "femorali", hamstring: "femorali", hamstrings: "femorali",
  gluteo: "glutei", calf: "polpacci", calves: "polpacci", polpaccio: "polpacci",
  abs: "addome", core: "addome"
});
export function normalizeMuscleName(value) {
  const key = toText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!key) return "";
  const canonical = MUSCLE_ALIASES[key] || key;
  return Object.keys(DEFAULT_VOLUME_RANGES).find((name) => name === canonical) || canonical;
}

export function calculateVolume(week, settings = DEFAULT_WORKOUT_SETTINGS, ranges = DEFAULT_VOLUME_RANGES) {
  const totals = {};
  const add = (value, amount) => {
    const muscle = normalizeMuscleName(value);
    if (muscle) totals[muscle] = (totals[muscle] || 0) + amount;
  };
  for (const workout of week?.giorni || []) for (const entry of workoutEntries(workout)) {
    if (usefulWeight(entry.set, settings) <= 0) continue;
    const primary = new Set((entry.exercise.primary_muscles || []).map(normalizeMuscleName).filter(Boolean));
    const secondary = new Set((entry.exercise.secondary_muscles || []).map(normalizeMuscleName).filter((muscle) => muscle && !primary.has(muscle)));
    for (const muscle of primary) add(muscle, usefulWeight(entry.set, settings));
    for (const muscle of secondary) add(muscle, usefulWeight(entry.set, settings) * Number(settings.secondaryMuscleWeight ?? DEFAULT_WORKOUT_SETTINGS.secondaryMuscleWeight));
  }
  const status = Object.fromEntries(Object.entries(totals).map(([muscle, total]) => {
    const normalizedRanges = Object.fromEntries(Object.entries(ranges).map(([key, value]) => [normalizeMuscleName(key), value]));
    const range = normalizedRanges[muscle] || null;
    return [muscle, { total, min: range?.min ?? null, max: range?.max ?? null, state: !range ? "unconfigured" : total < range.min ? "under" : total > range.max ? "over" : "in_range" }];
  }));
  return { totals, status };
}

export function calculateWeekBars(program, settings = DEFAULT_WORKOUT_SETTINGS) {
  const weeks = program?.settimane || [];
  const scale = program?.scala_intensita === "RPE" || program?.intensity_scale === "RPE" ? "RPE" : "RIR";
  const counts = weeks.map((week) => (week.giorni || []).reduce((sum, day) => sum + calculateUsefulSets(day, settings), 0));
  const maxCount = Math.max(0, ...counts);
  return weeks.map((week, index) => {
    const intensityValues = (week.giorni || []).flatMap((day) => workoutEntries(day)
      .filter(({ set }) => set.set_type !== "warmup" && set.target_rir != null && Number.isFinite(Number(set.target_rir)) && usefulWeight(set, settings) > 0)
      .map(({ set }) => 10 - Number(set.target_rir)));
    const meanRpe = intensityValues.length ? intensityValues.reduce((sum, value) => sum + value, 0) / intensityValues.length : null;
    const meanRir = meanRpe == null ? null : 10 - meanRpe;
    const meanIntensity = scale === "RPE" ? meanRpe : meanRir;
    const volumeTarget = numberOrNull(week.volume_target);
    const intensityTarget = numberOrNull(week.intensity_target);
    return {
      week: week.n || index + 1, usefulSets: counts[index],
      volume: volumeTarget != null ? Math.max(0, Math.min(1, counts[index] / Math.max(volumeTarget, 1))) : (maxCount ? counts[index] / maxCount : 0),
      intensity: intensityTarget != null ? Math.max(0, Math.min(1, intensityTarget / 10)) : (meanIntensity == null ? 0 : Math.max(0, Math.min(1, meanIntensity / 10))),
      meanRpe, meanRir, meanIntensity, scale
    };
  });
}

/** Deterministic values stored with the program. The server recalculates this
 * object on every draft save and publication; clients may use the same pure
 * function for immediate editor feedback, but never submit trusted totals.
 */
export function calculateProgramMetrics(input) {
  const program = convertLegacyProgram(input);
  const weeks = program.settimane || [];
  const weekBars = calculateWeekBars(program, program.settings);
  let totalUsefulSets = 0;
  let totalWorkouts = 0;
  const weekMetrics = weeks.map((week, index) => {
    const workouts = (week.giorni || []).map((workout) => {
      const usefulSets = calculateUsefulSets(workout, program.settings);
      const duration = estimateWorkout(workout, program.settings);
      const effort = calculateAverageRir(workout, program.scala_intensita || program.intensity_scale || "RIR", program.settings);
      const volume = calculateVolume({ giorni: [workout] }, program.settings, { ...DEFAULT_VOLUME_RANGES, ...(program.volume_ranges || {}) });
      totalUsefulSets += usefulSets;
      totalWorkouts += 1;
      return {
        id: workout.id || null,
        usefulSets,
        durationSeconds: duration.seconds,
        durationMinutes: duration.minutes,
        estimatedReps: duration.estimatedReps,
        exceedsAvailability: duration.exceedsAvailability,
        averageRir: effort.rir,
        averageIntensity: effort.display,
        intensityScale: effort.scale,
        volume: volume.totals
      };
    });
    const volume = calculateVolume(week, program.settings, { ...DEFAULT_VOLUME_RANGES, ...(program.volume_ranges || {}) });
    return {
      week: Number(week.n || index + 1),
      usefulSets: weekBars[index]?.usefulSets || 0,
      volumeBar: weekBars[index]?.volume || 0,
      intensityBar: weekBars[index]?.intensity || 0,
      averageRpe: weekBars[index]?.meanRpe ?? null,
      volume: volume.totals,
      volumeStatus: volume.status,
      workouts
    };
  });
  return {
    version: 1,
    intensityScale: program.scala_intensita || program.intensity_scale || "RIR",
    totals: { weeks: weeks.length, workouts: totalWorkouts, usefulSets: totalUsefulSets },
    weeks: weekMetrics
  };
}

function displayReps(set) {
  if (set.reps_mode === "amrap" || set.set_type === "failure") return "AMRAP";
  if (set.reps_mode === "time") return `${numberOrNull(set.reps_min ?? set.reps_max) ?? 0}s`;
  const min = numberOrNull(set.reps_min), max = numberOrNull(set.reps_max);
  if (min == null) return "";
  return max != null && max !== min ? `${min}-${max}` : String(min);
}
function displayLoad(set) {
  if (set.load_unit === "bodyweight") return "PC";
  if (set.load_unit === "percent_of_top") return `${numberOrNull(set.load_value) ?? 0}%`;
  if (set.load_unit === "percent_1rm") return `${numberOrNull(set.load_value) ?? 0}%`;
  if (numberOrNull(set.load_value) != null) return String(numberOrNull(set.load_value));
  return toText(set.load_note);
}

/** Maps the persisted v2 prescription into the legacy athlete runtime shape.
 * The full v2 fields are retained under `prescriptions` so execution can render
 * and record each row without flattening its method semantics in the database.
 */
export function toAthleteProgram(input) {
  const program = convertLegacyProgram(input);
  if (program.schemaVersion !== PROGRAM_SCHEMA_VERSION) return clone(program);
  const { legacyBackup: _legacyBackup, calculated: _calculated, settings: _settings, volume_ranges: _volumeRanges, progression_rules: _progressionRules, legacyFields: _legacyFields, ...athleteProgram } = program;
  return {
    ...athleteProgram,
    settimane: (program.settimane || []).map((week, wi) => {
      const { legacyFields: _weekLegacyFields, trainer_note: _weekTrainerNote, rule_note: _ruleNote, volume_target: _volumeTarget, intensity_target: _intensityTarget, dates_are_manual: _manualDates, ...weekData } = week;
      return {
      ...weekData, n: week.n || wi + 1,
      giorni: (week.giorni || []).map((day, di) => {
        const { legacyFields: _dayLegacyFields, trainer_note: _dayTrainerNote, blocks: _blocks, ...dayData } = day;
        const exercises = [];
        for (const block of (day.blocks || []).slice().sort((a, b) => Number(a.position || 0) - Number(b.position || 0))) {
          const grouped = ["superset", "giant_set", "multiset", "circuit"].includes(block.method) && (block.exercises || []).length > 1;
          const ownRest = block.method === "multiset";
          for (const exercise of (block.exercises || []).slice().sort((a, b) => Number(a.position || 0) - Number(b.position || 0))) {
            const rows = (exercise.sets || []).slice().sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
            const mainIndex = Math.max(0, rows.findIndex((row) => row.set_type !== "warmup"));
            const first = rows[mainIndex] || rows[0] || {};
            const repRows = rows.map(displayReps), loadRows = rows.map(displayLoad);
            const athleteRows = rows.map((row) => ({
              id: row.id, position: row.position, set_type: row.set_type, reps_min: row.reps_min, reps_max: row.reps_max,
              reps_mode: row.reps_mode, load_value: row.load_value, load_unit: row.load_unit, load_note: row.load_note,
              target_rir: row.target_rir, tempo: row.tempo, rest_seconds: row.rest_seconds, intra_rest_seconds: row.intra_rest_seconds,
              parent_set_id: row.parent_set_id, round: row.round, client_note: row.client_note, effort_by_feel: row.effort_by_feel === true,
              ...(row.technique ? { technique: clone(row.technique) } : {})
            }));
            const rowTechniques = rows.map((row) => row.technique && typeof row.technique === "object" ? clone(row.technique) : null);
            const uniqueReps = new Set(repRows), uniqueLoads = new Set(loadRows);
            const firstLoad = rows.map(displayLoad).find(Boolean) || "";
            const notes = [exercise.client_note, block.client_note, exercise.instructions, ...rows.map((row) => row.client_note)];
            const clientNotes = [...new Set(notes.map(toText).filter(Boolean))].join("\n");
            const old = exercise.legacyFields || {};
            const safeBadge = toText(old.badge).replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 24);
            const safeTempo = /^\d{1,3}(?:[-–]\d{1,3}){3}$/.test(toText(old.tempo)) ? toText(old.tempo) : "";
            exercises.push({
              badge: safeBadge,
              cardio: old.cardio === true,
              timed: old.timed === true,
              prog: ["drop", "interrotte", "stripping"].includes(old.prog) ? old.prog : undefined,
              rm: Number.isFinite(Number(old.rm)) && old.rm !== "" ? Number(old.rm) : undefined,
              perLato: old.perLato === true || old.per_lato === true,
              tempo: safeTempo || undefined,
              id: exercise.id, nome: exercise.name, serie: rows.length,
              reps: repRows[mainIndex] || "", repsSerie: uniqueReps.size > 1 ? repRows : undefined,
              rec: String(!ownRest && ["superset", "giant_set", "circuit"].includes(block.method) ? block.rest_after_seconds ?? 0 : first.rest_seconds ?? block.rest_after_seconds ?? 0),
              carico: firstLoad, carichiSerie: uniqueLoads.size > 1 ? loadRows : undefined,
              note: clientNotes.slice(0, 2000), rir: first.target_rir ?? null,
              rirTxt: first.target_rir == null ? "" : String(first.target_rir),
              unita: first.reps_mode === "time" ? "sec" : undefined,
              timed: false, ss: grouped ? block.id : undefined, blockMethod: block.method,
              ssType: grouped ? block.method : undefined,
              setTypes: rows.map((row) => row.set_type), prescriptions: athleteRows,
              ...(rowTechniques.some(Boolean) ? { tecniche: rowTechniques } : {}),
              muscolo: (exercise.primary_muscles || []).join(", "),
              equipment: exercise.equipment || "", video_ref: exercise.video_ref || null,
              instructions: toText(exercise.instructions),
              videoStoragePath: typeof old.videoStoragePath === "string" && old.videoStoragePath ? old.videoStoragePath : undefined,
              alternativa: old.alternativa === true ? true : undefined
            });
          }
        }
        const letter = String.fromCharCode(65 + di);
        return {
          ...dayData, titolo: day.title || `Giorno ${letter}`, dn: day.weekday ? ["", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"][Number(day.weekday)] || "Allenamento" : "Allenamento",
          dt: day.day_code || day.code || letter, min: day.available_minutes || null, esercizi: exercises
        };
      })
    }; })
  };
}

export function inspectProgramDates(program) {
  const errors = [], warnings = [];
  const start = dateMs(program?.dal), end = dateMs(program?.al);
  if (start == null || end == null || start > end) errors.push({ path: "dal/al", message: "Inserisci un periodo valido: Al deve essere uguale o successivo a Dal." });
  const weeks = program?.settimane || [];
  let previousEnd = null, firstStart = null, lastEnd = null;
  weeks.forEach((week, index) => {
    const range = dateRange(program, index);
    if (!range.dal || !range.al) { warnings.push({ path: `settimane[${index}]`, message: `La settimana ${index + 1} non rientra nel periodo della scheda.` }); return; }
    const from = dateMs(range.dal), to = dateMs(range.al);
    if (from == null || to == null || from > to) errors.push({ path: `settimane[${index}].dal/al`, message: "Intervallo settimana non valido." });
    if (firstStart == null && from != null) firstStart = from;
    if (from != null && start != null && from < start || to != null && end != null && to > end) errors.push({ path: `settimane[${index}].dal/al`, message: "Le date della settimana devono restare nel periodo della scheda." });
    if (previousEnd != null && from != null && from !== previousEnd + 1) errors.push({ path: `settimane[${index}].dal`, message: "Le settimane devono essere consecutive, senza sovrapposizioni o interruzioni." });
    if (to != null) { previousEnd = to; lastEnd = to; }
  });
  if (start != null && firstStart != null && firstStart > start) warnings.push({ path: "settimane", message: "Le settimane iniziano dopo la data iniziale della scheda." });
  if (start != null && end != null && lastEnd != null && lastEnd < end) warnings.push({ path: "settimane", message: "Le settimane non coprono tutto il periodo della scheda." });
  return { errors, warnings };
}

export function validateV2Program(input, { forPublish = false } = {}) {
  const program = convertLegacyProgram(input), errors = [], warnings = [];
  const check = (path, condition, message) => { if (!condition) errors.push({ path, message }); };
  check("nome", Boolean(toText(program.nome)) && toText(program.nome).length <= 80, "Il nome scheda è obbligatorio e deve contenere al massimo 80 caratteri.");
  if (program.dal) check("dal", validDate(program.dal), "La data iniziale della scheda non è valida.");
  if (program.al) check("al", validDate(program.al), "La data finale della scheda non è valida.");
  if (validDate(program.dal) && validDate(program.al)) check("dal/al", program.dal <= program.al, "La data finale deve essere uguale o successiva alla data iniziale.");
  check("scala_intensita", ["RIR", "RPE"].includes(program.scala_intensita || program.intensity_scale || "RIR"), "La scala di intensità deve essere RIR o RPE.");
  check("periodizzazione", ["linear", "dup", "block"].includes(program.periodizzazione || program.periodization || "linear"), "Modello di periodizzazione non riconosciuto.");
  const settings = program.settings || {};
  for (const [key, fallback] of Object.entries(DEFAULT_WORKOUT_SETTINGS)) {
    if (key === "usefulSetWeights") continue;
    const value = settings[key];
    if (value != null) check(`settings.${key}`, Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= (key === "secondaryMuscleWeight" ? 2 : 86400), `Impostazione ${key} non valida.`);
    else if (fallback == null) check(`settings.${key}`, false, `Impostazione ${key} non valida.`);
  }
  if (settings.usefulSetWeights != null) {
    check("settings.usefulSetWeights", typeof settings.usefulSetWeights === "object" && !Array.isArray(settings.usefulSetWeights), "Configurazione serie utili non valida.");
    for (const [type, weight] of Object.entries(settings.usefulSetWeights || {})) check(`settings.usefulSetWeights.${type}`, SET_TYPES.has(type) && Number.isFinite(Number(weight)) && Number(weight) >= 0 && Number(weight) <= 1, "Il peso della serie deve essere tra 0 e 1.");
  }
  if (program.volume_ranges != null) {
    check("volume_ranges", typeof program.volume_ranges === "object" && !Array.isArray(program.volume_ranges), "Range volume non valido.");
    for (const [muscle, range] of Object.entries(program.volume_ranges || {})) {
      const min = numberOrNull(range?.min), max = numberOrNull(range?.max);
      check(`volume_ranges.${muscle}`, Boolean(range) && min != null && max != null && min >= 0 && max >= min && max <= 200, "Il range deve avere valori compresi tra 0 e 200 e minimo non superiore al massimo.");
    }
  }
  if (forPublish) {
    const dates = inspectProgramDates(program); errors.push(...dates.errors); warnings.push(...dates.warnings);
  }
  check("settimane", Array.isArray(program.settimane) && program.settimane.length > 0 && program.settimane.length <= 52, "La scheda deve contenere da 1 a 52 settimane.");
  let hasWorkout = false;
  for (const [wi, week] of (Array.isArray(program.settimane) ? program.settimane : []).entries()) {
    if (!week || typeof week !== "object" || Array.isArray(week)) { check(`settimane[${wi}]`, false, "Settimana non valida."); continue; }
    check(`settimane[${wi}].giorni`, Array.isArray(week.giorni) && week.giorni.length <= 7, "La settimana può contenere al massimo 7 sedute.");
    if (week.dates_are_manual) {
      check(`settimane[${wi}].dal`, validDate(week.dal), "Data iniziale settimana non valida.");
      check(`settimane[${wi}].al`, validDate(week.al), "Data finale settimana non valida.");
      if (validDate(week.dal) && validDate(week.al)) check(`settimane[${wi}].dal/al`, week.dal <= week.al, "La data finale deve seguire quella iniziale.");
    }
    if (week.volume_target != null) check(`settimane[${wi}].volume_target`, Number.isFinite(Number(week.volume_target)) && Number(week.volume_target) >= 0 && Number(week.volume_target) <= 1000, "Il target volume deve essere tra 0 e 1000 serie.");
    if (week.intensity_target != null) check(`settimane[${wi}].intensity_target`, Number.isFinite(Number(week.intensity_target)) && Number(week.intensity_target) >= 0 && Number(week.intensity_target) <= 10, "Il target intensità deve essere tra 0 e 10.");
    const days = Array.isArray(week.giorni) ? week.giorni : [];
    for (const [di, day] of days.entries()) {
      if (!day || typeof day !== "object" || Array.isArray(day)) { check(`settimane[${wi}].giorni[${di}]`, false, "Seduta non valida."); continue; }
      check(`settimane[${wi}].giorni[${di}].title`, toText(day.title).length <= 120, "Il nome seduta non può superare 120 caratteri.");
      if (day.available_minutes != null) check(`settimane[${wi}].giorni[${di}].available_minutes`, Number.isFinite(Number(day.available_minutes)) && Number(day.available_minutes) >= 1 && Number(day.available_minutes) <= 600, "La disponibilità deve essere tra 1 e 600 minuti.");
      check(`settimane[${wi}].giorni[${di}].blocks`, Array.isArray(day.blocks) && day.blocks.length <= 40, "La seduta può contenere al massimo 40 blocchi.");
      const blocks = Array.isArray(day.blocks) ? day.blocks : [];
      for (const [bi, block] of blocks.entries()) {
        if (!block || typeof block !== "object" || Array.isArray(block)) { check(`settimane[${wi}].giorni[${di}].blocks[${bi}]`, false, "Blocco non valido."); continue; }
        check(`settimane[${wi}].giorni[${di}].blocks[${bi}].method`, V2_METHODS.has(block.method), "Metodo del blocco non riconosciuto.");
        check(`settimane[${wi}].giorni[${di}].blocks[${bi}].exercises`, Array.isArray(block.exercises) && block.exercises.length <= 12, "Il blocco può contenere al massimo 12 esercizi.");
        const exercises = Array.isArray(block.exercises) ? block.exercises : [];
        const minExercises = ["superset", "multiset"].includes(block.method) ? 2 : ["giant_set", "circuit"].includes(block.method) ? 3 : 1;
        const maxExercises = ["superset", "giant_set", "multiset", "circuit"].includes(block.method) ? 12 : 1;
        check(`settimane[${wi}].giorni[${di}].blocks[${bi}].exercises.length`, exercises.length >= minExercises && exercises.length <= maxExercises, `${block.method === "superset" ? "Il superset richiede 2 esercizi" : block.method === "multiset" ? "La multiserie richiede almeno 2 righe" : ["giant_set", "circuit"].includes(block.method) ? "Il metodo richiede almeno 3 esercizi" : "Questo metodo ammette un solo esercizio"}.`);
        for (const [ei, exercise] of exercises.entries()) {
          if (!exercise || typeof exercise !== "object" || Array.isArray(exercise)) { check(`settimane[${wi}].giorni[${di}].blocks[${bi}].exercises[${ei}]`, false, "Esercizio non valido."); continue; }
          check(`settimane[${wi}].giorni[${di}].blocks[${bi}].exercises[${ei}].name`, toText(exercise.name).length <= 160, "Il nome esercizio non può superare 160 caratteri.");
          if (forPublish) check(`settimane[${wi}].giorni[${di}].blocks[${bi}].exercises[${ei}].name.required`, Boolean(toText(exercise.name)), "Inserisci il nome dell’esercizio prima di pubblicare.");
          if (exercise.video_ref != null && exercise.video_ref !== "") {
            check(`settimane[${wi}].giorni[${di}].blocks[${bi}].exercises[${ei}].video_ref`, Boolean(parseExerciseVideo(exercise.video_ref)), EXERCISE_VIDEO_ERROR);
          }
          const sets = Array.isArray(exercise.sets) ? exercise.sets : [];
          if (toText(exercise.name) && sets.some((set) => set && set.set_type !== "warmup")) hasWorkout = true;
          check(`settimane[${wi}].giorni[${di}].blocks[${bi}].exercises[${ei}].sets`, Array.isArray(exercise.sets) && exercise.sets.length <= 100, "L'esercizio può contenere al massimo 100 serie.");
          for (const [si, set] of sets.entries()) {
            if (!set || typeof set !== "object" || Array.isArray(set)) { check(`settimane[${wi}].giorni[${di}].blocks[${bi}].exercises[${ei}].sets[${si}]`, false, "Prescrizione serie non valida."); continue; }
            const path = `settimane[${wi}].giorni[${di}].blocks[${bi}].exercises[${ei}].sets[${si}]`;
            check(`${path}.set_type`, SET_TYPES.has(set.set_type), "Tipo serie non riconosciuto.");
            const min = numberOrNull(set.reps_min), max = numberOrNull(set.reps_max);
            const repsValid = set.reps_mode === "amrap" || (set.reps_mode === "time" && min != null && min > 0 && min === max) || (set.reps_mode === "range" && min != null && max != null && min >= 0 && max >= min);
            check(`${path}.reps_mode`, ["range", "amrap", "time"].includes(set.reps_mode), "Modalità ripetizioni non valida.");
            const hasReps = set.reps_mode === "amrap" || min != null || max != null;
            if (forPublish && set.set_type !== "warmup") check(`${path}.reps`, repsValid, "Inserisci ripetizioni valide; il minimo non può superare il massimo.");
            else if (hasReps) check(`${path}.reps`, repsValid, "Ripetizioni non valide: usa un numero, un intervallo, AMRAP o secondi.");
            if (set.target_rir != null && set.target_rir !== "") check(`${path}.target_rir`, Number.isFinite(Number(set.target_rir)) && Number(set.target_rir) >= 0 && Number(set.target_rir) <= 10, "RIR deve essere tra 0 e 10.");
            if (set.rest_seconds != null && set.rest_seconds !== "") check(`${path}.rest_seconds`, Number.isFinite(Number(set.rest_seconds)) && Number(set.rest_seconds) >= 0 && Number(set.rest_seconds) <= 14400, "Il recupero deve essere tra 0 e 14400 secondi.");
            if (set.load_value != null && set.load_value !== "") check(`${path}.load_value`, Number.isFinite(Number(set.load_value)) && Number(set.load_value) >= -1000 && Number(set.load_value) <= 100000, "Carico non valido.");
            if (set.load_unit != null) check(`${path}.load_unit`, ["kg", "percent_1rm", "percent_of_top", "bodyweight"].includes(set.load_unit), "Unità di carico non valida.");
            if (forPublish && set.set_type !== "warmup") check(`${path}.load`, set.load_unit === "bodyweight" || set.effort_by_feel === true || numberOrNull(set.load_value) != null || Boolean(toText(set.load_note)), "Indica un carico o marca la serie come 'a sensazione'.");
            if (set.tempo) check(`${path}.tempo`, /^(\d|X)([-–](\d|X)){3}$/i.test(toText(set.tempo)), "Tempo non valido: usa quattro valori, per esempio 3-1-1-0.");
          }
        }
      }
    }
  }
  if (forPublish) check("settimane.giorni.esercizi", hasWorkout, "Aggiungi almeno una seduta con un esercizio prima di pubblicare.");
  const valid = errors.length === 0;
  const canonicalProgram = valid ? { ...program, calculated: calculateProgramMetrics(program) } : program;
  return { program: canonicalProgram, errors, warnings, valid };
}
