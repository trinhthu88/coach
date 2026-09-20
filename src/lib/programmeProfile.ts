import type { Database } from "@/integrations/supabase/types";

/**
 * Shared programme-profile view model for the three surfaces that describe
 * ONE enrollment: Sponsor → Leader Detail, Learner → Dashboard and
 * Learner → My Journey.
 *
 * Every number here arrives already calculated by the canonical backend
 * (sponsor_canonical_* for a sponsor, learner_canonical_* for the learner —
 * both built on the same canonical_module_progress / sponsor_canonical_
 * module_schedule / sponsor_canonical_activity primitives and the shared
 * canonical_enrollment_engagement summary). This module only parses and
 * arranges those rows for presentation; it must never derive required,
 * completed, due, overdue, adherence or checkpoint values itself.
 */

export type ProgrammeCheckpointState = "completed" | "current" | "overdue" | "upcoming";

export type ProgrammeJourneyPoint = {
  checkpoint_number: number;
  due_on: string;
  label: string | null;
  module_scope: string[];
  required_units: number;
  completed_units: number;
  state: ProgrammeCheckpointState;
};

export type ProgrammeWeeklyParticipation = {
  week_number: number;
  week_start: string;
  week_end: string;
  required_units: number;
  due_units: number;
  completed_units: number;
  activity_units: number;
  state: ProgrammeCheckpointState;
  is_current: boolean;
};

export type ProgrammeLearningItem = {
  key: "skill_cards" | "quizzes" | "reflections" | "daily_prompts";
  label: string;
  required_units: number;
  due_units: number;
  completed_units: number;
  progress_available: boolean;
  status: ProgrammeCheckpointState | "unavailable";
};

export type ProgrammeCoachingUtilisation = {
  required_units: number | null;
  completed_units: number | null;
  due_units: number | null;
  booked_units: number | null;
  utilisation_pct: number | null;
  next_session_at: string | null;
};

export interface ProgrammeExperience {
  weeklyParticipation: ProgrammeWeeklyParticipation[];
  learningBreakdown: ProgrammeLearningItem[];
  coachingUtilisation: ProgrammeCoachingUtilisation | null;
}

export const EMPTY_PROGRAMME_EXPERIENCE: ProgrammeExperience = {
  weeklyParticipation: [],
  learningBreakdown: [],
  coachingUtilisation: null,
};

type CanonicalProgressRow = Database["public"]["Functions"]["learner_canonical_progress"]["Returns"][number];

/** The progress facts both sponsor_canonical_enrollment_metadata and learner_canonical_progress return. */
export type ProgrammeProgressFacts = Pick<
  CanonicalProgressRow,
  | "enrollment_id"
  | "learner_display_name"
  | "programme_label"
  | "cohort_label"
  | "enrollment_start_date"
  | "enrollment_end_date"
  | "programme_start_date"
  | "programme_end_date"
  | "enrollment_status"
  | "stored_enrollment_status"
  | "effective_enrollment_status"
  | "required_units"
  | "completed_units"
  | "due_units"
  | "booked_units"
  | "overdue_units"
  | "full_completion_pct"
  | "due_adherence_pct"
  | "coaching_required_units"
  | "coaching_completed_units"
  | "coaching_due_units"
  | "coaching_booked_units"
  | "training_required_units"
  | "training_completed_units"
  | "training_due_units"
  | "peer_required_units"
  | "peer_completed_units"
  | "peer_due_units"
  | "mentoring_required_units"
  | "mentoring_completed_units"
  | "mentoring_due_units"
  | "triad_required_units"
  | "triad_completed_units"
  | "triad_due_units"
>;

/** canonical_enrollment_engagement — counts/averages only, identical for sponsor and learner. */
export type ProgrammeEngagementFacts = {
  goal_count: number | null;
  goal_progress_pct: number | null;
  open_action_count: number | null;
  completed_action_count: number | null;
  total_action_count: number | null;
  satisfaction_avg: number | null;
  satisfaction_rated_count: number | null;
};

