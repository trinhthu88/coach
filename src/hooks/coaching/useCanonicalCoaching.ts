import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * The single frontend entry point to the canonical Coaching backend.
 *
 * Every Coaching screen reads programme facts through these hooks. Nothing in
 * React re-derives eligibility, requirement state, entitlement or completion:
 * the database owns all of it, and a second implementation here is exactly the
 * duplicate source of truth the redesign removes.
 *
 * Backend contract (supabase/migrations/202609201*):
 *   enrollment_coaching_coach_pool(enrollment)   who may be booked
 *   next_coaching_requirement(enrollment)        which unit is next
 *   book_coaching_session(...)                   atomic booking
 *   cancel_coaching_session(session, reason)     cancellation + release
 *   complete_coaching_session(session)           Coach marks it held
 *   coaching_post_session_checklist(enrollment)  the four evidence gates
 *   (post-session evidence: usePostSessionDeliverables, shared by every module)
 */

export const COACHING_KEYS = {
  coachPool: "coaching-coach-pool",
  nextRequirement: "coaching-next-requirement",
  evidence: "coaching-session-evidence",
  reflection: "coaching-session-reflection",
  satisfaction: "coaching-session-satisfaction",
} as const;

/**
 * Caches that can be invalidated by a Coaching lifecycle change. Kept as one
 * list so booking, cancellation and evidence submission cannot drift into
 * invalidating different subsets and leaving screens contradicting each other.
 */
const LIFECYCLE_KEYS = [
  COACHING_KEYS.coachPool,
  COACHING_KEYS.nextRequirement,
  COACHING_KEYS.evidence,
  COACHING_KEYS.satisfaction,
  COACHING_KEYS.reflection,
  "sessions",
  "session-detail",
  "coach-availability",
  "availability",
  "dashboard",
  "coaching-card",
  "journey",
  "enrollment-progress",
  "canonical-progress",
  "admin-sessions",
  "sponsor-progress",
  // The learner dashboard's canonical reads: satisfaction and reflections
  // aggregate from session records, so they must recalculate on any change.
  "learner-canonical-progress",
  "learner-canonical-engagement",
  "learner-canonical-overdue-items",
  "learner-reflection-feed",
  // Post-session deliverables and module requirement state (all modules).
  "learner-session-deliverables",
  "session-deliverables",
  "module-requirements",
];

export function useInvalidateCoaching() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of LIFECYCLE_KEYS) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
}

export interface CanonicalCoachingProgress {
  requiredUnits: number;
  completedUnits: number;
  bookedUnits: number;
  dueUnits: number;
  overdueUnits: number;
  paceStatus: string;
  /** Held sessions whose write-up is still outstanding. Not a progress figure. */
  postSessionPending: number;
}

/**
 * Canonical Coaching programme progress for one enrollment.
 *
 * This is THE reader for required / completed / booked / due / overdue. Every
 * role uses it -- Coachee, Coach, Sponsor, Admin and Journey -- so a number
 * shown on one screen cannot disagree with the same number on another.
 *
 * It is not interchangeable with operational usage readers such as
 * get_coachee_session_usage_for_enrollment: those count raw sessions, which
 * treats a held-but-unevidenced session as complete. Programme progress must
 * not be reconstructed from raw sessions.
 */
export function useCanonicalCoachingProgress(enrollmentId: string | null | undefined) {
  return useQuery({
    queryKey: ["canonical-progress", "coaching", enrollmentId],
    enabled: !!enrollmentId,
    queryFn: async (): Promise<CanonicalCoachingProgress | null> => {
      const [{ data, error }, { data: checklist }] = await Promise.all([
        supabase.rpc("learner_module_progress", {
          p_enrollment_id: enrollmentId!,
          p_as_of: new Date().toISOString().slice(0, 10),
        }),
        supabase.rpc("coaching_post_session_checklist", { p_enrollment_id: enrollmentId! }),
      ]);
      if (error) throw error;
      const row = (data ?? []).find((r) => r.module === "coaching");
      if (!row) return null;
      return {
        requiredUnits: row.required_units ?? 0,
        completedUnits: row.completed_units ?? 0,
        bookedUnits: row.booked_units ?? 0,
        dueUnits: row.due_units ?? 0,
        overdueUnits: row.overdue_units ?? 0,
        paceStatus: row.pace_status ?? "",
        postSessionPending: (checklist ?? []).filter((c) => !c.evidence_complete).length,
      };
    },
  });
}

