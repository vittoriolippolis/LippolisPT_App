import { adminCall, missingSupabaseKeys, normalizeUser, supabase, supabaseConfigured } from "./supabase.mjs";
import { destinationFor, friendlyAuthError, loadProfile, profileBlockReason } from "./auth.mjs";
import { savedAccounts, switchToAccount } from "./account-switch.mjs";

const $ = (id) => document.getElementById(id);
const message = $("message");
let recoveryMode = false;

function showMessage(text, error = false) { message.textContent = text; message.className = `message show${error ? " error" : ""}`; }
function busy(button, state, text = "Attendi…") { button.disabled = state; if (!button.dataset.label) button.dataset.label = button.textContent; button.textContent = state ? text : button.dataset.label; }
function showPasswordStep(title, lead) {
  $("loginBox").classList.add("hidden"); $("onboardingBox").classList.add("show");
  $("onboardingBox").querySelector("h2").textContent = title; $("onboardingLead").textContent = lead;
  $("verifyStep").hidden = true; $("passwordStep").hidden = false;
}

document.querySelectorAll("[data-toggle]").forEach((button) => button.addEventListener("click", () => {
  const input = $(button.dataset.toggle); input.type = input.type === "password" ? "text" : "password";
  button.setAttribute("aria-label", input.type === "password" ? "Mostra password" : "Nascondi password");
}));

if (!supabaseConfigured) {
  $("configError").hidden = false;
  $("configError").textContent = `Configurazione Supabase incompleta (${missingSupabaseKeys.join(", ")}). Compila supabase-config.js prima di usare l’accesso.`;
  $("loginForm").querySelectorAll("input,button").forEach((el) => { el.disabled = true; });
}

async function routeUser(rawUser) {
  const user = normalizeUser(rawUser); if (!user) return;
  if (recoveryMode) return showPasswordStep("Scegli una nuova password", user.email || "");
  const profile = await loadProfile(user.uid); const reason = profileBlockReason(profile);
  if (reason) { await supabase.auth.signOut(); showMessage(reason, true); return; }
  if (profile.role === "athlete" && !profile.onboardingComplete) {
    showPasswordStep("Completa il primo accesso", `${profile.firstName || ""} ${profile.lastName || ""}`.trim() || user.email); return;
  }
  sessionStorage.setItem("lippolis_uid", user.uid); location.replace(destinationFor(profile));
}

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const button = $("loginButton"); busy(button, true, "Accesso…");
  try { const { data, error } = await supabase.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value }); if (error) throw error; await routeUser(data.user); }
  catch (error) { showMessage(friendlyAuthError(error), true); } finally { busy(button, false); }
});

$("resetButton").addEventListener("click", async () => {
  const email = $("email").value.trim(); if (!email) return showMessage("Inserisci prima l’indirizzo email.", true);
  try { const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: new URL("index.html", location.href).href }); if (error) throw error; showMessage("Se l’account esiste, riceverai le istruzioni per reimpostare la password."); }
  catch (error) { showMessage(friendlyAuthError(error), true); }
});

$("sendVerification").addEventListener("click", () => showMessage("Gli account creati dal PT sono già autorizzati."));
$("refreshVerification").addEventListener("click", async () => { const { data } = await supabase.auth.getUser(); await routeUser(data.user); });

$("completeOnboarding").addEventListener("click", async () => {
  const button = $("completeOnboarding"); const password = $("newPassword").value;
  if (password.length < 12) return showMessage("La password deve contenere almeno 12 caratteri.", true);
  if (password !== $("confirmPassword").value) return showMessage("Le password non coincidono.", true);
  busy(button, true, "Completamento…");
  try {
    const { error } = await supabase.auth.updateUser({ password }); if (error) throw error;
    if (recoveryMode) {
      recoveryMode = false; await supabase.auth.signOut(); $("onboardingBox").classList.remove("show"); $("loginBox").classList.remove("hidden");
      return showMessage("Password aggiornata. Ora puoi accedere.");
    }
    await adminCall("completeOnboarding");
    const { data: { user } } = await supabase.auth.getUser(); const profile = await loadProfile(user.id);
    sessionStorage.setItem("lippolis_uid", user.id); location.replace(destinationFor(profile));
  } catch (error) { showMessage(friendlyAuthError(error), true); } finally { busy(button, false); }
});

$("onboardingLogout").addEventListener("click", async () => { await supabase.auth.signOut(); location.reload(); });

if (supabaseConfigured) {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") recoveryMode = true;
    if (session?.user) setTimeout(() => routeUser(session.user).catch((error) => showMessage(friendlyAuthError(error), true)), 0);
  });
}

// Account già salvati su questo dispositivo (Cambia account): si riaprono con un tocco.
function paintSavedAccounts() {
  const host = $("savedAccounts"); if (!host || !supabaseConfigured) return;
  const accounts = savedAccounts(); host.hidden = !accounts.length; if (!accounts.length) return;
  if (new URLSearchParams(location.search).has("altro-account")) $("loginBox").querySelector(".lead").textContent = "Entra con l’altro account: resterà salvato su questo dispositivo e potrai passare dall’uno all’altro con «Cambia account».";
  const head = document.createElement("div"); head.className = "sa-h"; head.textContent = "Account salvati su questo dispositivo";
  const or = document.createElement("div"); or.className = "sa-or"; or.textContent = "oppure accedi con un altro account";
  host.replaceChildren(head);
  for (const account of accounts) {
    const row = document.createElement("button"); row.type = "button"; row.className = "sa-row";
    row.innerHTML = '<span class="sa-av"></span><span><b></b><small></small></span>';
    row.querySelector(".sa-av").textContent = String(account.name).split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
    row.querySelector("b").textContent = account.name;
    row.querySelector("small").textContent = `${account.role === "coach" ? "Personal Trainer" : "Cliente"} · ${account.email}`;
    row.onclick = async () => {
      host.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      try { await switchToAccount(account.uid); }
      catch (error) { showMessage(error.message, true); paintSavedAccounts(); }
    };
    host.append(row);
  }
  host.append(or);
}
paintSavedAccounts();
