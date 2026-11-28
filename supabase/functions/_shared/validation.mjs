import { validateV2Program } from "../../../www/src/workout-metrics.mjs";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_RX = /^[A-Za-z0-9_-]{8,128}$/;

export function cleanText(value, max = 120) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

// Data di nascita «AAAA-MM-GG»: dal 1900 a oggi, almeno 10 anni. Vuota → null (obbligatoria solo se richiesta).
export function validateBirthDate(value, { required = false, today = new Date() } = {}) {
  const text = String(value ?? "").trim();
  if (!text) { if (required) throw new Error("Inserisci la data di nascita."); return null; }
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T00:00:00.000Z`) : NaN;
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== text) throw new Error("Data di nascita non valida.");
  const limit = new Date(Date.UTC(today.getUTCFullYear() - 10, today.getUTCMonth(), today.getUTCDate()));
  if (text < "1900-01-01" || ms > limit.getTime()) throw new Error("Data di nascita non valida.");
  return text;
}

export function validateClientRegistration(input = {}, { requireBirthDate = false } = {}) {
  const firstName = cleanText(input.firstName, 60);
  const lastName = cleanText(input.lastName, 60);
  const email = cleanText(input.email, 254).toLowerCase();
  const password = String(input.password ?? "");
  if (!firstName || !lastName) throw new Error("Nome e cognome sono obbligatori.");
  if (!EMAIL_RX.test(email)) throw new Error("Email non valida.");
  if (password.length < 12 || password.length > 128) throw new Error("La password deve avere tra 12 e 128 caratteri.");
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) throw new Error("La password deve includere maiuscola, minuscola e numero.");
  const birthDate = validateBirthDate(input.birthDate, { required: requireBirthDate });
  return { firstName, lastName, email, password, ...(birthDate ? { birthDate } : {}) };
}

export function validateCreateClient(input = {}) {
  const idempotencyKey = cleanText(input.idempotencyKey, 80);
  if (!ID_RX.test(idempotencyKey)) throw new Error("Identificativo richiesta non valido.");
  return { ...validateClientRegistration(input), idempotencyKey };
}

function dateMs(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}

function isoDate(ms) { return new Date(ms).toISOString().slice(0, 10); }

export function validateProgram(program = {}, { forPublish = false } = {}) {
  if (!program || typeof program !== "object" || Array.isArray(program)) throw new Error("Dati della scheda non validi.");
  if (Number(program.schemaVersion || program.schema_version) === 2) {
    const result = validateV2Program(program, { forPublish });
    if (!result.valid) {
      const first = result.errors[0];
      throw new Error(`${first.path}: ${first.message}`);
    }
    return result.program;
  }
  const name = cleanText(program.name || program.nome, 120);
  const startDate = cleanText(program.startDate || program.dal, 10);
  const endDate = cleanText(program.endDate || program.al, 10);
  const weeks = program.weeks || program.settimane;
  if (!name) throw new Error("Il nome della scheda è obbligatorio.");
  const startMs = dateMs(startDate), endMs = dateMs(endDate);
  if (startMs === null || endMs === null || startMs > endMs) throw new Error("Il periodo della scheda non è valido.");
  if (!Array.isArray(weeks) || weeks.length < 1 || weeks.length > 52) throw new Error("La scheda deve contenere da 1 a 52 settimane.");
  if (weeks.some((week) => !week || typeof week !== "object" || Array.isArray(week))) throw new Error("Una o più settimane non sono valide.");
  const hasWeekDates = weeks.some((week) => week.dal || week.al || week.startDate || week.endDate);
  const allWeekDates = weeks.every((week) => week.dal || week.al || week.startDate || week.endDate);
  if (hasWeekDates && !allWeekDates) throw new Error("Completa le date di tutte le settimane oppure lasciale tutte vuote per calcolarle automaticamente.");
  let weekRanges;
  if (hasWeekDates) {
    weekRanges = weeks.map((week, index) => {
      const start = cleanText(week.startDate || week.dal, 10), end = cleanText(week.endDate || week.al, 10);
      if (dateMs(start) === null || dateMs(end) === null || start > end) throw new Error(`Settimana ${index + 1}: intervallo date non valido.`);
      return { dal: start, al: end };
    });
    if (weekRanges[0].dal !== startDate || weekRanges.at(-1).al !== endDate || weekRanges.some((range, index) => index > 0 && dateMs(range.dal) !== dateMs(weekRanges[index - 1].al) + 86400000)) {
      throw new Error("Le date delle settimane devono coprire tutto il periodo della scheda senza interruzioni.");
    }
  } else {
    const totalDays = Math.floor((endMs - startMs) / 86400000) + 1;
    if (totalDays < weeks.length) throw new Error("Il periodo è troppo breve per il numero di settimane inserite.");
    weekRanges = weeks.map((_, index) => ({
      dal: isoDate(startMs + Math.floor(totalDays * index / weeks.length) * 86400000),
      al: isoDate(startMs + (Math.floor(totalDays * (index + 1) / weeks.length) - 1) * 86400000)
    }));
  }
  const weekNumbers = new Set();
  const normalizedWeeks = weeks.map((week, wi) => {
    const days = week.days || week.giorni;
    if (!Array.isArray(days) || days.length < 1 || days.length > 7) throw new Error(`Settimana ${wi + 1}: giorni non validi.`);
    const weekNumber = Number(week.n || wi + 1);
    if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 52 || weekNumbers.has(weekNumber)) throw new Error(`Settimana ${wi + 1}: numero settimana non valido o duplicato.`);
    weekNumbers.add(weekNumber);
    return { ...week, ...weekRanges[wi], n: weekNumber, giorni: days.map((day, di) => {
      if (!day || typeof day !== "object" || Array.isArray(day)) throw new Error(`Settimana ${wi + 1}, giorno ${di + 1}: dati non validi.`);
      const exercises = day.exercises || day.esercizi;
      if (!Array.isArray(exercises) || exercises.length < 1 || exercises.length > 40) throw new Error(`Settimana ${wi + 1}, giorno ${di + 1}: esercizi non validi.`);
      const normalizedExercises = exercises.map((exercise, ei) => {
        if (!exercise || typeof exercise !== "object" || Array.isArray(exercise)) throw new Error(`Settimana ${wi + 1}, giorno ${di + 1}, esercizio ${ei + 1}: dati non validi.`);
        const exerciseName = cleanText(exercise.name || exercise.nome, 160);
        if (!exerciseName) throw new Error(`Settimana ${wi + 1}, giorno ${di + 1}, esercizio ${ei + 1}: nome mancante.`);
        const sets = Number(exercise.sets ?? exercise.serie ?? 0);
        if (!Number.isFinite(sets) || sets < 1 || sets > 20) throw new Error(`${exerciseName}: numero di serie non valido.`);
        return { ...exercise, nome: exerciseName, serie: sets, reps: cleanText(exercise.reps ?? exercise.ripetizioni, 80), rec: cleanText(exercise.rec ?? exercise.recupero, 40), note: cleanText(exercise.note, 1000) };
      });
      const minutes = Number(day.min ?? day.minutes);
      const estimatedMinutes = Math.max(10, Math.ceil(normalizedExercises.reduce((sum, exercise) => sum + exercise.serie * (2.5 + (Number.parseFloat(exercise.rec) || 0) / 120), 0)));
      const normalizedMinutes = day.min != null || day.minutes != null ? minutes : estimatedMinutes;
      if (!Number.isFinite(normalizedMinutes) || normalizedMinutes < 1 || normalizedMinutes > 600) throw new Error(`Settimana ${wi + 1}, giorno ${di + 1}: durata non valida.`);
      const letter = String.fromCharCode(65 + di);
      return { ...day, titolo: cleanText(day.title || day.titolo || `Giorno ${letter}`, 120), dn: cleanText(day.dn || day.weekday || "Allenamento", 32), dt: cleanText(day.dt || day.dayCode || letter, 32), min: normalizedMinutes, esercizi: normalizedExercises };
    }) };
  });
  return { ...program, nome: name, dal: startDate, al: endDate, settimane: normalizedWeeks };
}

export function validateId(value, label = "ID") {
  const id = cleanText(value, 128);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error(`${label} non valido.`);
  return id;
}

// ── Storico allenamenti importato dal PT (CoachPlus o vecchio APK) ──
const HISTORY_LIMITS = { sessions: 3000, exercises: 60, sets: 60, weights: 3000 };
const finiteOrNull = (value, min, max) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
};
const historyId = (value, label) => {
  const id = String(value ?? "").trim();
  if (!id || id.length > 80 || !/^[A-Za-z0-9._:-]+$/.test(id)) throw new Error(`${label}: id non valido.`);
  return id;
};
const historyTs = (value, label) => {
  const ts = Number(value);
  if (!Number.isFinite(ts) || ts < Date.UTC(2015, 0, 1) || ts > Date.now() + 2 * 86400000) throw new Error(`${label}: data non valida.`);
  return Math.round(ts);
};

export function validateHistory(sessions, weights) {
  if (!Array.isArray(sessions) || sessions.length > HISTORY_LIMITS.sessions) throw new Error(`Sessioni: servono da 0 a ${HISTORY_LIMITS.sessions} voci.`);
  if (!Array.isArray(weights ?? []) || (weights ?? []).length > HISTORY_LIMITS.weights) throw new Error("Pesate non valide.");
  const cleanSessions = sessions.map((session, index) => {
    const label = `Sessione ${index + 1}`;
    if (!session || typeof session !== "object" || Array.isArray(session)) throw new Error(`${label}: formato non valido.`);
    if (!Array.isArray(session.esercizi) || session.esercizi.length > HISTORY_LIMITS.exercises) throw new Error(`${label}: esercizi non validi.`);
    const exercises = session.esercizi.map((exercise, exIndex) => {
      const exLabel = `${label}, esercizio ${exIndex + 1}`;
      const name = cleanText(exercise?.nome, 160);
      if (!name) throw new Error(`${exLabel}: nome mancante.`);
      const sets = Array.isArray(exercise.sets) ? exercise.sets : [];
      if (sets.length > HISTORY_LIMITS.sets) throw new Error(`${exLabel}: troppe serie.`);
      const out = {
        nome: name,
        sets: sets.map((set) => ({ kg: finiteOrNull(set?.kg, -500, 1000), reps: finiteOrNull(set?.reps, 0, 1000), rir: finiteOrNull(set?.rir, 0, 10) })),
        fatto: exercise.fatto !== false,
        note: cleanText(exercise.note, 1000),
        segnalato: null
      };
      if (exercise.uni === true) out.uni = true;
      if (Array.isArray(exercise.lati)) out.lati = exercise.lati.slice(0, HISTORY_LIMITS.sets).map((side) => (side === "SX" ? "SX" : "DX"));
      return out;
    });
    const out = {
      id: historyId(session.id, label), ts: historyTs(session.ts, label),
      settimana: finiteOrNull(session.settimana, 0, 200), giorno: finiteOrNull(session.giorno, 0, 20) ?? 0,
      dt: cleanText(session.dt, 4), titolo: cleanText(session.titolo, 160), nota: cleanText(session.nota, 1000),
      esercizi: exercises, importata: true
    };
    const program = cleanText(session.prog, 160);
    if (program) out.prog = program;
    return out;
  });
  const cleanWeights = (weights ?? []).map((weight, index) => {
    const label = `Pesata ${index + 1}`;
    const value = finiteOrNull(weight?.v, 20, 400);
    if (value === null) throw new Error(`${label}: peso non valido.`);
    return { id: historyId(weight.id, label), ts: historyTs(weight.ts, label), v: value };
  });
  return { sessions: cleanSessions, weights: cleanWeights };
}