export const EMPTY_ENGAGEMENT: ProgrammeEngagementFacts = {
  goal_count: null,
  goal_progress_pct: null,
  open_action_count: null,
  completed_action_count: null,
  total_action_count: null,
  satisfaction_avg: null,
  satisfaction_rated_count: null,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const CHECKPOINT_STATES = ["completed", "current", "overdue", "upcoming"];

/** Parses sponsor_canonical_leader_journey / learner_canonical_journey (same JSON contract). */
export function parseProgrammeJourney(value: unknown): ProgrammeJourneyPoint[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ProgrammeJourneyPoint => {
      const row = asRecord(item);
      return (
        typeof row.checkpoint_number === "number" &&
        typeof row.due_on === "string" &&
        typeof row.required_units === "number" &&
        typeof row.completed_units === "number" &&
        CHECKPOINT_STATES.includes(String(row.state))
      );
    })
    .map((item) => ({
      checkpoint_number: item.checkpoint_number,
      due_on: item.due_on,
      label: item.label ?? null,
      module_scope: Array.isArray(item.module_scope) ? item.module_scope.map(String) : [],
      required_units: item.required_units,
      completed_units: item.completed_units,
      state: item.state,
    }))
    .sort((a, b) => a.checkpoint_number - b.checkpoint_number);
}

/** Parses sponsor_canonical_leader_experience / learner_canonical_experience (same JSON contract). */
export function parseProgrammeExperience(value: unknown): ProgrammeExperience {
  const payload = asRecord(value) as {
    weekly_participation?: unknown;
    learning_breakdown?: unknown;
    coaching_utilisation?: unknown;
  };
  const weeklyValue = Array.isArray(payload.weekly_participation) ? payload.weekly_participation : [];
  const learningValue = Array.isArray(payload.learning_breakdown) ? payload.learning_breakdown : [];
  const coaching = asRecord(payload.coaching_utilisation);

  return {
    weeklyParticipation: weeklyValue
      .filter((item): item is ProgrammeWeeklyParticipation => {
        const row = asRecord(item);
        return (
          typeof row.week_number === "number" &&
          typeof row.week_start === "string" &&
          typeof row.week_end === "string" &&
          typeof row.required_units === "number" &&
          typeof row.completed_units === "number" &&
          typeof row.activity_units === "number" &&
          CHECKPOINT_STATES.includes(String(row.state))
        );
      })
      .map((item) => ({
        week_number: item.week_number,
        week_start: item.week_start,
        week_end: item.week_end,
        required_units: item.required_units,
        due_units: item.due_units,
        completed_units: item.completed_units,
        activity_units: item.activity_units,
        state: item.state,
        is_current: Boolean(item.is_current),
      })),
    learningBreakdown: learningValue
      .filter((item): item is ProgrammeLearningItem => {
        const row = asRecord(item);
        return (
          typeof row.key === "string" &&
          typeof row.label === "string" &&
          typeof row.required_units === "number" &&
          typeof row.due_units === "number" &&
          typeof row.completed_units === "number" &&
          typeof row.progress_available === "boolean" &&
          [...CHECKPOINT_STATES, "unavailable"].includes(String(row.status))
        );
      })
      .map((item) => ({
        key: item.key,
        label: item.label,
        required_units: item.required_units,
        due_units: item.due_units,
        completed_units: item.completed_units,
        progress_available: item.progress_available,
        status: item.status,
      })),
    coachingUtilisation:
      Object.keys(coaching).length === 0
        ? null
        : {
            required_units: asNumber(coaching.required_units),
            completed_units: asNumber(coaching.completed_units),
            due_units: asNumber(coaching.due_units),
            booked_units: asNumber(coaching.booked_units),
            utilisation_pct: asNumber(coaching.utilisation_pct),
            next_session_at: typeof coaching.next_session_at === "string" ? coaching.next_session_at : null,
          },
  };
}

/**
 * Index of the checkpoint that marks "where the learner is now": the
 * checkpoint the backend flagged `current`, otherwise the last checkpoint
 * whose date has passed (completed/overdue), otherwise the first upcoming
 * one. Uses only the backend-assigned states, never dates vs. a client clock.
 */
/**
 * The learner's position on the canonical journey: the checkpoint due today,
 * else the next upcoming checkpoint (the one currently being worked towards),
 * else — programme finished — the final checkpoint. Only canonical dates and
 * states are read; nothing is recalculated.
 */
