import { useTranslation } from "react-i18next";
import type { ProgrammeCheckpointState } from "@/lib/programmeProfile";

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

const { GREEN, TEAL, RED, FAINT } = PROFILE_COLORS;

export function checkpointStateColor(state: ProgrammeCheckpointState) {
  if (state === "completed") return GREEN;
  if (state === "current") return TEAL;
  if (state === "overdue") return RED;
  return FAINT;
}

export function useModuleScopeLabel() {
  const { t } = useTranslation("sponsor");
  return (module: string) => {
    const labels: Record<string, string> = {
      coaching: t("cohortDetail.modules.coaching"),
      training: t("cohortDetail.modules.training"),
      peer_coaching: t("cohortDetail.modules.peer"),
      mentoring: t("cohortDetail.modules.mentoring"),
      triads: t("cohortDetail.modules.triads"),
    };
    return labels[module] ?? module;
  };
}

/** Where a learner goes to work on each canonical module_scope entry. */
export const LEARNER_MODULE_PATH: Record<string, string> = {
  coaching: "/sessions",
  training: "/training",
  peer_coaching: "/coachee/peer-practice",
  mentoring: "/mentoring",
  triads: "/triads",
};

