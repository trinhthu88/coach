import { useTranslation } from "react-i18next";
import { formatPercent, type GoalProgressState, type ProgrammeCheckpointState } from "@/lib/programmeProfile";

/**
 * Visual primitives of the programme profile — the design system first
 * built for Sponsor → Leader Detail, now shared with the Learner Dashboard
 * and My Journey. Colours are the Clariva paper/navy/sky palette used by
 * the sponsor reference page.
 */
export const PROFILE_COLORS = {
  CARD: "#fffdf9",
  LINE: "#e6e0d6",
  NAVY: "#062f3e",
  SKY: "#3db4d0",
  TEAL: "#2c8fa8",
  GREEN: "#17663f",
  AMBER: "#a8541c",
  RED: "#a8341c",
  MUTED: "#6a6560",
  FAINT: "#9a938a",
} as const;

/** Who is looking at the profile. Changes detail visibility and wording, never the numbers. */
export type ProgrammeViewer = "sponsor" | "learner";

/**
 * Copy for the shared profile. Terminology comes from the sponsor reference
 * (`sponsor:leaderDrawer.reference.*`) so both surfaces use the same words
 * for the same facts; the learner self-view overrides only sentences that
 * describe sponsor privacy (`dashboard:learnerProfile.reference.*`).
 */
export function useProfileText(viewer: ProgrammeViewer) {
  const { t, i18n } = useTranslation("sponsor");
  const { t: tDash } = useTranslation("dashboard");
  return (key: string, options?: Record<string, unknown>) => {
    const learnerKey = `learnerProfile.reference.${key}`;
    if (viewer === "learner" && i18n.exists(learnerKey, { ns: "dashboard" })) return tDash(learnerKey, options);
    return t(`leaderDrawer.reference.${key}`, options);
  };
}

/** Shared wording for goalProgressState — identical for Learner and Sponsor. */
export function goalProgressText(state: GoalProgressState, text: (key: string) => string): string {
  if (state.kind === "no_goal") return text("noGoalSet");
  if (state.kind === "not_rated") return text("goalNotRated");
  return state.kind === "value" ? formatPercent(state.pct) : "—";
}

const { GREEN, TEAL, RED, FAINT } = PROFILE_COLORS;

export function checkpointStateColor(state: ProgrammeCheckpointState) {
  if (state === "completed") return GREEN;
  if (state === "current") return TEAL;
  if (state === "overdue") return RED;
  return FAINT;
}

function humaniseModule(module: string) {
  const text = module.replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : module;
}

/** User-facing label for a canonical module_scope entry — never an internal enum. */
export function moduleScopeLabelFor(module: string, t: (key: string) => string) {
  const labels: Record<string, string> = {
    coaching: t("cohortDetail.modules.coaching"),
    training: t("cohortDetail.modules.training"),
    training_learning: t("cohortDetail.modules.training"),
    peer: t("cohortDetail.modules.peer"),
    peer_coaching: t("cohortDetail.modules.peer"),
    mentoring: t("cohortDetail.modules.mentoring"),
    triads: t("cohortDetail.modules.triads"),
  };
  return labels[module] ?? humaniseModule(module);
}

export function useModuleScopeLabel() {
  const { t } = useTranslation("sponsor");
  return (module: string) => moduleScopeLabelFor(module, t);
}

/** Where a learner goes to work on each canonical module_scope entry (the sidebar's module pages). */
export const LEARNER_MODULE_PATH: Record<string, string> = {
  coaching: "/coaches",
  training: "/training",
  peer_coaching: "/coachee/peer-practice",
  mentoring: "/mentoring",
  triads: "/triads",
};

