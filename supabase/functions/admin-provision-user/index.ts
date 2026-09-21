import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { resendSetupLink, runAdminInvite } from "../_shared/adminInvite.ts";
import type { InviteRowInput } from "../_shared/adminInviteRules.ts";

// The single admin entry point for adding people: single add (learner/coach),
// sponsor creation, bulk CSV/Excel import (with batch tracking + resume), and
// "resend setup link". All of it runs through _shared/adminInvite.ts.
//
// Body:
//   { action: "preview", rows }                       -> { preview }
//   { action: "execute", rows, track?, batchId? }     -> { batch_id, preview, results }
//   { action: "resend_setup_link", user_id }          -> { email, full_name, email_sent }
//
// Never generates, sets or returns a password.

const MAX_ROWS = 1000;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    // verify_jwt = true: the gateway already verified this token.
    const claims = decodeJwtPayload(token);
    const callerId = typeof claims?.sub === "string" ? claims.sub : null;
    if (!callerId) return json({ error: "Invalid session" }, 401);

    const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", callerId);
    const isAdmin = (roleRows ?? []).some((r: { role: string }) => r.role === "admin");
    if (!isAdmin) return json({ error: "Forbidden" }, 403);

    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      rows?: InviteRowInput[];
      track?: boolean;
      batchId?: string;
      user_id?: string;
    };

    if (body.action === "resend_setup_link") {
      if (!body.user_id) return json({ error: "user_id required" }, 400);
      const result = await resendSetupLink(admin, body.user_id);
      if (result.error && !result.email) return json({ error: result.error }, 404);
      return json(result);
    }

    if (body.action !== "preview" && body.action !== "execute") {
      return json({ error: "action must be preview, execute or resend_setup_link" }, 400);
    }
    if (!Array.isArray(body.rows) || body.rows.length === 0) return json({ error: "rows required" }, 400);
    if (body.rows.length > MAX_ROWS) return json({ error: `At most ${MAX_ROWS} rows per request` }, 400);

    const result = await runAdminInvite(admin, {
      rows: body.rows,
      callerId,
      dryRun: body.action === "preview",
      track: body.track === true,
      batchId: body.batchId ?? null,
    });
    return json(result);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
