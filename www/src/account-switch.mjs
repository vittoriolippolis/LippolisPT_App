// Più account sullo stesso dispositivo (es. il PT che è anche cliente di sé stesso):
// ricorda l'accesso di ognuno e passa dall'uno all'altro senza riscrivere email e password.
// Gli accessi restano solo su questo dispositivo, come quello attivo che Supabase salva già.
// Mai signOut quando si cambia account: revocherebbe l'accesso che vogliamo riprendere dopo.
import { supabase } from "./supabase.mjs";
import { destinationFor } from "./auth.mjs";

export const SAVED_ACCOUNTS_KEY = "lpt_account_salvati";
const ROLE = { coach: "Personal Trainer", athlete: "Cliente" };

function read() {
  try { const value = JSON.parse(localStorage.getItem(SAVED_ACCOUNTS_KEY) || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}
function write(accounts) { try { localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(accounts)); } catch {} }

export function savedAccounts() {
  return Object.values(read()).filter((a) => a?.uid && a.refresh_token).sort((a, b) => (a.role === b.role ? 0 : a.role === "coach" ? -1 : 1) || String(a.name).localeCompare(String(b.name)));
}

export function forgetAccount(uid) { const accounts = read(); delete accounts[uid]; write(accounts); }

function storeTokens(session) {
  if (!session?.user?.id || !session.refresh_token) return;
  const accounts = read(); const entry = accounts[session.user.id];
  if (!entry) return;
  accounts[session.user.id] = { ...entry, access_token: session.access_token, refresh_token: session.refresh_token, savedAt: Date.now() };
  write(accounts);
}

let watching = false;
// Da chiamare a ogni apertura di app cliente o pannello, a login riuscito.
export async function rememberAccount(profile, user) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user || session.user.id !== profile.id) return;
  const accounts = read();
  accounts[profile.id] = {
    uid: profile.id,
    email: profile.email || user?.email || session.user.email || "",
    name: profile.displayName || `${profile.firstName || ""} ${profile.lastName || ""}`.trim() || profile.email || "Account",
    role: profile.role,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    savedAt: Date.now()
  };
  write(accounts);
  // Il codice di accesso si rinnova da solo: teniamo sempre l'ultimo, il vecchio non vale più.
  if (!watching) { watching = true; supabase.auth.onAuthStateChange((_event, next) => storeTokens(next)); }
}

async function currentSession() { const { data: { session } } = await supabase.auth.getSession(); return session; }

function clearLocalAuth() {
  try {
    const projectRef = new URL(window.LIPPOLIS_SUPABASE_CONFIG?.url).hostname.split(".")[0];
    const storageKey = supabase?.auth?.storageKey || `sb-${projectRef}-auth-token`;
    for (const key of Object.keys(localStorage)) if (key === storageKey || key.startsWith(`${storageKey}-`)) localStorage.removeItem(key);
  } catch {}
  try { sessionStorage.removeItem("lippolis_uid"); } catch {}
}

// Passa all'account salvato `uid`. `beforeLeave` salva i dati dell'area aperta; se risponde false si resta.
export async function switchToAccount(uid, { beforeLeave } = {}) {
  const target = read()[uid];
  if (!target) throw new Error("Account non trovato su questo dispositivo.");
  const previous = await currentSession();
  if (previous?.user?.id === uid) return false;
  storeTokens(previous);
  if (beforeLeave && !(await beforeLeave())) return false;
  const { data, error } = await supabase.auth.setSession({ access_token: target.access_token, refresh_token: target.refresh_token });
  if (error || !data?.session || data.session.user.id !== uid) {
    forgetAccount(uid);
    if (previous) await supabase.auth.setSession({ access_token: previous.access_token, refresh_token: previous.refresh_token }).catch(() => {});
    throw new Error(`L'accesso salvato di ${target.name} è scaduto: aggiungilo di nuovo con email e password.`);
  }
  storeTokens(data.session);
  location.replace(new URL(destinationFor(target), location.href).href);
  return true;
}

// Porta al login per entrare con un altro account, lasciando salvato quello attuale.
export async function addAnotherAccount({ beforeLeave } = {}) {
  storeTokens(await currentSession());
  if (beforeLeave && !(await beforeLeave())) return false;
  clearLocalAuth();
  location.replace(new URL("index.html?altro-account=1", location.href).href);
  return true;
}

// Menu «Cambia account»: account salvati (quello aperto segnato) + «Aggiungi un altro account».
export function openAccountMenu({ currentUid, beforeLeave } = {}) {
  document.getElementById("accountMenu")?.remove();
  const box = document.createElement("div");
  box.id = "accountMenu"; box.className = "account-menu"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Cambia account");
  const panel = document.createElement("div"); panel.className = "account-menu-panel";
  const title = document.createElement("div"); title.className = "account-menu-title"; title.textContent = "Cambia account";
  panel.append(title);
  const status = document.createElement("p"); status.className = "account-menu-status"; status.setAttribute("role", "status");
  for (const account of savedAccounts()) {
    const current = account.uid === currentUid;
    const row = document.createElement("button"); row.type = "button"; row.className = "account-row" + (current ? " current" : "");
    row.disabled = current;
    const initials = String(account.name).split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase() || "?";
    row.innerHTML = '<span class="account-av"></span><span class="account-txt"><b></b><small></small></span><span class="account-tag"></span>';
    row.querySelector(".account-av").textContent = initials;
    row.querySelector("b").textContent = account.name;
    row.querySelector("small").textContent = `${ROLE[account.role] || ""} · ${account.email}`;
    row.querySelector(".account-tag").textContent = current ? "In uso" : "Apri";
    if (!current) row.onclick = async () => {
      panel.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      status.textContent = "Cambio account…";
      try { if (!(await switchToAccount(account.uid, { beforeLeave }))) { box.remove(); } }
      catch (error) { status.textContent = error.message; panel.querySelectorAll("button").forEach((b) => { b.disabled = b.classList.contains("current"); }); }
    };
    panel.append(row);
  }
  const add = document.createElement("button"); add.type = "button"; add.className = "account-add"; add.textContent = "+ Aggiungi un altro account";
  add.onclick = async () => { add.disabled = true; if (!(await addAnotherAccount({ beforeLeave }))) add.disabled = false; };
  const close = document.createElement("button"); close.type = "button"; close.className = "account-close"; close.textContent = "Chiudi";
  close.onclick = () => box.remove();
  panel.append(add, status, close);
  box.append(panel);
  box.onclick = (e) => { if (e.target === box) box.remove(); };
  document.body.append(box);
  (panel.querySelector(".account-row:not(.current)") || add).focus();
  return box;
}

export const otherSavedAccounts = (uid) => savedAccounts().filter((a) => a.uid !== uid);
