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
 *   coaching_session_evidence(session)           per-session gate detail
 */

export const COACHING_KEYS = {
  coachPool: "coaching-coach-pool",
  nextRequirement: "coaching-next-requirement",
  checklist: "coaching-post-session-checklist",
  evidence: "coaching-session-evidence",
  fulfilment: "coaching-requirement-fulfilment",
} as const;

/**
 * Caches that can be invalidated by a Coaching lifecycle change. Kept as one
 * list so booking, cancellation and evidence submission cannot drift into
 * invalidating different subsets and leaving screens contradicting each other.
 */
const LIFECYCLE_KEYS = [
  COACHING_KEYS.coachPool,
  COACHING_KEYS.nextRequirement,
  COACHING_KEYS.checklist,
  COACHING_KEYS.evidence,
  COACHING_KEYS.fulfilment,
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
  /** Held sessions whose programme unit is still waiting on learner evidence. */
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
        supabase.rpc("canonical_module_progress", {
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
        postSessionPending: (checklist ?? []).filter((c) => !c.unit_complete).length,
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

export interface CoachingRequirementState {
  requirementId: string;
  ordinal: number;
  dueOn: string;
  fulfilledOn: string | null;
  bookedOn: string | null;
  sessionId: string | null;
  postSessionPending: boolean;
}

/** Every Coaching requirement of the enrollment, with its canonical state. */
export function useCoachingRequirements(enrollmentId: string | null | undefined) {
  return useQuery({
    queryKey: [COACHING_KEYS.fulfilment, enrollmentId],
    enabled: !!enrollmentId,
    queryFn: async (): Promise<CoachingRequirementState[]> => {
      const { data, error } = await supabase.rpc("canonical_coaching_requirement_fulfilment", {
        p_enrollment_id: enrollmentId!,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        requirementId: r.requirement_id!,
        ordinal: r.ordinal!,
        dueOn: r.due_on!,
        fulfilledOn: r.fulfilled_on,
        bookedOn: r.booked_on,
        sessionId: r.session_id,
        postSessionPending: !!r.post_session_pending,
      }));
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

export function useCancelCoachingSession() {
  const invalidate = useInvalidateCoaching();
  return useMutation({
    mutationFn: async ({ sessionId, reason }: { sessionId: string; reason?: string }) => {
      const { data, error } = await supabase.rpc("cancel_coaching_session", {
        p_session_id: sessionId,
        p_reason: reason ?? null,
      });
      if (error) throw error;
      return data?.[0] ?? null;
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

/** Coach marks the conversation held. Does not complete the programme unit. */
export function useCompleteCoachingSession() {
  const invalidate = useInvalidateCoaching();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { error } = await supabase.rpc("complete_coaching_session", {
        p_session_id: sessionId,
      });
      if (error) throw error;
      return sessionId;
    },
    onSuccess: invalidate,
  });
}

export interface CoachingEvidence {
  sessionId: string;
  sessionCompleted: boolean;
  hasReflection: boolean;
  hasGoalCheckin: boolean;
  hasAction: boolean;
  hasSatisfaction: boolean;
  goalCheckinRequired: boolean;
  unitComplete: boolean;
}

/** The four evidence gates for one session, straight from the backend. */
export function useCoachingSessionEvidence(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: [COACHING_KEYS.evidence, sessionId],
    enabled: !!sessionId,
    queryFn: async (): Promise<CoachingEvidence | null> => {
      const { data, error } = await supabase.rpc("coaching_session_evidence", {
        p_session_id: sessionId!,
      });
      if (error) throw error;
      const r = data?.[0];
      if (!r) return null;
      return {
        sessionId: r.session_id!,
        sessionCompleted: !!r.session_completed,
        hasReflection: !!r.has_reflection,
        hasGoalCheckin: !!r.has_goal_checkin,
        hasAction: !!r.has_action,
        hasSatisfaction: !!r.has_satisfaction,
        goalCheckinRequired: !!r.goal_checkin_required,
        unitComplete: !!r.unit_complete,
      };
    },
  });
}

export interface PostSessionChecklistRow {
  requirementId: string;
  ordinal: number;
  dueOn: string;
  sessionId: string;
  sessionStatus: string;
  needsReflection: boolean;
  needsGoalCheckin: boolean;
  needsAction: boolean;
  needsSatisfaction: boolean;
  unitComplete: boolean;
}

/** Held sessions whose programme unit is still waiting on learner evidence. */
export function useCoachingPostSessionChecklist(enrollmentId: string | null | undefined) {
  return useQuery({
    queryKey: [COACHING_KEYS.checklist, enrollmentId],
    enabled: !!enrollmentId,
    queryFn: async (): Promise<PostSessionChecklistRow[]> => {
      const { data, error } = await supabase.rpc("coaching_post_session_checklist", {
        p_enrollment_id: enrollmentId!,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        requirementId: r.requirement_id!,
        ordinal: r.ordinal!,
        dueOn: r.due_on!,
        sessionId: r.session_id!,
        sessionStatus: r.session_status!,
        needsReflection: !!r.needs_reflection,
        needsGoalCheckin: !!r.needs_goal_checkin,
        needsAction: !!r.needs_action,
        needsSatisfaction: !!r.needs_satisfaction,
        unitComplete: !!r.unit_complete,
      }));
    },
  });
}

/** Submit the learner's post-session reflection (canonical, enrollment-scoped). */
export function useSubmitCoachingReflection() {
  const invalidate = useInvalidateCoaching();
  return useMutation({
    mutationFn: async ({
      enrollmentId,
      sessionId,
      body,
    }: { enrollmentId: string; sessionId: string; body: string }) => {
      const { error } = await supabase.from("session_learning_reflections").upsert(
        {
          enrollment_id: enrollmentId,
          source_activity_type: "coaching",
          source_activity_id: sessionId,
          body,
        },
        { onConflict: "enrollment_id,source_activity_type,source_activity_id" },
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Submit the learner's satisfaction rating for a Coaching session. */
export function useSubmitCoachingSatisfaction() {
  const invalidate = useInvalidateCoaching();
  return useMutation({
    mutationFn: async ({
      sessionId,
      rating,
      comment,
    }: { sessionId: string; rating: number; comment?: string }) => {
      const { error } = await supabase
        .from("sessions")
        .update({
          coachee_rating: rating,
          coachee_rating_comment: comment ?? null,
          coachee_rated_at: new Date().toISOString(),
        })
        .eq("id", sessionId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}
