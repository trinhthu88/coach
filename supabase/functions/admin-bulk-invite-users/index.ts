import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { inviteUser } from "../_shared/inviteUser.ts";

const SITE_URL = "https://clariva.club";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

interface RawRow {
  row_id?: string;
  email?: string;
  full_name?: string;
  role?: string;
  assign_coach_email?: string;
  /** Resume path: the coach id already resolved by an earlier validation pass. */
  assign_coach_id?: string;
  session_limit?: number;
}

type Problem = "bad_email" | "invalid_role" | "duplicate_in_file" | "coach_not_found" | null;

const PROBLEM_MESSAGE: Record<Exclude<Problem, null>, string> = {
  bad_email: "Invalid email format",
  invalid_role: "Role must be 'coach' or 'coachee'",
  duplicate_in_file: "Duplicate email in this file",
  coach_not_found: "No matching active coach found for assign_coach_email",
};

interface ValidatedRow {
  row_index: number;
  row_id?: string;
  email: string;
  full_name: string;
  role: "coach" | "coachee";
  session_limit?: number;
  resolvedCoachId: string | null;
  problem: Problem;
  alreadyExists: boolean;
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

    const claims = decodeJwtPayload(token);
    const callerId = typeof claims?.sub === "string" ? claims.sub : null;
    if (!callerId) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", callerId);
    const isAdmin = (roleRows ?? []).some((r: { role: string }) => r.role === "admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { dryRun, batchId, rows: rawRows } = body as {
      dryRun?: boolean;
      batchId?: string;
      rows?: RawRow[];
    };
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return new Response(JSON.stringify({ error: "rows required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Bulk pre-fetch instead of per-row round trips — this needs to stay fast at the
    // ~200-row scale a real import batch runs at.
    const [{ data: allProfiles }, { data: allCoachRoles }, { data: allCoachProfiles }] = await Promise.all([
      admin.from("profiles").select("id, email"),
      admin.from("user_roles").select("user_id").eq("role", "coach"),
      admin.from("coach_profiles").select("id, approval_status"),
    ]);
    const profileIdByEmail = new Map((allProfiles ?? []).map((p) => [p.email.toLowerCase(), p.id as string]));
    const coachIdSet = new Set((allCoachRoles ?? []).map((r) => r.user_id as string));
    const activeCoachIdSet = new Set(
      (allCoachProfiles ?? []).filter((cp) => cp.approval_status === "active").map((cp) => cp.id as string)
    );
    const resolveCoachByEmail = (coachEmail: string): string | null => {
      const id = profileIdByEmail.get(coachEmail.toLowerCase());
      if (!id || !coachIdSet.has(id) || !activeCoachIdSet.has(id)) return null;
      return id;
    };

    const seenEmails = new Set<string>();
    const validated: ValidatedRow[] = rawRows.map((raw, row_index) => {
      const email = (raw.email ?? "").trim().toLowerCase();
      const full_name = (raw.full_name ?? "").trim();
      const role = raw.role === "coach" || raw.role === "coachee" ? raw.role : null;

      let problem: Problem = null;
      if (!EMAIL_RE.test(email) || !full_name) problem = "bad_email";
      else if (!role) problem = "invalid_role";
      else if (seenEmails.has(email)) problem = "duplicate_in_file";

      if (email && !problem) seenEmails.add(email);

      let resolvedCoachId: string | null = null;
      if (!problem && role === "coachee") {
        if (raw.assign_coach_id) {
          resolvedCoachId = activeCoachIdSet.has(raw.assign_coach_id) ? raw.assign_coach_id : null;
          if (!resolvedCoachId) problem = "coach_not_found";
        } else if (raw.assign_coach_email && raw.assign_coach_email.trim()) {
          resolvedCoachId = resolveCoachByEmail(raw.assign_coach_email.trim());
          if (!resolvedCoachId) problem = "coach_not_found";
        }
      }

      const alreadyExists = !problem && profileIdByEmail.has(email);

      return {
        row_index,
        row_id: raw.row_id,
        email,
        full_name,
        role: (role ?? "coachee") as "coach" | "coachee",
        session_limit: raw.session_limit,
        resolvedCoachId,
        problem,
        alreadyExists,
      };
    });

    if (dryRun) {
      const results = validated.map((v) => ({
        row_index: v.row_index,
        email: v.email,
        status: v.problem ?? (v.alreadyExists ? "already_exists" : "valid"),
        message: v.problem ? PROBLEM_MESSAGE[v.problem] : v.alreadyExists ? "An account with this email already exists" : undefined,
      }));
      return new Response(JSON.stringify({ batch_id: null, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Real run: resolve/create the batch, then insert any not-yet-tracked rows as
    // 'pending' up front — so a crash mid-loop still leaves the untouched rows
    // resumable, not silently lost.
    let resolvedBatchId = batchId ?? null;
    if (!resolvedBatchId) {
      const { data: batch, error: batchErr } = await admin
        .from("bulk_invite_batches")
        .insert({ created_by: callerId, total_rows: validated.length })
        .select("id")
        .single();
      if (batchErr || !batch) {
        return new Response(JSON.stringify({ error: batchErr?.message || "Failed to create batch" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      resolvedBatchId = batch.id;
    }

    for (const v of validated) {
      if (v.row_id) continue;
      const { data: inserted, error: insertErr } = await admin
        .from("bulk_invite_rows")
        .insert({
          batch_id: resolvedBatchId,
          row_index: v.row_index,
          email: v.email,
          full_name: v.full_name,
          role: v.role,
          assign_coach_id: v.resolvedCoachId,
          session_limit: v.session_limit ?? null,
          status: "pending",
        })
        .select("id")
        .single();
      if (!insertErr && inserted) v.row_id = inserted.id;
    }

    const results: Array<{
      row_index: number;
      row_id?: string;
      email: string;
      status: "invited" | "failed" | "skipped";
      message?: string;
      created_user_id?: string;
    }> = [];

    for (const v of validated) {
      if (v.problem || v.alreadyExists) {
        const message = v.problem ? PROBLEM_MESSAGE[v.problem] : "Account already exists";
        if (v.row_id) {
          await admin.from("bulk_invite_rows").update({ status: "skipped", error_message: message }).eq("id", v.row_id);
        }
        results.push({ row_index: v.row_index, row_id: v.row_id, email: v.email, status: "skipped", message });
        continue;
      }

      const invited = await inviteUser(admin, {
        email: v.email,
        full_name: v.full_name,
        role: v.role,
        assignCoachId: v.resolvedCoachId ?? undefined,
        callerId,
        siteUrl: SITE_URL,
      });

      if (invited.status === "invited") {
        if (v.role === "coachee" && typeof v.session_limit === "number" && Number.isFinite(v.session_limit) && v.session_limit > 0) {
          await admin
            .from("session_limits")
            .upsert(
              { coachee_id: invited.created_user_id, monthly_limit: Math.floor(v.session_limit) },
              { onConflict: "coachee_id" }
            );
        }
        if (v.row_id) {
          await admin
            .from("bulk_invite_rows")
            .update({ status: "invited", created_user_id: invited.created_user_id, error_message: null })
            .eq("id", v.row_id);
        }
        results.push({ row_index: v.row_index, row_id: v.row_id, email: v.email, status: "invited", created_user_id: invited.created_user_id });
      } else if (invited.status === "already_exists") {
        const message = "Account already exists";
        if (v.row_id) {
          await admin.from("bulk_invite_rows").update({ status: "skipped", error_message: message }).eq("id", v.row_id);
        }
        results.push({ row_index: v.row_index, row_id: v.row_id, email: v.email, status: "skipped", message });
      } else {
        if (v.row_id) {
          await admin.from("bulk_invite_rows").update({ status: "failed", error_message: invited.error_message }).eq("id", v.row_id);
        }
        results.push({ row_index: v.row_index, row_id: v.row_id, email: v.email, status: "failed", message: invited.error_message });
      }
    }

    return new Response(JSON.stringify({ batch_id: resolvedBatchId, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