export function journeyFocusIndex(journey: ProgrammeJourneyPoint[]): number {
  if (journey.length === 0) return -1;
  const current = journey.findIndex((p) => p.state === "current");
  if (current >= 0) return current;
  const nextUpcoming = journey.findIndex((p) => p.state === "upcoming");
  if (nextUpcoming >= 0) return nextUpcoming;
  return journey.length - 1;
}

export interface JourneyWindow {
  points: ProgrammeJourneyPoint[];
  focusIndex: number;
  firstShown: number;
  lastShown: number;
  total: number;
  truncated: boolean;
}

/**
 * The same canonical checkpoint list, optionally narrowed to `maxVisible`
 * consecutive checkpoints around the current position (the Dashboard's
 * summary). The points themselves are never altered — a narrowed window
 * shows exactly the checkpoints, statuses and cumulative units the full
 * journey shows for those dates.
 */
export function journeyWindow(journey: ProgrammeJourneyPoint[], maxVisible?: number): JourneyWindow {
  const focusIndex = journeyFocusIndex(journey);
  const total = journey.length;
  if (!maxVisible || total <= maxVisible) {
    return { points: journey, focusIndex, firstShown: total ? 1 : 0, lastShown: total, total, truncated: false };
  }
  // Keep one checkpoint of context before the focus, then look ahead.
  let start = Math.max(0, focusIndex - 1);
  start = Math.min(start, total - maxVisible);
  const points = journey.slice(start, start + maxVisible);
  return {
    points,
    focusIndex,
    firstShown: start + 1,
    lastShown: start + points.length,
    total,
    truncated: true,
  };
}

export type ProgrammeModuleKey = "coaching" | "training" | "peer" | "mentoring" | "triads";

export interface ProgrammeModuleRow {
  key: ProgrammeModuleKey;
  completed: number | null;
  required: number | null;
  due: number | null;
}

/** Canonical module ordering + field mapping used by every module-progress rendering. */
export function programmeModuleRows(facts: ProgrammeProgressFacts): ProgrammeModuleRow[] {
  return [
    { key: "coaching", completed: facts.coaching_completed_units, required: facts.coaching_required_units, due: facts.coaching_due_units },
    { key: "training", completed: facts.training_completed_units, required: facts.training_required_units, due: facts.training_due_units },
    { key: "peer", completed: facts.peer_completed_units, required: facts.peer_required_units, due: facts.peer_due_units },
    { key: "mentoring", completed: facts.mentoring_completed_units, required: facts.mentoring_required_units, due: facts.mentoring_due_units },
    { key: "triads", completed: facts.triad_completed_units, required: facts.triad_required_units, due: facts.triad_due_units },
  ];
}

/** Learning-breakdown rows that carry a configured requirement (hidden/unselected items never appear). */
export function configuredLearningItems(items: ProgrammeLearningItem[]): ProgrammeLearningItem[] {
  return items.filter((item) => item.progress_available && item.required_units > 0);
}

export function clampPct(value: number) {
  return Math.max(0, Math.min(100, value));
}

export function formatPercent(value: number | null | undefined) {
  return value == null ? "—" : `${Math.round(value)}%`;
}

export function formatCount(value: number | null | undefined) {
  return value == null ? "—" : String(value);
}

export function formatRatio(completed: number | null | undefined, required: number | null | undefined) {
  return completed == null || required == null ? "—" : `${completed}/${required}`;
}

/** Display-only width of a progress bar for an already-canonical completed/required pair. */
export function ratioPct(completed: number | null | undefined, required: number | null | undefined) {
  return completed == null || required == null || required === 0 ? null : clampPct((completed / required) * 100);
}

export function formatProfileDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatProfileDateTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function profileInitials(name: string | null | undefined) {
  return (name || "?")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/** Date-derived programme lifecycle (the journey header chip). */
export function programmeLifecycle(start: string | null, end: string | null, now = Date.now()): "upcoming" | "active" | "complete" {
  const startMs = start ? new Date(start).getTime() : NaN;
  const endMs = end ? new Date(end).getTime() : NaN;
  if (Number.isFinite(startMs) && now < startMs) return "upcoming";
  if (Number.isFinite(endMs) && now > endMs) return "complete";
  return "active";
}
