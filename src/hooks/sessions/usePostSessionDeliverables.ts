import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { saveEnrollmentActions, withEnrollmentActions, type EnrollmentActionItem } from "@/lib/enrollmentActions";
import {
  DELIVERABLE_SOURCE_TYPES,
  toSessionDeliverable,
  type SessionDeliverable,
  type SessionSourceTable,
} from "@/lib/postSessionDeliverables";

/**
 * The single client entry point to post-session deliverables, for every
 * module (Coaching, Peer both roles, Mentoring, Triads).
 *
 * Reads:
 *   learner_session_deliverables(enrollment)  every completed session the
 *                                             learner owes / owed work on
 *   session_deliverables(table, session)      one session, each participant
 * Writers (one per item, whatever the module):
 *   reflection    session_learning_reflections (upsert, one row per session)
 *   goal check-in record_goal_checkins (SessionGoalRatings)
 *   action        save_enrollment_activity_actions
 *   satisfaction  submit_session_satisfaction
 */
export const DELIVERABLE_KEYS = {
  learner: "learner-session-deliverables",
  session: "session-deliverables",
  counterpart: "session-counterpart-deliverables",
  reflection: "session-reflection",
  actions: "session-follow-up-actions",
} as const;

/** Every read that a deliverable write can change. */
const INVALIDATE = [
  DELIVERABLE_KEYS.learner,
  DELIVERABLE_KEYS.session,
  DELIVERABLE_KEYS.counterpart,
  DELIVERABLE_KEYS.reflection,
  DELIVERABLE_KEYS.actions,
  // Coaching's own readers (checklist summary, progress card, admin list).
  "coaching-session-evidence",
  "canonical-progress",
  "session-core",
  "sessions",
  "journey",
  "learner-canonical-engagement",
  "learner-reflection-feed",
  "learner-session-history",
  "triad-overview",
  "my-triads",
];

export function useInvalidateDeliverables() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of INVALIDATE) queryClient.invalidateQueries({ queryKey: [key] });
  };
}

/** The learner's own deliverables across every completed session of the enrollment. */
export function useLearnerSessionDeliverables(enrollmentId: string | null | undefined) {
  const query = useQuery({
    queryKey: [DELIVERABLE_KEYS.learner, enrollmentId],
    enabled: !!enrollmentId,
    queryFn: async (): Promise<SessionDeliverable[]> => {
      const { data, error } = await supabase.rpc("learner_session_deliverables", { p_enrollment_id: enrollmentId! });
      if (error) throw error;
      return (data ?? []).map(toSessionDeliverable);
    },
  });
  return {
    deliverables: query.data ?? [],
    loading: !!enrollmentId && query.isLoading,
    error: query.error ? (query.error as { message?: string }).message ?? "error" : null,
  };
}

export interface SessionParticipantDeliverable extends SessionDeliverable {
  enrollmentId: string;
  isSelf: boolean;
  sessionCompleted: boolean;
}

/** One session's deliverables, per participating enrollment (participants and Admin only). */
export function useSessionDeliverables(sourceTable: SessionSourceTable | null | undefined, sessionId: string | null | undefined) {
  return useQuery({
    queryKey: [DELIVERABLE_KEYS.session, sourceTable, sessionId],
    enabled: !!sourceTable && !!sessionId,
    queryFn: async (): Promise<SessionParticipantDeliverable[]> => {
      const { data, error } = await supabase.rpc("session_deliverables", {
        p_source_table: sourceTable!,
        p_session_id: sessionId!,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...toSessionDeliverable(r),
        enrollmentId: r.enrollment_id,
        isSelf: !!r.is_self,
        sessionCompleted: !!r.session_completed,
      }));
    },
  });
}

export type CounterpartItem = "session_notes" | "feedback_to_learner" | "feedback_to_mentee" | "peer_feedback";

export interface CounterpartDeliverable {
  userId: string;
  role: "coach" | "mentor" | "receiver" | "provider";
  item: CounterpartItem;
  required: boolean;
  done: boolean;
  sessionCompleted: boolean;
  isSelf: boolean;
}

/**
 * What the OTHER side of a session owes afterwards (coach notes and feedback,
 * mentor notes and feedback, peer feedback): session_counterpart_deliverables,
 * the caller's own items (Admin: every counterpart). Booleans only.
 */
