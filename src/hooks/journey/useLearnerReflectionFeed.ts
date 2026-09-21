import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

export type ReflectionSourceType =
  | "coaching_session_reflection"
  | "coaching_session_rating"
  | "peer_session_reflection"
  | "peer_session_rating"
  | "mentoring_session_reflection"
  | "triad_reflection"
  | "goal_checkin"
  | "training_reflection"
  | "quiz_reflection"
  | "daily_prompt_response"
  | "journey_reflection";

export interface LearnerReflection {
  key: string;
  sourceType: ReflectionSourceType;
  sourceTable: string;
  sourceId: string;
  module: Database["public"]["Enums"]["programme_module_type"] | null;
  occurredAt: string;
  title: string | null;
  body: string;
  details: Record<string, unknown>;
  rating: number | null;
  previousRating: number | null;
  linkedSessionTable: string | null;
  linkedSessionId: string | null;
  linkedGoalId: string | null;
  linkedActivityId: string | null;
  isPrivate: boolean;
}

export const LEARNER_REFLECTION_FEED_KEY = "learner-reflection-feed";

function asObject(value: Json | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * THE learner reflection feed for one enrollment — learner_reflection_feed
 * projects learner-authored reflective text from its original records
 * (session reflections, the learner's own session rating comments, triad
 * reflections, goal check-ins with a comment, training reflection answers,
 * quiz reflections, daily prompt responses, explicit My Journey reflections).
 * Nothing is copied: the original record stays authoritative. Coach, mentor,
 * provider, sponsor and admin notes are never part of it.
 *
 * Consumers: My Journey → Reflections (full history), Dashboard → Feedback &
 * development (recent subset), and the Development Journey timeline.
 */
export async function fetchLearnerReflectionFeed(enrollmentId: string): Promise<LearnerReflection[]> {
  const { data, error } = await supabase.rpc("learner_reflection_feed", { p_enrollment_id: enrollmentId });
  if (error) {
    console.error("Learner reflection feed failed to load", { enrollmentId, error });
    throw error;
  }
  return (data ?? []).map(toLearnerReflection);
}

type ReflectionFeedRow = Database["public"]["Functions"]["learner_reflection_feed"]["Returns"][number];

/** One canonical_reflection_feed row (learner or admin wrapper) as a LearnerReflection. */
export function toLearnerReflection(row: ReflectionFeedRow): LearnerReflection {
  return {
    key: row.reflection_key,
    sourceType: row.source_type as ReflectionSourceType,
    sourceTable: row.source_table,
    sourceId: row.source_id,
    module: row.module ?? null,
    occurredAt: row.occurred_at,
    title: row.title ?? null,
    body: row.body,
    details: asObject(row.details),
    rating: row.rating ?? null,
    previousRating: row.previous_rating ?? null,
    linkedSessionTable: row.linked_session_table ?? null,
    linkedSessionId: row.linked_session_id ?? null,
    linkedGoalId: row.linked_goal_id ?? null,
    linkedActivityId: row.linked_activity_id ?? null,
    isPrivate: Boolean(row.is_private),
  };
}

export function useLearnerReflectionFeed(enrollmentId: string | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: [LEARNER_REFLECTION_FEED_KEY, enrollmentId ?? null],
    queryFn: () => fetchLearnerReflectionFeed(enrollmentId as string),
    enabled: !!enrollmentId,
    // Reflections are written on many screens (session detail, goal
    // check-ins, triads, training); refetch whenever a consumer mounts
    // rather than wiring every write path to this cache key.
    staleTime: 0,
  });

  return {
    reflections: data ?? [],
    loading: !!enrollmentId && isLoading,
    error: error ? (error instanceof Error ? error.message : String((error as { message?: unknown }).message ?? error)) : null,
  };
}
