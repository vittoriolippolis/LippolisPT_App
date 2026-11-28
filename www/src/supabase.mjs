import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const config = window.LIPPOLIS_SUPABASE_CONFIG || {};
const missing = ["url", "publishableKey"].filter(
  (key) => !config[key] || /^(LA_TUA_|IL_TUO_)/.test(String(config[key]))
);

export const supabaseConfigured = missing.length === 0;
export const missingSupabaseKeys = missing;
export const supabase = supabaseConfigured
  ? createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

export function assertSupabaseConfigured() {
  if (!supabaseConfigured) throw new Error(`Configurazione Supabase incompleta: ${missing.join(", ")}`);
}

export function profileFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    trainerId: row.trainer_id,
    status: row.status,
    onboardingComplete: row.onboarding_complete,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    suspendedAt: row.suspended_at,
    birthDate: row.birth_date || null
  };
}

export function rowFromProfile(value) {
  return {
    first_name: String(value.firstName || "").trim(),
    last_name: String(value.lastName || "").trim(),
    display_name: String(value.displayName || "").trim(),
    updated_at: new Date().toISOString()
  };
}

export function normalizeUser(user) {
  return user ? { ...user, uid: user.id, emailVerified: Boolean(user.email_confirmed_at) } : null;
}

export async function adminCall(action, payload = {}) {
  assertSupabaseConfigured();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw Object.assign(new Error("Accesso richiesto."), { code: "unauthenticated" });
  const response = await fetch(`${config.url}/functions/v1/admin-api`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: config.publishableKey
    },
    body: JSON.stringify({ action, ...payload })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || "Operazione non riuscita."), { code: body.code || `http-${response.status}` });
  return body.data;
}

export async function clientInviteCall(action, token, fields = {}) {
  assertSupabaseConfigured();
  const response = await fetch(`${config.url}/functions/v1/client-invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.publishableKey },
    body: JSON.stringify({ ...fields, action, token })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Registrazione momentaneamente non disponibile.");
  return body;
}
