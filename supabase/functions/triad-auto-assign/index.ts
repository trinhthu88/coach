import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";

// Admin-invoked (verify_jwt = true): groups a triad round's active
// participants into triads/dyads by spoken-language compatibility, then
// picks the best-overlapping coachee_availability slot for each group.
//
// Idempotent: re-running clears out this round's auto-assigned groups that
// haven't been confirmed yet (status = 'proposed') and rebuilds from
// scratch, but leaves already-confirmed/completed groups untouched so a
// re-run can't clobber a session two members already agreed to.

interface ParticipantRow {
  id: string;
  full_name: string | null;
  spoken_languages: string[];
}

interface EnrollmentRow {
  id: string;
  user_id: string;
  cohort_id: string | null;
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

  let roundId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", userData.user.id);
    const isAdmin = (roleRows ?? []).some((r: { role: string }) => r.role === "admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    roundId = body.round_id;
    if (!roundId) {
      return new Response(JSON.stringify({ error: "round_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: round, error: roundErr } = await admin
      .from("triad_rounds")
      .select("id, programme_id, title, title_vi, completion_deadline")
      .eq("id", roundId)
      .maybeSingle();
    if (roundErr || !round) {
      return new Response(JSON.stringify({ error: "Triad round not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin.from("triad_rounds").update({ auto_assign_status: "running" }).eq("id", roundId);

    // --- Idempotent re-run: clear this round's not-yet-confirmed auto groups ---
    const { data: existingGroups } = await admin
      .from("triad_groups")
      .select("id, triad_sessions(id, status)")
      .eq("triad_round_id", roundId)
      .eq("assigned_by", "auto");
    interface ExistingGroupRow {
      id: string;
      triad_sessions: { id: string; status: string }[];
    }
    const groupsToClear = ((existingGroups ?? []) as unknown as ExistingGroupRow[]).filter((g) => {
      const sessions = g.triad_sessions ?? [];
      return sessions.length === 0 || sessions.every((s) => s.status === "proposed");
    });
    if (groupsToClear.length > 0) {
      const clearIds = groupsToClear.map((g) => g.id);
      await admin.from("triad_sessions").delete().in("triad_group_id", clearIds);
      await admin.from("triad_groups").delete().in("id", clearIds);
    }

    // --- Participants already in a confirmed/completed group for this round are excluded ---
    const { data: keptGroups } = await admin
      .from("triad_groups")
      .select("member_1_id, member_2_id, member_3_id")
      .eq("triad_round_id", roundId);
    const alreadyGroupedIds = new Set<string>();
    for (const g of keptGroups ?? []) {
      for (const id of [g.member_1_id, g.member_2_id, g.member_3_id]) if (id) alreadyGroupedIds.add(id);
    }

    const { data: enrollments } = await admin
      .from("programme_enrollments")
      .select("id, user_id, cohort_id")
      .eq("programme_id", round.programme_id)
      .in("status", ["active", "at_risk", "paused"]);
    const enrollmentRows = ((enrollments ?? []) as EnrollmentRow[]).filter((enrollment) => !alreadyGroupedIds.has(enrollment.user_id));
    const participantIds = [...new Set(enrollmentRows.map((enrollment) => enrollment.user_id))];
    const enrollmentByUser = new Map(enrollmentRows.map((enrollment) => [enrollment.user_id, enrollment]));

    if (participantIds.length === 0) {
      await admin.from("triad_rounds").update({ auto_assign_status: "completed" }).eq("id", roundId);
      return new Response(JSON.stringify({ ok: true, groups: 0, dyads: 0, ungrouped: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: participants } = await admin
      .from("profiles")
      .select("id, full_name, spoken_languages")
      .in("id", participantIds);
    const participantById = new Map((participants ?? []).map((p: ParticipantRow) => [p.id, p]));

    const windowEnd = round.completion_deadline as string;
    const windowStart = new Date(new Date(`${windowEnd}T00:00:00Z`).getTime() - 7 * 24 * HOUR_MS)
      .toISOString()
      .slice(0, 10);

    const { data: availability } = await admin
      .from("coachee_availability")
      .select("coachee_id, slot_date, start_time, end_time")
      .in("coachee_id", participantIds)
      .eq("is_booked", false)
      .gte("slot_date", windowStart)
      .lte("slot_date", windowEnd);

    const availByUser = new Map<string, AvailabilityRow[]>();
    for (const row of (availability ?? []) as AvailabilityRow[]) {
      const list = availByUser.get(row.coachee_id) ?? [];
      list.push(row);
      availByUser.set(row.coachee_id, list);
    }
    const bucketsByUser = new Map<string, BucketSet>();
    for (const id of participantIds) bucketsByUser.set(id, bucketsFor(availByUser.get(id) ?? []));

    // --- Language pools: 'vi' pool includes bilinguals, 'en' pool is English-only ---
    const viPool = participantIds.filter((id) => participantById.get(id)?.spoken_languages?.includes("vi"));
    const enPool = participantIds.filter((id) => {
      const langs = participantById.get(id)?.spoken_languages ?? [];
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

    async function createGroup(memberIds: string[], language: string) {
      const [m1, m2, m3] = [memberIds[0], memberIds[1], memberIds[2] ?? null];
      const enrollment1 = enrollmentByUser.get(m1)!;
      const enrollment2 = enrollmentByUser.get(m2)!;
      const enrollment3 = m3 ? enrollmentByUser.get(m3)! : null;
      const cohortIds = new Set([enrollment1.cohort_id, enrollment2.cohort_id, enrollment3?.cohort_id ?? enrollment1.cohort_id]);
      if (cohortIds.size !== 1 || cohortIds.has(null)) {
        adminAlerts.push({ id: memberIds.join(":"), reason: "mixed_cohort" });
        return;
      }

      const { data: inserted, error: insertErr } = await admin
        .from("triad_groups")
        .insert({
          triad_round_id: roundId,
          programme_id: round.programme_id,
          cohort_id: enrollment1.cohort_id,
          member_1_id: m1,
          member_2_id: m2,
          member_3_id: m3,
          enrollment_1_id: enrollment1.id,
          enrollment_2_id: enrollment2.id,
          enrollment_3_id: enrollment3?.id ?? null,
          assigned_by: "auto",
          group_language: language,
        })
        .select("id")
        .single();
      if (insertErr || !inserted) {
        console.error("Failed to create triad group", insertErr);
        return;
      }

      const sets = memberIds.map((id) => bucketsByUser.get(id) ?? new Set<string>());
      const commonBucket = memberIds.every((id) => (bucketsByUser.get(id)?.size ?? 0) > 0)
        ? earliestCommonBucket(sets)
        : null;
      const range = commonBucket ? bucketToRange(commonBucket) : null;

      const { error: sessionErr } = await admin.from("triad_sessions").insert({
        triad_group_id: inserted.id,
        coach_enrollment_id: enrollment1.id,
        coachee_enrollment_id: enrollment2.id,
        observer_enrollment_id: enrollment3?.id ?? null,
        proposed_start_time: range?.start ?? null,
        proposed_end_time: range?.end ?? null,
        proposed_by: "system",
        status: "proposed",
        member_3_response: m3 ? "pending" : null,
      });
      if (sessionErr) console.error("Failed to create triad session", sessionErr);

      if (!commonBucket) {
        adminAlerts.push({ id: inserted.id, reason: "no_common_slot" });
      }

      const roundTitle = round.title as string;
      const names = memberIds.map((id) => participantById.get(id)?.full_name || "a teammate");
      for (const memberId of memberIds) {
        const others = names.filter((_, idx) => memberIds[idx] !== memberId);
        await admin.from("notifications").insert({
          user_id: memberId,
          notification_type: "triad_assigned",
          title: `You've been grouped for ${roundTitle}`,
          title_vi: `Bạn đã được ghép nhóm cho ${round.title_vi || roundTitle}`,
          body: range
            ? `Your triad is with ${others.join(", ")}. Proposed: ${new Date(range.start).toLocaleString()}.`
            : `Your triad is with ${others.join(", ")}. No common time was found yet — propose one.`,
          link: "/triads",
        });
      }
    }

    for (const pool of [viPool, enPool]) {
      if (pool.length === 0) continue;
      const { triads, dyad, leftover } = groupPool(pool, overlapOf);
      for (const triad of triads) {
        await createGroup(triad, pool === viPool ? "vi" : "en");
        groupsCreated++;
      }
      if (dyad) {
        await createGroup(dyad, pool === viPool ? "vi" : "en");
        dyadsCreated++;
      }
      if (leftover) {
        adminAlerts.push({ id: leftover, reason: pool === enPool ? "english_only_no_partner" : "odd_one_out" });
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
      const summary = adminAlerts
        .map((a) => `${a.reason}${a.id ? ` (${a.id})` : ""}`)
        .join("; ");
      for (const a of admins ?? []) {
        await admin.from("notifications").insert({
          user_id: a.user_id,
          notification_type: "triad_admin_alert",
          title: `Auto-assign for "${round.title}" needs attention`,
          body: `${adminAlerts.length} item(s) need manual review: ${summary}`,
          link: "/admin/triads",
        });
      }
    }

    await admin.from("triad_rounds").update({ auto_assign_status: "completed" }).eq("id", roundId);

    return new Response(
      JSON.stringify({
        ok: true,
        groups: groupsCreated,
        dyads: dyadsCreated,
        flagged: adminAlerts.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("triad-auto-assign failed", err);
    if (roundId) {
      await admin.from("triad_rounds").update({ auto_assign_status: "failed" }).eq("id", roundId);
    }
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
