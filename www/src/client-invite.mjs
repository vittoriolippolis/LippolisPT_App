import { clientInviteCall, supabase } from "./supabase.mjs";

const form = document.getElementById("registration");
const status = document.getElementById("inviteStatus");
const token = new URLSearchParams(location.hash.slice(1)).get("token");
const birth = form.querySelector('[name="birthDate"]');
if (birth) { const d = new Date(); d.setFullYear(d.getFullYear() - 10); birth.max = d.toLocaleDateString("sv-SE"); }

async function checkInvite() {
  try {
    if (!token) throw new Error("Apri il link di invito ricevuto dal tuo PT.");
    await clientInviteCall("check", token);
    form.hidden = false;
    status.textContent = "";
  } catch (error) {
    status.textContent = error.message;
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const button = form.querySelector("button");
  const fields = Object.fromEntries(new FormData(form));
  button.disabled = true;
  status.textContent = "Creazione account…";
  try {
    await clientInviteCall("register", token, fields);
    history.replaceState(null, "", location.pathname);
    form.reset();
    form.hidden = true;
    const { error } = await supabase.auth.signInWithPassword({ email: fields.email.trim().toLowerCase(), password: fields.password });
    if (error) {
      status.textContent = "Account creato. Accedi con l’email e la password che hai scelto.";
      return;
    }
    location.replace("athlete.html");
  } catch (error) {
    status.textContent = form.hidden ? "Account creato. Accedi con l’email e la password che hai scelto." : error.message;
  } finally {
    button.disabled = false;
  }
});

void checkInvite();
