import { supabase, supabaseConfigured } from "./supabase.mjs";
import { friendlyAuthError, getAuthorizedSession, logout } from "./auth.mjs";
import { watchAthleteNutrition } from "./nutrition-athlete.mjs";
import { toAthleteProgram } from "./workout-metrics.mjs?v=20261128-multiserie";
import { preparaTecniche } from "./tecniche.mjs?v=20261128-multiserie";
import { markChatRead } from "./chat.mjs";
import { openAccountMenu, otherSavedAccounts, rememberAccount } from "./account-switch.mjs";
import { createNotifications } from "./notifications.mjs";
const api = window.lippolisAthleteApi;
const badge = document.getElementById("syncBadge");
let knownRevision = 0;
let knownProgramVersion = "";
let cloudReady = false;
let pendingSnapshot = null;
let pendingRemoteState = null;
let pendingRemoteProgram;
let programEventSequence = 0;
let stopNutritionWatch = null;
let coachSectionsWatch = null;
let saving = false;
let saveTimer = null;
let retryCount = 0;
let currentAccessToken = "";
let currentUserId = "";
let alerts;

function badgeText(text, isError = false) {
  if (!badge) return; badge.textContent = text; badge.style.background = isError ? "#b83d35" : ""; badge.classList.add("show");
  clearTimeout(badgeText.timer); badgeText.timer = setTimeout(() => badge.classList.remove("show"), isError ? 4500 : 1400);
}
function localData() { try { return JSON.parse(localStorage.getItem(api.storageKey) || "null") || api.snapshot(); } catch { return api.snapshot(); } }
function saveLocal(data) { localStorage.setItem(api.storageKey, JSON.stringify({ ...data, salvato: Number(data.salvato || Date.now()) })); }
function sanitizeSnapshot(value) { const clean = structuredClone(value || {}); delete clean.PROGRAMMA; delete clean.versioneSchedaLocale; delete clean.thread; delete clean.diario; delete clean.differite; delete clean.app; delete clean.esportato; clean.v = 1; return clean; }
function stableValue(value) { if (Array.isArray(value)) return value.map(stableValue); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])])); return value; }
function sameSnapshot(a, b) { return JSON.stringify(stableValue(sanitizeSnapshot(a))) === JSON.stringify(stableValue(sanitizeSnapshot(b))); }
function mergeArray(current, incoming) {
  const records = new Map();
  for (const item of [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const key = item?.id != null ? `id:${item.id}` : item?.measuredAt != null ? `date:${item.measuredAt}` : item?.ts != null ? `ts:${item.ts}` : `value:${JSON.stringify(item)}`;
    records.set(key, item);
  }
  return [...records.values()];
}
function mergeQueuedSnapshot(remote, local) {
  const merged = { ...(remote || {}), ...(local || {}) };
  for (const key of ["sessioni", "pesi", "progressi"]) merged[key] = mergeArray(remote?.[key], local?.[key]);
  if (Array.isArray(remote?.metriche) || Array.isArray(local?.metriche)) {
    const metrics = new Map();
    for (const item of [...(remote?.metriche || []), ...(local?.metriche || [])]) {
      const previous = metrics.get(item.nome) || {};
      metrics.set(item.nome, { ...previous, ...item, dati: mergeArray(previous.dati, item.dati) });
    }
    merged.metriche = [...metrics.values()];
  }
  for (const key of ["giornate", "statoSett", "noteSessione"]) merged[key] = { ...(remote?.[key] || {}), ...(local?.[key] || {}) };
  return sanitizeSnapshot(merged);
}
function scheduleFlush(uid, delay = 350) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void flush(uid); }, delay);
}
function normalizePublishedProgram(value) {
  if (!value || typeof value !== "object") return value;
  const program = Number(value.schemaVersion || value.schema_version) === 2 ? toAthleteProgram(value) : structuredClone(value), weeks = program.settimane || program.weeks;
  if (!Array.isArray(weeks) || !weeks.length) return program;
  const dayMs = 86400000, parseDate = (date) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return null;
    const ms = Date.parse(`${date}T00:00:00.000Z`);
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date ? ms : null;
  };
  const start = parseDate(program.dal || program.startDate), end = parseDate(program.al || program.endDate);
  const candidateRanges = weeks.map((week) => ({ from: parseDate(week.dal || week.startDate), to: parseDate(week.al || week.endDate) }));
  const validRanges = candidateRanges.every((range) => range.from !== null && range.to !== null && range.from <= range.to)
    && (start === null || candidateRanges[0].from === start)
    && (end === null || candidateRanges.at(-1).to === end)
    && candidateRanges.every((range, index) => index === 0 || range.from === candidateRanges[index - 1].to + dayMs);
  const totalDays = start !== null && end !== null && end >= start ? Math.floor((end - start) / dayMs) + 1 : 0;
  const normalizedWeeks = weeks.map((week, index) => {
    let from = week.dal || week.startDate, to = week.al || week.endDate;
    if (!validRanges && totalDays >= weeks.length) {
      from = new Date(start + Math.floor(totalDays * index / weeks.length) * dayMs).toISOString().slice(0, 10);
      to = new Date(start + (Math.floor(totalDays * (index + 1) / weeks.length) - 1) * dayMs).toISOString().slice(0, 10);
    }
    const days = week.giorni || week.days || [];
    const normalizedDays = Array.isArray(days) ? days.map((day, dayIndex) => {
      const exercises = day.esercizi || day.exercises || [];
      const normalizedExercises = Array.isArray(exercises) ? exercises.map((exercise) => ({
        ...exercise, nome: exercise.nome || exercise.name || "Esercizio", serie: exercise.serie ?? exercise.sets ?? 3,
        reps: exercise.reps || exercise.ripetizioni || "8-12", rec: exercise.rec ?? exercise.recupero ?? "90", note: exercise.note || ""
      })) : [];
      const estimate = Math.max(10, Math.ceil(normalizedExercises.reduce((sum, exercise) => sum + (Number(exercise.serie) || 3) * (2.5 + (Number.parseFloat(exercise.rec) || 0) / 120), 0)));
      const letter = String.fromCharCode(65 + dayIndex);
      return { ...day, titolo: day.titolo || day.title || `Giorno ${letter}`, dn: day.dn || day.weekday || "Allenamento", dt: day.dt || day.dayCode || letter, min: day.min ?? day.minutes ?? estimate, esercizi: normalizedExercises };
    }) : [];
    return { ...week, n: week.n || index + 1, dal: from || "", al: to || "", giorni: normalizedDays };
  });
  // Multiserie e tecniche d'intensità per serie (dalla scheda del pannello o dalle frasi standard nelle note).
  return preparaTecniche({ ...program, nome: program.nome || program.name || "Scheda", dal: program.dal || program.startDate || "", al: program.al || program.endDate || "", settimane: normalizedWeeks });
}
function mergeRemote(remoteState, currentProgram, profile, preferLocal = false) {
  const local = localData(); const merged = preferLocal ? mergeQueuedSnapshot(remoteState, local) : mergeQueuedSnapshot(local, remoteState);
  if (remoteState != null) merged.bia = Array.isArray(remoteState.bia) ? remoteState.bia : [];
  if (currentProgram?.program) merged.PROGRAMMA = normalizePublishedProgram(currentProgram.program);
  else if (currentProgram === false) merged.PROGRAMMA = null;
  else if (local.PROGRAMMA) merged.PROGRAMMA = local.PROGRAMMA;
  merged.profilo = { ...(merged.profilo || {}), nome: profile.firstName || merged.profilo?.nome || "", cognome: profile.lastName || merged.profilo?.cognome || "" };
  merged.salvato = Math.max(Number(local.salvato || 0), Number(remoteState?.salvato || 0)); return merged;
}
function recordRemoteState(value) {
  if (Number(value?.revision || 0) > Number(pendingRemoteState?.revision || 0)) pendingRemoteState = value;
}
function applyRemoteState(uid, value) {
  if (Number(value?.revision || 0) <= knownRevision) return;
  recordRemoteState(value);
  applyRemoteChanges(uid);
}
async function refreshRemoteState(uid) {
  const { data, error } = await supabase.from("athlete_states").select("snapshot, revision").eq("user_id", uid).maybeSingle();
  if (error) throw error;
  applyRemoteState(uid, data);
}
async function refreshRemoteProgram(uid) {
  const sequence = ++programEventSequence;
  const { data, error } = await supabase.from("programs").select("program, version_id").eq("athlete_id", uid).maybeSingle();
  if (sequence !== programEventSequence) return;
  if (error) throw error;
  pendingRemoteProgram = data || false;
  applyRemoteChanges(uid);
}
function applyRemoteChanges(uid) {
  if (!cloudReady || saving || (!pendingRemoteState && pendingRemoteProgram === undefined)) return;
  api.flushPendingSave?.();
  if (pendingSnapshot) return;

  const state = pendingRemoteState;
  const program = pendingRemoteProgram;
  pendingRemoteState = null;
  pendingRemoteProgram = undefined;
  const stateRevision = Number(state?.revision || 0);
  const programVersion = program?.version_id || "";
  const stateChanged = state !== null && stateRevision >= knownRevision;
  const programChanged = program !== undefined && programVersion !== knownProgramVersion;
  if (!stateChanged && !programChanged) return;

  const merged = mergeRemote(stateChanged ? state.snapshot : null, programChanged ? program : null, window.__LIPPOLIS_PROFILE__ || {});
  if (stateChanged) knownRevision = stateRevision;
  if (programChanged) {
    knownProgramVersion = programVersion;
    window.__LIPPOLIS_PROGRAM_VERSION__ = programVersion;
  }
  if (programChanged || !sameSnapshot(merged, localData())) api.applySnapshot(merged);
  sessionStorage.setItem(`lippolis_cloud_boot_${uid}`, `${knownRevision}:${knownProgramVersion}`);
  if(programChanged&&programVersion){
    void alerts?.notify("program",{title:"Nuova scheda",body:"Il tuo PT ha pubblicato una scheda.",
      action:"Apri allenamento",destination:"workout"});
  }
}
let messageRequest = 0, latestMessages = [], markingChat = false;
async function loadMessages(uid) {
  const request=++messageRequest;
  const { data, error } = await supabase.from("messages").select("*").eq("athlete_id", uid).order("created_at",{ascending:false}).limit(200);
  if (error) throw error;
  if(request!==messageRequest)return;
  latestMessages=data.reverse();
  api.applyMessages(latestMessages.map(item=>({
    id:item.id, ts:new Date(item.created_at).getTime(), from:item.sender_id===uid?"atleta":"coach",
    tipo:item.type||"messaggio", testo:item.text, meta:item.metadata||null, channel:item.channel||"thread", letto:!!item.read_at
  })));
}
async function readAthleteChat(uid) {
  const unread=latestMessages.filter(item=>item.channel==="thread"&&item.sender_id!==uid&&!item.read_at);
  if(!unread.length||document.hidden||markingChat)return;
  markingChat=true;
  try{
    await markChatRead(uid,unread,uid);
    await loadMessages(uid);
  }finally{
    markingChat=false;
  }
}
async function bootstrap(session) {
  if (!api) throw new Error("Area atleta non inizializzata."); const { user, profile } = session; const storedUid = sessionStorage.getItem("lippolis_uid");
  currentUserId = user.uid;
  api.setProgressPhotoOwner?.(user.uid);
  const { data: { session: authSession }, error: authSessionError } = await supabase.auth.getSession();
  if (authSessionError) throw authSessionError;
  currentAccessToken = authSession?.access_token || "";
  supabase.auth.onAuthStateChange((_event, nextSession) => { currentAccessToken = nextSession?.access_token || ""; });
  if (storedUid !== user.uid) api.switchAccount(user.uid);
  window.__LIPPOLIS_PROFILE__ = profile;
  const identity = document.getElementById("athleteIdentity");
  if (identity) {
    const name = document.createElement("b"); name.textContent = profile.displayName || `${profile.firstName || ""} ${profile.lastName || ""}`.trim() || profile.email || user.email || "Cliente";
    const email = document.createElement("span"); email.textContent = profile.email || user.email || "";
    identity.replaceChildren(name, email);
  }
  const [stateResult, programResult] = await Promise.all([
    supabase.from("athlete_states").select("*").eq("user_id", user.uid).maybeSingle(),
    supabase.from("programs").select("*").eq("athlete_id", user.uid).maybeSingle()
  ]);
  if (stateResult.error) throw stateResult.error; if (programResult.error) throw programResult.error;
  const stateDoc = stateResult.data; const programDoc = programResult.data ? { ...programResult.data, versionId: programResult.data.version_id } : null;
  knownRevision = Number(stateDoc?.revision || 0); knownProgramVersion = programDoc?.versionId || ""; window.__LIPPOLIS_PROGRAM_VERSION__ = knownProgramVersion;
  const markerKey = `lippolis_cloud_boot_${user.uid}`; const marker = `${knownRevision}:${knownProgramVersion}`;
  const local = localData(), remote = stateDoc?.snapshot || {};
  const preferLocal = Number(local.salvato || 0) >= Number(remote.salvato || 0);
  const merged = mergeRemote(remote, programDoc || false, profile, preferLocal);
  const programChanged = JSON.stringify(merged.PROGRAMMA ?? null) !== JSON.stringify(local.PROGRAMMA ?? null);
  const versionChanged = String(local.versioneSchedaLocale || "") !== knownProgramVersion;
  if (sessionStorage.getItem(markerKey) !== marker || !sameSnapshot(merged, local) || programChanged || versionChanged) api.applySnapshot(merged);
  sessionStorage.setItem(markerKey, marker);
  if (!sameSnapshot(merged, remote)) pendingSnapshot = mergeQueuedSnapshot(remote, merged);

  const passwordUser = document.getElementById("athletePasswordUser");
  if (passwordUser) passwordUser.value = user.email || profile.email || "";
  // «Cambia account»: il tasto compare solo se su questo dispositivo c'è un altro account salvato.
  rememberAccount(profile, user).then(() => {
    const button = document.getElementById("accountSwitch");
    if (!button) return;
    button.hidden = !otherSavedAccounts(user.uid).length;
    button.onclick = () => openAccountMenu({ currentUid: user.uid, beforeLeave: () => syncBeforeLeave(user.uid, "cambiare account") });
  }).catch(() => {});

  window.lippolisAccount = {
    // Lo snapshot è già salvato localmente; il logout non deve attendere la rete.
    logout: () => logoutAfterSync(user.uid),
    updateProfile: async (value) => {
      const first = String(value.nome || "").trim(); const last = String(value.cognome || "").trim();
      const displayName = `${first} ${last}`.trim();
      const { data, error } = await supabase.from("profiles").update({ first_name: first, last_name: last, display_name: displayName, updated_at: new Date().toISOString() }).eq("id", user.uid).select("id, first_name, last_name, display_name").single();
      if (error) throw error;
      if (!data || data.id !== user.uid) throw new Error("Il profilo non è stato aggiornato. Ricarica la pagina e riprova.");
      window.__LIPPOLIS_PROFILE__ = { ...profile, ...window.__LIPPOLIS_PROFILE__, firstName: data.first_name, lastName: data.last_name, displayName: data.display_name };
      const identityName = document.querySelector("#athleteIdentity b");
      if (identityName) identityName.textContent = data.display_name || `${data.first_name} ${data.last_name}`.trim();
      return window.__LIPPOLIS_PROFILE__;
    },
    // Data di nascita (per l'automazione Compleanno del PT).
    setBirthDate: async (date) => {
      const { data, error } = await supabase.rpc("athlete_set_birth_date", { p_date: date });
      if (error) throw error;
      window.__LIPPOLIS_PROFILE__ = { ...profile, ...window.__LIPPOLIS_PROFILE__, birthDate: data || date };
      return window.__LIPPOLIS_PROFILE__;
    }
  };

  const savePasswordButton = document.getElementById("athleteSavePassword");
  savePasswordButton?.addEventListener("click", async () => {
    const current = document.getElementById("athleteCurrentPassword").value;
    const next = document.getElementById("athleteNewPassword").value;
    const confirmNext = document.getElementById("athleteConfirmPassword").value;
    const feedback = document.getElementById("athletePasswordFeedback");
    const showFeedback = (message, error = false) => { feedback.textContent = message; feedback.className = `password-feedback show${error ? " error" : ""}`; };
    if (!current) return showFeedback("Inserisci la password attuale.", true);
    if (next.length < 12) return showFeedback("La nuova password deve contenere almeno 12 caratteri.", true);
    if (next !== confirmNext) return showFeedback("Le nuove password non coincidono.", true);
    savePasswordButton.disabled = true; savePasswordButton.textContent = "Aggiornamento…";
    try {
      const { error: loginError } = await supabase.auth.signInWithPassword({ email: user.email, password: current });
      if (loginError) throw loginError;
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;
      showFeedback("Password aggiornata.");
      document.getElementById("athleteCurrentPassword").value = "";
      document.getElementById("athleteNewPassword").value = "";
      document.getElementById("athleteConfirmPassword").value = "";
    } catch (error) {
      showFeedback(friendlyAuthError(error), true);
    } finally {
      savePasswordButton.disabled = false; savePasswordButton.textContent = "Aggiorna password";
    }
  });

  window.lippolisCloudSync = {
    queue(snapshot) { pendingSnapshot = mergeQueuedSnapshot(pendingSnapshot, sanitizeSnapshot(snapshot)); if (cloudReady) scheduleFlush(user.uid); },
    async sendMessage(message, channel) {
      const text = String(message?.testo || "").trim(); if (!text) return;
      try { const { error } = await supabase.from("messages").insert({ athlete_id: user.uid, sender_id: user.uid, target_id: user.uid, channel, type: String(message.tipo || "message").slice(0, 40), text: text.slice(0, 4000), metadata: message.meta || null }); if (error) throw error; return true; }
      catch (error) { badgeText(friendlyAuthError(error), true); return false; }
    }
  };
  const openNotification = destination => {
    if(destination==="workout")api.openWorkout?.();
    else if(destination==="profilo")api.openProfilo?.();
    else api.openChat?.();
  };
  alerts=createNotifications({
    role:"athlete",uid:user.uid,
    types:[
      {id:"chat",label:"Nuovi messaggi",enabled:true},
      {id:"program",label:"Nuova scheda",enabled:true},
      {id:"timer",label:"Timer di recupero",detail:"Avviso a fine recupero. Volume e suoneria si regolano nella sezione Timer.",enabled:true},
      {id:"profilo",label:"Promemoria del profilo",detail:"Ad esempio la data di nascita da completare.",enabled:true}
    ],
    onOpen:openNotification
  });
  // Clienti già iscritti senza data di nascita: un promemoria al giorno finché non la inseriscono.
  if(!window.__LIPPOLIS_PROFILE__?.birthDate){
    const keyNascita=`lippolis-promemoria-nascita:${user.uid}`, oggi=new Date().toLocaleDateString("sv-SE");
    let ultimo=""; try{ ultimo=localStorage.getItem(keyNascita)||""; }catch{}
    if(ultimo!==oggi) setTimeout(()=>{
      if(window.__LIPPOLIS_PROFILE__?.birthDate) return;
      void Promise.resolve(alerts.notify("profilo",{title:"Aggiungi la tua data di nascita",body:"Ti basta un attimo: la trovi nel Profilo.",destination:"profilo"}))
        .then(()=>{ try{ localStorage.setItem(keyNascita,oggi); }catch{} }).catch(()=>{});
    },4000);
  }
  window.lippolisAlerts={
    mount:alerts.mount,
    timerDone:()=>alerts.notify("timer",{title:"Recupero terminato",body:"È ora della prossima serie.",
      destination:"workout",backgroundOnly:true,silent:true})
  };
  const activationBanner=document.getElementById("athleteNotificationBanner");
  if(activationBanner)alerts.mountActivationBanner(activationBanner);
  const settings=document.getElementById("athleteAlertSettings");
  if(settings)alerts.mount(settings);
  const chatSettings=document.getElementById("athleteChatNotify");
  if(chatSettings)chatSettings.hidden=false;
  window.lippolisChat={
    send:async text=>{
      const sent=await window.lippolisCloudSync.sendMessage({tipo:"message",testo:text,meta:{plainText:true}},"thread");
      if(sent)void loadMessages(user.uid).catch(error=>badgeText(friendlyAuthError(error),true));
      return sent;
    },
    read:()=>readAthleteChat(user.uid).catch(error=>badgeText(friendlyAuthError(error),true))
  };
  if(api.setChatCoach)void supabase.rpc("athlete_chat_coach_name").then(({data,error})=>{
    if(!error&&data)api.setChatCoach(data);
  });
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)void loadMessages(user.uid).catch(error=>badgeText(friendlyAuthError(error),true));});
  if(typeof navigator!=="undefined")navigator.serviceWorker?.addEventListener("message",event=>{
    if(event.data?.type==="open-chat")openNotification("chat");
    if(event.data?.type==="open-notification")openNotification(event.data.destination);
  });
  if(location.hash==="#chat"||location.hash==="#workout")openNotification(location.hash.slice(1));

  supabase.channel(`athlete-state:${user.uid}`).on("postgres_changes", { event: "*", schema: "public", table: "athlete_states", filter: `user_id=eq.${user.uid}` }, (payload) => {
    applyRemoteState(user.uid, payload.new);
  }).subscribe((status) => {
    if (status === "SUBSCRIBED") void refreshRemoteState(user.uid).catch((error) => badgeText(friendlyAuthError(error), true));
  });
  supabase.channel(`athlete-profile:${user.uid}`).on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.uid}` }, async (payload) => {
    if (payload.new?.status === "active") return;
    stopNutritionWatch?.();
    coachSectionsWatch?.stop();
    await supabase.auth.signOut(); alert("Il tuo accesso non è più attivo."); location.replace("index.html");
  }).subscribe();
  supabase.channel(`athlete-program:${user.uid}`).on("postgres_changes", { event: "*", schema: "public", table: "programs", filter: `athlete_id=eq.${user.uid}` }, (payload) => {
    if (payload.eventType === "DELETE") {
      void refreshRemoteProgram(user.uid).catch((error) => badgeText(friendlyAuthError(error), true));
      return;
    }
    if (!payload.new?.program) return;
    programEventSequence++;
    pendingRemoteProgram = payload.new;
    applyRemoteChanges(user.uid);
  }).subscribe((status) => {
    if (status === "SUBSCRIBED") void refreshRemoteProgram(user.uid).catch((error) => badgeText(friendlyAuthError(error), true));
  });
  supabase.channel(`athlete-messages:${user.uid}`).on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `athlete_id=eq.${user.uid}` }, event=>{
    if(event.eventType==="INSERT"&&event.new?.channel==="thread"&&event.new.sender_id!==user.uid){
      if(document.hidden||!api.isChatOpen?.()){
        void alerts.notify("chat",{title:"Nuovo messaggio",body:"Il tuo PT ti ha scritto.",
          action:"Apri chat",destination:"chat"});
      }
    }
    void loadMessages(user.uid).catch(error=>badgeText(friendlyAuthError(error),true));
  }).subscribe(status=>{if(status==="SUBSCRIBED")void loadMessages(user.uid).catch(error=>badgeText(friendlyAuthError(error),true));});
  cloudReady = true;
  if (pendingSnapshot) void flush(user.uid);
  else if (!stateDoc) window.lippolisCloudSync.queue(api.snapshot());
  applyRemoteChanges(user.uid);
  void loadMessages(user.uid).catch((error) => badgeText(friendlyAuthError(error), true));
  stopNutritionWatch = watchAthleteNutrition(user.uid, (value) => api.applyNutrition(value));
  // Impostazioni dell'app scelte dal PT (sezioni visibili, data degli allenamenti, macro nascosti).
  const loadAppSettings = async () => {
    const { data, error } = await supabase.rpc("athlete_app_settings");
    if (!error) api.applyAppSettings?.(data && typeof data === "object" ? data : {});
  };
  void loadAppSettings().catch(() => {});
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void loadAppSettings().catch(() => {}); });
  void import("./athlete-coach-sections.mjs").then(({watchCoachSections})=>{
    coachSectionsWatch=watchCoachSections(user.uid,(value)=>api.applyCoachSections(value));
    window.lippolisCoachSections=coachSectionsWatch;
  }).catch((error)=>badgeText(friendlyAuthError(error),true));
  return true;
}

async function flush(uid) {
  if (!cloudReady || saving || !pendingSnapshot) return;
  clearTimeout(saveTimer); const snapshot = pendingSnapshot; pendingSnapshot = null; saving = true; badgeText("Sincronizzazione…");
  const remoteRevision = Number(pendingRemoteState?.revision || 0);
  const reconciledState = remoteRevision >= knownRevision ? pendingRemoteState : null;
  if (reconciledState) knownRevision = remoteRevision;
  let working = reconciledState ? mergeQueuedSnapshot(reconciledState.snapshot, snapshot) : snapshot;
  if (reconciledState) working.bia = reconciledState.snapshot?.bia || [];
  let needsReconciliation = Boolean(reconciledState);
  let failure = null;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await supabase.rpc("save_athlete_state", { p_expected_revision: knownRevision, p_snapshot: working });
      if (!error) {
        knownRevision = Number(data);
        if (needsReconciliation) recordRemoteState({ revision: knownRevision, snapshot: working });
        retryCount = 0;
        sessionStorage.setItem(`lippolis_cloud_boot_${uid}`, `${knownRevision}:${knownProgramVersion}`);
        badgeText("Salvato e sincronizzato");
        failure = null;
        break;
      }
      if (error.code !== "40001" && !/STATE_CONFLICT/.test(error.message || "")) throw error;
      const { data: latest, error: readError } = await supabase.from("athlete_states").select("snapshot, revision").eq("user_id", uid).maybeSingle();
      if (readError) throw readError;
      knownRevision = Number(latest?.revision || 0);
      recordRemoteState(latest);
      working = mergeQueuedSnapshot(latest?.snapshot, mergeQueuedSnapshot(working, pendingSnapshot));
      working.bia = latest?.snapshot?.bia || [];
      needsReconciliation = true;
      pendingSnapshot = null; failure = error;
    }
    if (failure) throw failure;
  } catch (error) {
    pendingSnapshot = mergeQueuedSnapshot(working, pendingSnapshot);
    retryCount = Math.min(retryCount + 1, 6);
    const conflict = error.code === "40001" || /STATE_CONFLICT/.test(error.message || "");
    badgeText(conflict ? "Sincronizzazione in conflitto: riprovo" : "Offline: dati in coda per la sincronizzazione", true);
  } finally {
    saving = false;
    if (pendingSnapshot) scheduleFlush(uid, retryCount ? Math.min(30000, 800 * 2 ** retryCount) : 150);
    else applyRemoteChanges(uid);
  }
}

// Prima di uscire o cambiare account: i dati della sessione devono essere arrivati online.
async function syncBeforeLeave(uid, verbo = "uscire") {
  api.flushPendingSave?.();
  for (let attempt = 0; (pendingSnapshot || saving) && attempt < 3; attempt++) {
    if (!saving) await flush(uid);
    if (pendingSnapshot || saving) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (pendingSnapshot || saving) {
    badgeText(`Dati ancora in attesa: riconnettiti e riprova a ${verbo}`, true);
    alert(`Non riesco a sincronizzare le ultime modifiche. Restano salvate su questo dispositivo: riconnettiti e riprova a ${verbo}.`);
    return false;
  }
  stopNutritionWatch?.();
  coachSectionsWatch?.stop();
  return true;
}
async function logoutAfterSync(uid) {
  if (!(await syncBeforeLeave(uid))) return false;
  await logout(); return true;
}

async function flushOnPageHide() {
  if (!cloudReady || !currentAccessToken || !pendingSnapshot || !supabaseConfigured) return;
  const { url, publishableKey } = window.LIPPOLIS_SUPABASE_CONFIG || {};
  const snapshot = mergeQueuedSnapshot(pendingSnapshot, api.snapshot());
  const body = JSON.stringify({ p_expected_revision: knownRevision, p_snapshot: snapshot });
  // Keepalive è limitato dai browser a circa 64 KB; gli snapshot più grandi sono già
  // sincronizzati dalla normale coda e non devono essere troncati qui.
  if (new Blob([body]).size > 60000) return;
  pendingSnapshot = snapshot;
  try {
    await fetch(`${url}/rest/v1/rpc/save_athlete_state`, { method: "POST", keepalive: true,
      headers: { apikey: publishableKey, Authorization: `Bearer ${currentAccessToken}`, "Content-Type": "application/json" }, body });
  } catch { /* il dato resta in locale e la coda riparte alla prossima apertura */ }
}
window.addEventListener("pagehide", () => { void flushOnPageHide(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && pendingSnapshot && currentUserId) void flush(currentUserId); });
window.addEventListener("online", async () => { const { data: { session } } = await supabase.auth.getSession(); if (pendingSnapshot && session?.user) scheduleFlush(session.user.id, 0); });
if (!supabaseConfigured) { alert("Configura Supabase in supabase-config.js."); location.replace("index.html"); }
else { const session = await getAuthorizedSession({ requireRole: "athlete" }); if (session.reason) { alert(session.reason); location.replace("index.html"); } else bootstrap(session).catch((error) => { alert(friendlyAuthError(error)); location.replace("index.html"); }); }
