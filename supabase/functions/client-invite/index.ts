import { createClient } from "npm:@supabase/supabase-js@2";
import { validateClientRegistration } from "../_shared/validation.mjs";

const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const admin = createClient(Deno.env.get("SUPABASE_URL")!, keys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false }
});
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
const unavailable = () => json(410, { error: "Invito non valido, scaduto o già utilizzato. Chiedi un nuovo link al tuo PT." });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json(405, { error: "Metodo non consentito." });
  try {
    const payload = await request.json();
    if (typeof payload?.token !== "string" || !/^[a-f0-9]{64}$/.test(payload.token)) return unavailable();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload.token));
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    const { data: available, error: lookupError } = await admin.rpc("client_invite_available", { p_hash: hash });
    if (lookupError) throw lookupError;
    if (!available) return unavailable();
    if (payload.action === "check") return json(200, { valid: true });
    if (payload.action !== "register") return json(400, { error: "Azione non valida." });
    let input;
    try { input = validateClientRegistration(payload, { requireBirthDate: true }); }
    catch (error) { return json(400, { error: (error as Error).message }); }
    const { data, error } = await admin.auth.admin.createUser({
      email: input.email, password: input.password, email_confirm: true,
      app_metadata: { lippolis_invite: hash },
      user_metadata: { first_name: input.firstName, last_name: input.lastName, birth_date: input.birthDate }
    });
    if (error || !data.user) {
      const { data: stillAvailable } = await admin.rpc("client_invite_available", { p_hash: hash });
      if (stillAvailable === false) return unavailable();
      if (/already|registered|exists/i.test(error?.message || "")) return json(409, { error: "Esiste già un account con questa email." });
      throw error || new Error("User creation failed");
    }
    return json(201, { created: true });
  } catch {
    return json(500, { error: "Registrazione momentaneamente non disponibile. Riprova." });
  }
});
