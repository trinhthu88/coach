import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";

// Admin-invoked (verify_jwt = true), cohort-first:
//   cohort Triad requirement unit (cohort_requirement_dates row)
//   -> ongoing enrollments of THAT cohort (triad_requirement_candidates_internal)
//   -> minus learners already grouped for this unit
//   -> spoken-language pools -> coachee_availability overlap -> groups.
// A mixed-cohort group can never be formed: the pool is one cohort, and
// triad_create_group_internal + the membership trigger enforce it again.
//
// Idempotent: re-running clears this unit's auto-assigned groups nobody has
// acted on yet (every session still proposed, no responses) and rebuilds;
// anything a member already responded to is kept.

interface CandidateRow {
  enrollment_id: string;
  user_id: string;
  full_name: string | null;
  spoken_languages: string[];
  triad_group_id: string | null;
}

interface AvailabilityRow {
  coachee_id: string;
  slot_date: string; // YYYY-MM-DD
  start_time: string; // HH:MM:SS
  end_time: string;
}

type BucketSet = Set<string>; // "YYYY-MM-DD|HH" keys, one per free hour

const HOUR_MS = 60 * 60 * 1000;

function bucketsFor(rows: AvailabilityRow[]): BucketSet {
  const set = new Set<string>();
  for (const r of rows) {
    const [sh, sm] = r.start_time.split(":").map(Number);
    const [eh, em] = r.end_time.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    for (let m = startMin; m + 60 <= endMin; m += 60) {
      const hour = Math.floor(m / 60);
      set.add(`${r.slot_date}|${String(hour).padStart(2, "0")}`);
    }
  }
  return set;
}

function overlapCount(a: BucketSet, b: BucketSet): number {
  let n = 0;
  for (const k of a) if (b.has(k)) n++;
  return n;
}

function earliestCommonBucket(sets: BucketSet[]): string | null {
  const [first, ...rest] = sets;
  let candidates = [...first];
  for (const s of rest) candidates = candidates.filter((k) => s.has(k));
  if (candidates.length === 0) return null;
  candidates.sort();
  return candidates[0];
}

function bucketToRange(bucket: string): { start: string; end: string } {
  const [date, hourStr] = bucket.split("|");
  const hour = Number(hourStr);
  const start = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
  const end = new Date(start.getTime() + HOUR_MS);
  return { start: start.toISOString(), end: end.toISOString() };
}

