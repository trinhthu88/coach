import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SITE_URL = "https://clariva.club";
const DEFAULT_INVITE_LIMIT = 3;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json);
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

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // This function is configured with verify_jwt = true, so a request that reaches
    // this code already has a valid session. Decode the verified token to get the caller id.
    const claims = decodeJwtPayload(token);
    const callerId = typeof claims?.sub === "string" ? claims.sub : null;
    if (!callerId) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleRows } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    const isCoach = (roleRows ?? []).some((r: { role: string }) => r.role === "coach");
    if (!isCoach) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mirrors ProtectedRoute: 'active' and 'reach_limit' are the only statuses that
    // may act as a coach. Pending/suspended/rejected coaches cannot invite clients.
    const { data: callerProfile } = await admin
      .from("profiles")
      .select("status")
      .eq("id", callerId)
      .maybeSingle();
    const callerStatus = callerProfile?.status;
    if (callerStatus !== "active" && callerStatus !== "reach_limit") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { email: rawEmail, full_name, session_limit } = body as {
      email?: string;
      full_name?: string;
      session_limit?: number;
    };
    const email = (rawEmail ?? "").trim().toLowerCase();
    const fullName = (full_name ?? "").trim();
    if (!email || !fullName) {
      return new Response(JSON.stringify({ error: "email and full_name required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cap check, before creating anything.
    const { data: coachProfile } = await admin
      .from("coach_profiles")
      .select("max_coachee_invites")
      .eq("id", callerId)
      .maybeSingle();
    const effectiveLimit = coachProfile?.max_coachee_invites ?? DEFAULT_INVITE_LIMIT;

    // coachee_coach_allowlist has no FK to coachee_profiles, so PostgREST can't
    // auto-embed the join — resolve it as two plain queries instead.
    const { data: activeAllowRows, error: allowRowsErr } = await admin
      .from("coachee_coach_allowlist")
      .select("coachee_id")
      .eq("coach_id", callerId)
      .is("removed_at", null);
    if (allowRowsErr) {
      return new Response(JSON.stringify({ error: allowRowsErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const activeCoacheeIds = (activeAllowRows ?? []).map((r) => r.coachee_id);
    let used = 0;
    if (activeCoacheeIds.length > 0) {
      const { count: currentCount, error: countErr } = await admin
        .from("coachee_profiles")
        .select("id", { count: "exact", head: true })
        .in("id", activeCoacheeIds)
        .eq("approval_status", "active");
      if (countErr) {
        return new Response(JSON.stringify({ error: countErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      used = currentCount ?? 0;
    }
    if (used >= effectiveLimit) {
      return new Response(
        JSON.stringify({ error: "invite_limit_reached", limit: effectiveLimit, current: used }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Existing-email handling: never silently attach an existing account to a new
    // coach's allowlist — that's a future decision, not this one.
    const { data: existingProfile } = await admin
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (existingProfile?.id) {
      return new Response(JSON.stringify({ error: "email_already_registered" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, role: "coachee" },
      redirectTo: `${SITE_URL}/set-new-password`,
    });
    if (inviteErr || !invited.user) {
      return new Response(
        JSON.stringify({ error: inviteErr?.message || "Failed to invite user" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const coacheeId = invited.user.id;

    // handle_new_user() already created profiles/user_roles/coachee_profiles rows
    // (status = pending_approval) via the auth.users insert trigger.
    await admin.from("profiles").update({ must_change_password: true }).eq("id", coacheeId);

    const { error: allowErr } = await admin.from("coachee_coach_allowlist").insert({
      coachee_id: coacheeId,
      coach_id: callerId,
      created_by: callerId,
    });
    if (allowErr) {
      return new Response(JSON.stringify({ error: allowErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (typeof session_limit === "number" && Number.isFinite(session_limit) && session_limit > 0) {
      await admin
        .from("session_limits")
        .upsert(
          { coachee_id: coacheeId, monthly_limit: Math.floor(session_limit) },
          { onConflict: "coachee_id" }
        );
    }

    return new Response(
      JSON.stringify({ ok: true, coachee_id: coacheeId, email }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
