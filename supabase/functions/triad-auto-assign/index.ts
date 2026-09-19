import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";

// Admin-invoked (verify_jwt = true), cohort-first:
//   selected cohort
//   -> its eligible ongoing enrollments whose programme requires Triads
//   -> minus enrollments already in an active Triad group
//      (triad_cohort_candidates_internal)
//   -> spoken-language pools -> coachee_availability overlap -> groups of 3
//   -> optional dyad -> unmatched list + admin alert.
// A group is cohort-level: it practises together across ALL the cohort's
// required Triad sessions (never one requirement unit). A mixed-cohort group
// can never be formed: the pool is one cohort, and triad_create_group_internal
// + the membership trigger enforce it again. There is no scheduled run and
// no stored run status: Admin runs it and gets the summary back.
//
// Idempotent: re-running clears this cohort's auto-assigned groups nobody has
// acted on yet (no session beyond a proposed one, no responses, no
// alternatives) and rebuilds; anything a member already acted on is kept.

interface CandidateRow {
  enrollment_id: string;
  user_id: string;
  full_name: string | null;
  spoken_languages: string[];
  programme_id: string;
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

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "Invalid session" }, 401);
    const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", userData.user.id);
    if (!(roleRows ?? []).some((r: { role: string }) => r.role === "admin")) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const cohortId: string | null = body.cohort_id ?? null;
    if (!cohortId) return json({ error: "cohort_id is required" }, 400);
    const { data: cohort } = await admin.from("cohorts").select("id, name").eq("id", cohortId).maybeSingle();
    if (!cohort) return json({ error: "Cohort not found" }, 404);
    const adminLink = `/admin/cohorts/${cohortId}/triads`;

    // --- Idempotent re-run: clear this cohort's untouched auto groups ---
    await admin.rpc("triad_clear_unconfirmed_auto_groups_internal", { p_cohort_id: cohortId });

    // --- The pool: this cohort's eligible enrollments not in an active group ---
    const { data: candidates, error: candidatesErr } = await admin.rpc("triad_cohort_candidates_internal", { p_cohort_id: cohortId });
    if (candidatesErr) throw candidatesErr;
    const pool = (candidates ?? []) as CandidateRow[];
    const byUser = new Map(pool.map((c) => [c.user_id, c]));
    const participantIds = [...byUser.keys()];

    if (participantIds.length === 0) return json({ ok: true, groups: 0, dyads: 0, flagged: 0 });

    // Availability window: from today to the cohort's next Triad deadline
    // (or two weeks when none is upcoming). It only helps pick a first
    // common time; the group then schedules every later session itself.
    const today = new Date().toISOString().slice(0, 10);
    const { data: nextDue } = await admin
      .from("cohort_requirement_dates")
      .select("due_on")
      .eq("cohort_id", cohortId)
      .eq("module", "triads")
      .gte("due_on", today)
      .order("due_on", { ascending: true })
      .limit(1)
      .maybeSingle();
    const windowEnd = (nextDue?.due_on as string | undefined) ?? new Date(Date.now() + 14 * 24 * HOUR_MS).toISOString().slice(0, 10);
    const { data: availability } = await admin
      .from("coachee_availability")
      .select("coachee_id, slot_date, start_time, end_time")
      .in("coachee_id", participantIds)
      .eq("is_booked", false)
      .gte("slot_date", today)
      .lte("slot_date", windowEnd);

    const availByUser = new Map<string, AvailabilityRow[]>();
    for (const row of (availability ?? []) as AvailabilityRow[]) {
      const list = availByUser.get(row.coachee_id) ?? [];
      list.push(row);
      availByUser.set(row.coachee_id, list);
    }
    const bucketsByUser = new Map<string, BucketSet>();
    for (const id of participantIds) bucketsByUser.set(id, bucketsFor(availByUser.get(id) ?? []));

    // --- Pools per programme (a group holds one programme's learners) and
    //     language: 'vi' includes bilinguals, 'en' is English-only ---
    const programmeIds = [...new Set(pool.map((c) => c.programme_id))];
    const pools: { ids: string[]; language: "vi" | "en" }[] = [];
    for (const programmeId of programmeIds) {
      const ids = participantIds.filter((id) => byUser.get(id)?.programme_id === programmeId);
      pools.push({ ids: ids.filter((id) => byUser.get(id)?.spoken_languages?.includes("vi")), language: "vi" });
      pools.push({
        ids: ids.filter((id) => {
          const langs = byUser.get(id)?.spoken_languages ?? [];
          return langs.includes("en") && !langs.includes("vi");
        }),
        language: "en",
      });
    }
    const pooled = new Set(pools.flatMap((p) => p.ids));
    // Eligible learners in neither pool (no Vietnamese or English on their
    // profile) are never grouped silently: Admin assigns them manually.
    const noLanguage = participantIds.filter((id) => !pooled.has(id));

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

    const adminAlerts: { id: string; reason: string }[] = noLanguage.map((id) => ({
      id: byUser.get(id)?.enrollment_id ?? id,
      reason: "no_spoken_language",
    }));
    let groupsCreated = 0;
    let dyadsCreated = 0;

    async function createGroup(memberIds: string[], language: string): Promise<boolean> {
      const sets = memberIds.map((id) => bucketsByUser.get(id) ?? new Set<string>());
      const commonBucket = memberIds.every((id) => (bucketsByUser.get(id)?.size ?? 0) > 0) ? earliestCommonBucket(sets) : null;
      const range = commonBucket ? bucketToRange(commonBucket) : null;

      const { data: groupId, error: groupErr } = await admin.rpc("triad_create_group_internal", {
        p_cohort_id: cohortId,
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
          title: "You've been placed in a Triad group",
          title_vi: "Bạn đã được xếp vào một nhóm Triad",
          body: range
            ? `Your Triad group is with ${others.join(", ")} for all your Triad sessions. First session proposed: ${new Date(range.start).toLocaleString()}.`
            : `Your Triad group is with ${others.join(", ")} for all your Triad sessions. No common time was found yet — propose one.`,
          link: "/triads",
        });
      }
      return true;
    }

    for (const pool of pools) {
      if (pool.ids.length === 0) continue;
      const { triads, dyad, leftover } = groupPool(pool.ids, overlapOf);
      for (const triad of triads) {
        if (await createGroup(triad, pool.language)) groupsCreated++;
      }
      if (dyad && (await createGroup(dyad, pool.language))) dyadsCreated++;
      if (leftover) {
        adminAlerts.push({ id: byUser.get(leftover)?.enrollment_id ?? leftover, reason: pool.language === "en" ? "english_only_no_partner" : "odd_one_out" });
        await admin.from("notifications").insert({
          user_id: leftover,
          notification_type: "triad_no_availability",
          title: "We couldn't place you in a Triad group yet",
          title_vi: "Chúng tôi chưa thể xếp bạn vào nhóm Triad",
          body: "There wasn't a compatible partner available. An admin will follow up.",
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
          title: "Add your availability for your Triad sessions",
          title_vi: "Thêm thời gian rảnh cho các session Triad của bạn",
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
          title: `Triad auto assign for "${cohort.name}" needs attention`,
          body: `${adminAlerts.length} item(s) need manual review: ${summaryText}`,
          link: adminLink,
        });
      }
    }

    return json({ ok: true, groups: groupsCreated, dyads: dyadsCreated, flagged: adminAlerts.length });
  } catch (err) {
    console.error("triad-auto-assign failed", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