export function useSessionCounterpartDeliverables(
  sourceTable: SessionSourceTable | null | undefined,
  sessionId: string | null | undefined,
) {
  return useQuery({
    queryKey: [DELIVERABLE_KEYS.counterpart, sourceTable, sessionId],
    enabled: !!sourceTable && !!sessionId,
    queryFn: async (): Promise<CounterpartDeliverable[]> => {
      const { data, error } = await supabase.rpc("session_counterpart_deliverables", {
        p_source_table: sourceTable!,
        p_session_id: sessionId!,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        userId: r.user_id,
        role: r.counterpart_role as CounterpartDeliverable["role"],
        item: r.item as CounterpartItem,
        required: !!r.required,
        done: !!r.done,
        sessionCompleted: !!r.session_completed,
        isSelf: !!r.is_self,
      }));
    },
  });
}

/**
 * The learner's own reflection for one session (one row per enrollment and
 * session). `null` = none yet; `undefined` while loading, so the composer never
 * renders an empty box over an unread answer.
 */
export function useSessionReflection(
  enrollmentId: string | null | undefined,
  sourceTable: SessionSourceTable | null | undefined,
  sessionId: string | null | undefined,
) {
  return useQuery({
    queryKey: [DELIVERABLE_KEYS.reflection, enrollmentId, sourceTable, sessionId],
    enabled: !!enrollmentId && !!sourceTable && !!sessionId,
    queryFn: async (): Promise<{ body: string } | null> => {
      const { data, error } = await supabase
        .from("session_learning_reflections")
        .select("body")
        .eq("enrollment_id", enrollmentId!)
        .eq("source_activity_type", DELIVERABLE_SOURCE_TYPES[sourceTable!].reflection)
        .eq("source_activity_id", sessionId!)
        .maybeSingle();
      if (error) throw error;
      return data ? { body: data.body } : null;
    },
  });
}

/** Write (or rewrite) the learner's reflection in the one canonical store. */
export function useSubmitSessionReflection() {
  const invalidate = useInvalidateDeliverables();
  return useMutation({
    mutationFn: async ({
      enrollmentId,
      sourceTable,
      sessionId,
      body,
    }: { enrollmentId: string; sourceTable: SessionSourceTable; sessionId: string; body: string }) => {
      const { error } = await supabase.from("session_learning_reflections").upsert(
        {
          enrollment_id: enrollmentId,
          source_activity_type: DELIVERABLE_SOURCE_TYPES[sourceTable].reflection,
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

/** The one satisfaction writer: the learner's own 1–5 rating, whatever the module. */
export function useSubmitSessionSatisfaction() {
  const invalidate = useInvalidateDeliverables();
  return useMutation({
    mutationFn: async ({
      enrollmentId,
      sourceTable,
      sessionId,
      rating,
    }: { enrollmentId: string; sourceTable: SessionSourceTable; sessionId: string; rating: number }) => {
      const { error } = await supabase.rpc("submit_session_satisfaction", {
        p_source_table: sourceTable,
        p_session_id: sessionId,
        p_enrollment_id: enrollmentId,
        p_rating: rating,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** The learner's own follow-up actions for one session, on their own enrollment. */
export function useSessionFollowUpActions(
  enrollmentId: string | null | undefined,
  sourceTable: SessionSourceTable | null | undefined,
  sessionId: string | null | undefined,
) {
  return useQuery({
    queryKey: [DELIVERABLE_KEYS.actions, enrollmentId, sourceTable, sessionId],
    enabled: !!enrollmentId && !!sourceTable && !!sessionId,
    queryFn: async (): Promise<EnrollmentActionItem[]> => {
      const [row] = await withEnrollmentActions(
        [{ id: sessionId!, enrollment_id: enrollmentId! }],
        DELIVERABLE_SOURCE_TYPES[sourceTable!].action,
      );
      return row?.enrollment_actions ?? [];
    },
  });
}

/**
 * Add one follow-up action. save_enrollment_activity_actions replaces the
 * whole set for (enrollment, source, session), so the existing actions are
 * sent back unchanged alongside the new one.
 */
export function useAddSessionFollowUpAction() {
  const invalidate = useInvalidateDeliverables();
  return useMutation({
    mutationFn: async ({
      enrollmentId,
      sourceTable,
      sessionId,
      existing,
      text,
    }: {
      enrollmentId: string;
      sourceTable: SessionSourceTable;
      sessionId: string;
      existing: EnrollmentActionItem[];
      text: string;
    }) => {
      const { error } = await saveEnrollmentActions(
        enrollmentId,
        DELIVERABLE_SOURCE_TYPES[sourceTable].action,
        sessionId,
        [...existing, { text, done: false, due_date: null, milestone_id: null }],
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}