export interface CoachingRequirement {
  requirementId: string;
  ordinal: number;
  dueOn: string;
}

/** The next Coaching unit with no session yet. Null when all are taken. */
export function useNextCoachingRequirement(enrollmentId: string | null | undefined) {
  return useQuery({
    queryKey: [COACHING_KEYS.nextRequirement, enrollmentId],
    enabled: !!enrollmentId,
    queryFn: async (): Promise<CoachingRequirement | null> => {
      const { data, error } = await supabase.rpc("next_coaching_requirement", {
        p_enrollment_id: enrollmentId!,
      });
      if (error) throw error;
      const row = data?.[0];
      if (!row) return null;
      return { requirementId: row.requirement_id!, ordinal: row.ordinal!, dueOn: row.due_on! };
    },
  });
}

/**
 * Coaches the learner may book: the active cohort pool, resolved server-side
 * from the enrollment. The frontend must not filter this further — whatever it
 * adds would be a rule the backend does not enforce.
 */
export function useCohortCoachPool(enrollmentId: string | null | undefined) {
  return useQuery({
    queryKey: [COACHING_KEYS.coachPool, enrollmentId],
    enabled: !!enrollmentId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("enrollment_coaching_coach_pool", {
        p_enrollment_id: enrollmentId!,
      });
      if (error) throw error;
      const ids = (data ?? []).map((r) => r.coach_id!).filter(Boolean);
      if (ids.length === 0) return [] as { id: string; fullName: string; avatarUrl: string | null }[];

      const { data: profiles, error: profileError } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", ids);
      if (profileError) throw profileError;

      // Preserve the backend's membership exactly; a profile that RLS hides
      // still counts as an assigned Coach and is shown by id-derived fallback.
      return ids.map((id) => {
        const p = profiles?.find((x) => x.id === id);
        return { id, fullName: p?.full_name ?? "Coach", avatarUrl: p?.avatar_url ?? null };
      });
    },
  });
}

export interface BookCoachingInput {
  enrollmentId: string;
  coachId: string;
  slotId: string;
  requirementId: string;
  topic: string;
  /** Optional start inside the published slot; the server revalidates it. */
  startTime?: string;
  durationMinutes?: number;
}

/** Atomic booking. The slot becomes unavailable to everyone else immediately. */
export function useBookCoachingSession() {
  const invalidate = useInvalidateCoaching();
  return useMutation({
    mutationFn: async (input: BookCoachingInput): Promise<string> => {
      const { data, error } = await supabase.rpc("book_coaching_session", {
        p_enrollment_id: input.enrollmentId,
        p_coach_id: input.coachId,
        p_slot_id: input.slotId,
        p_requirement_id: input.requirementId,
        p_topic: input.topic,
        ...(input.startTime ? { p_start_time: input.startTime } : {}),
        ...(input.durationMinutes ? { p_duration_minutes: input.durationMinutes } : {}),
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });
}

export function useRescheduleCoachingSession() {
  const invalidate = useInvalidateCoaching();
  return useMutation({
    mutationFn: async ({
      sessionId,
      newSlotId,
      reason,
    }: { sessionId: string; newSlotId: string; reason?: string }) => {
      const { data, error } = await supabase.rpc("reschedule_coaching_session", {
        p_session_id: sessionId,
        p_new_slot_id: newSlotId,
        p_reason: reason ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });
}

/*
 * Post-session evidence (reflection, goal check-in, follow-up action,
 * satisfaction) is no longer Coaching-specific: one rule serves every module.
 * Readers and writers live in src/hooks/sessions/usePostSessionDeliverables.ts
 * (learner_session_deliverables / session_deliverables /
 * submit_session_satisfaction); coaching_session_evidence() is derived from
 * the same rule for the Admin list.
 */