// Greedy: repeatedly take the highest-scoring triplet, then handle the 0/1/2 remainder.
function groupPool(
  ids: string[],
  overlapOf: (a: string, b: string) => number,
): { triads: string[][]; dyad: string[] | null; leftover: string | null } {
  const remaining = new Set(ids);
  const triads: string[][] = [];

  while (remaining.size >= 3) {
    let best: [string, string, string] | null = null;
    let bestScore = -1;
    const arr = [...remaining];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        for (let k = j + 1; k < arr.length; k++) {
          const score = overlapOf(arr[i], arr[j]) + overlapOf(arr[i], arr[k]) + overlapOf(arr[j], arr[k]);
          if (score > bestScore) {
            bestScore = score;
            best = [arr[i], arr[j], arr[k]];
          }
        }
      }
    }
    if (!best) break;
    triads.push(best);
    for (const id of best) remaining.delete(id);
  }

  const rest = [...remaining];
  return {
    triads,
    dyad: rest.length === 2 ? rest : null,
    leftover: rest.length === 1 ? rest[0] : null,
  };
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let requirementId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "Invalid session" }, 401);
    const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", userData.user.id);
    if (!(roleRows ?? []).some((r: { role: string }) => r.role === "admin")) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    requirementId = body.cohort_requirement_date_id ?? null;
    if (!requirementId) return json({ error: "cohort_requirement_date_id is required" }, 400);

    const { data: requirement } = await admin
      .from("cohort_requirement_dates")
      .select("id, cohort_id, ordinal, due_on, module")
      .eq("id", requirementId)
      .maybeSingle();
    if (!requirement || requirement.module !== "triads") return json({ error: "Triad requirement not found" }, 404);
    const unitNumber = requirement.ordinal as number;
    const dueOn = requirement.due_on as string;
    const adminLink = `/admin/cohorts/${requirement.cohort_id}/triads`;

    await admin.rpc("triad_set_assignment_status_internal", { p_cohort_requirement_date_id: requirementId, p_status: "running" });

    // --- Idempotent re-run: clear this unit's untouched auto groups ---
    await admin.rpc("triad_clear_unconfirmed_auto_groups_internal", { p_cohort_requirement_date_id: requirementId });

    // --- The pool: this cohort's ongoing enrollments not yet grouped for this unit ---
    const { data: candidates, error: candidatesErr } = await admin.rpc("triad_requirement_candidates_internal", {
      p_cohort_requirement_date_id: requirementId,
    });
    if (candidatesErr) throw candidatesErr;
    const pool = ((candidates ?? []) as CandidateRow[]).filter((c) => !c.triad_group_id);
    const byUser = new Map(pool.map((c) => [c.user_id, c]));
    const participantIds = [...byUser.keys()];

    if (participantIds.length === 0) {
      const summary = { groups: 0, dyads: 0, flagged: 0 };
      await admin.rpc("triad_set_assignment_status_internal", { p_cohort_requirement_date_id: requirementId, p_status: "completed", p_summary: summary });
      return json({ ok: true, ...summary });
    }

    // Availability in the week leading up to the unit's canonical due date.
    const windowStart = new Date(new Date(`${dueOn}T00:00:00Z`).getTime() - 7 * 24 * HOUR_MS).toISOString().slice(0, 10);
    const { data: availability } = await admin
      .from("coachee_availability")
      .select("coachee_id, slot_date, start_time, end_time")
      .in("coachee_id", participantIds)
      .eq("is_booked", false)
      .gte("slot_date", windowStart)
      .lte("slot_date", dueOn);

    const availByUser = new Map<string, AvailabilityRow[]>();
    for (const row of (availability ?? []) as AvailabilityRow[]) {
      const list = availByUser.get(row.coachee_id) ?? [];
      list.push(row);
      availByUser.set(row.coachee_id, list);
    }
    const bucketsByUser = new Map<string, BucketSet>();
    for (const id of participantIds) bucketsByUser.set(id, bucketsFor(availByUser.get(id) ?? []));

    // --- Language pools: 'vi' pool includes bilinguals, 'en' pool is English-only ---
    const viPool = participantIds.filter((id) => byUser.get(id)?.spoken_languages?.includes("vi"));
    const enPool = participantIds.filter((id) => {
      const langs = byUser.get(id)?.spoken_languages ?? [];
      return langs.includes("en") && !langs.includes("vi");
    });

    const overlapCache = new Map<string, number>();
    function overlapOf(a: string, b: string): number {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      let v = overlapCache.get(key);
      if (v === undefined) {
        v = overlapCount(bucketsByUser.get(a) ?? new Set(), bucketsByUser.get(b) ?? new Set());
        overlapCache.set(key, v);
      }
      return v;
    }

    const adminAlerts: { id: string; reason: string }[] = [];
    let groupsCreated = 0;
    let dyadsCreated = 0;
    const roundTitle = `Triad round ${unitNumber}`;
    const roundTitleVi = `Vòng triad ${unitNumber}`;

    async function createGroup(memberIds: string[], language: string): Promise<boolean> {
      const sets = memberIds.map((id) => bucketsByUser.get(id) ?? new Set<string>());
      const commonBucket = memberIds.every((id) => (bucketsByUser.get(id)?.size ?? 0) > 0) ? earliestCommonBucket(sets) : null;
      const range = commonBucket ? bucketToRange(commonBucket) : null;

      const { data: groupId, error: groupErr } = await admin.rpc("triad_create_group_internal", {
        p_cohort_requirement_date_id: requirementId,
        p_enrollment_ids: memberIds.map((id) => byUser.get(id)!.enrollment_id),
        p_group_language: language,
        p_assigned_by: "auto",
        p_start: range?.start ?? null,
        p_end: range?.end ?? null,
      });
      if (groupErr || !groupId) {
        console.error("Failed to create triad group", groupErr);
        adminAlerts.push({ id: memberIds.join(":"), reason: "group_rejected" });
        return false;
      }
      if (!commonBucket) adminAlerts.push({ id: groupId as string, reason: "no_common_slot" });

      const names = memberIds.map((id) => byUser.get(id)?.full_name || "a teammate");
      for (const memberId of memberIds) {
        const others = names.filter((_, idx) => memberIds[idx] !== memberId);
        await admin.from("notifications").insert({
          user_id: memberId,
          notification_type: "triad_assigned",
          title: `You've been grouped for ${roundTitle}`,
          title_vi: `Bạn đã được ghép nhóm cho ${roundTitleVi}`,
          body: range
            ? `Your triad is with ${others.join(", ")}. Proposed: ${new Date(range.start).toLocaleString()}.`
            : `Your triad is with ${others.join(", ")}. No common time was found yet — propose one.`,
          link: "/triads",
        });
      }
      return true;
    }

    for (const pool of [viPool, enPool]) {
      if (pool.length === 0) continue;
      const { triads, dyad, leftover } = groupPool(pool, overlapOf);
      for (const triad of triads) {
        if (await createGroup(triad, pool === viPool ? "vi" : "en")) groupsCreated++;
      }
      if (dyad && (await createGroup(dyad, pool === viPool ? "vi" : "en"))) dyadsCreated++;
      if (leftover) {
        adminAlerts.push({ id: byUser.get(leftover)?.enrollment_id ?? leftover, reason: pool === enPool ? "english_only_no_partner" : "odd_one_out" });
        await admin.from("notifications").insert({
          user_id: leftover,
          notification_type: "triad_no_availability",
          title: "We couldn't group you yet for this triad round",
          title_vi: "Chúng tôi chưa thể ghép nhóm bạn cho vòng triad này",
          body: "There wasn't a compatible partner available this round. An admin will follow up.",
          link: "/triads",
        });
      }
    }

    // Participants with zero availability rows get their own heads-up too.
    for (const id of participantIds) {
      if ((bucketsByUser.get(id)?.size ?? 0) === 0) {
        await admin.from("notifications").insert({
          user_id: id,
          notification_type: "triad_no_availability",
          title: "Add your availability for the next triad round",
          title_vi: "Thêm thời gian rảnh của bạn cho vòng triad tiếp theo",
          body: "You don't have any availability on file, so we couldn't find a shared time for your triad.",
          link: "/triads",
        });
      }
    }

    if (adminAlerts.length > 0) {
      const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
      const summaryText = adminAlerts.map((a) => `${a.reason}${a.id ? ` (${a.id})` : ""}`).join("; ");
      for (const a of admins ?? []) {
        await admin.from("notifications").insert({
          user_id: a.user_id,
          notification_type: "triad_admin_alert",
          title: `Auto-assign for "${roundTitle}" needs attention`,
          body: `${adminAlerts.length} item(s) need manual review: ${summaryText}`,
          link: adminLink,
        });
      }
    }

    const summary = { groups: groupsCreated, dyads: dyadsCreated, flagged: adminAlerts.length };
    await admin.rpc("triad_set_assignment_status_internal", { p_cohort_requirement_date_id: requirementId, p_status: "completed", p_summary: summary });
    return json({ ok: true, ...summary });
  } catch (err) {
    console.error("triad-auto-assign failed", err);
    if (requirementId) {
      await admin.rpc("triad_set_assignment_status_internal", { p_cohort_requirement_date_id: requirementId, p_status: "failed" });
    }
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
