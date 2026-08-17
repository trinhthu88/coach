// Onboarding tour content — coachee, coach, and sponsor are all wired to the
// live app (see src/components/onboarding/OnboardingTour.tsx and AppLayout.tsx's
// "How it works" nav entry / auto-trigger), and all three roles' copy lives in
// src/locales/{en,vi}/onboarding.json, built via buildRoleContent(t, role) below.
//
// The "coachee" section's Vietnamese text is human-approved — see
// docs/vi-localization-style-guide.md. "coach" and "sponsor" are machine-translated
// placeholders (see the __reviewed note at the top of vi/onboarding.json) pending
// the same approved pass.

import type { TFunction } from "i18next";

export type BulletKind = "in" | "ok" | "no"; // "in" = informational/neutral, "ok" = allowed/visible, "no" = withheld/not allowed
export type OnboardingBullet = { kind: BulletKind; label: string; text: string };
export type OnboardingStep = { kicker: string; title: string; body: string; bullets?: OnboardingBullet[] };
export type OnboardingPointer = { where: string; title: string; body: string; targetSelector: string | null };

export type OnboardingContent = { steps: OnboardingStep[]; pointers: OnboardingPointer[] };

export type OnboardingRole = "coachee" | "coach" | "sponsor";

// Bullet "kind" and pointer "targetSelector" are rendering metadata, not
// translatable text, so they stay here rather than in the JSON namespace —
// keyed to match each role's step/pointer keys in onboarding.json.
const STEP_KEYS: Record<OnboardingRole, string[]> = {
  coachee: ["welcome", "goals", "coach", "book", "privacy", "progress"],
  coach: ["welcome", "profile", "availability", "practice", "privacy", "flags"],
  sponsor: ["welcome", "timing", "enrolment", "withheld", "metrics"],
};

const POINTER_KEYS: Record<OnboardingRole, string[]> = {
  coachee: ["findCoaches", "nextSession", "sessionLog"],
  coach: ["availability", "nextSession", "bookingRequests"],
  sponsor: ["navigation", "cohortFilter", "roster"],
};

const BULLET_KINDS: Record<OnboardingRole, Record<string, BulletKind[]>> = {
  coachee: {
    goals: ["in", "in", "in"],
    coach: ["in", "in", "in"],
    privacy: ["ok", "no", "in"],
  },
  coach: {
    profile: ["in", "in", "in"],
    availability: ["in", "in", "in"],
    practice: ["in", "in", "in"],
    privacy: ["ok", "no", "in"],
  },
  sponsor: {
    enrolment: ["in", "in", "in"],
    withheld: ["ok", "no", "no"],
  },
};

const POINTER_SELECTORS: Record<OnboardingRole, Record<string, string | null>> = {
  coachee: {
    findCoaches: '[data-onboarding="nav-find-coaches"]',
    nextSession: '[data-onboarding="dashboard-next-session"]',
    sessionLog: '[data-onboarding="dashboard-session-log"]',
  },
  coach: {
    availability: '[data-onboarding="nav-my-availability"]',
    nextSession: '[data-onboarding="dashboard-next-session"]',
    bookingRequests: '[data-onboarding="dashboard-booking-requests"]',
  },
  sponsor: {
    navigation: '[data-onboarding="nav-sponsor-dashboard"]',
    cohortFilter: '[data-onboarding="sponsor-cohort-filter"]',
    roster: '[data-onboarding="sponsor-roster"]',
  },
};

function buildRoleContent(t: TFunction<"onboarding">, role: OnboardingRole): OnboardingContent {
  const stepKeys = STEP_KEYS[role];
  const pointerKeys = POINTER_KEYS[role];
  const bulletKinds = BULLET_KINDS[role];
  const pointerSelectors = POINTER_SELECTORS[role];

  return {
    steps: stepKeys.map((key) => {
      const kinds = bulletKinds[key];
      const bullets = kinds
        ? (t(`${role}.steps.${key}.bullets`, { returnObjects: true }) as { label: string; text: string }[]).map(
            (b, i) => ({ ...b, kind: kinds[i] })
          )
        : undefined;
      return {
        kicker: t(`${role}.steps.${key}.kicker`),
        title: t(`${role}.steps.${key}.title`),
        body: t(`${role}.steps.${key}.body`),
        ...(bullets ? { bullets } : {}),
      };
    }),
    pointers: pointerKeys.map((key) => ({
      where: t(`${role}.pointers.${key}.where`),
      title: t(`${role}.pointers.${key}.title`),
      body: t(`${role}.pointers.${key}.body`),
      targetSelector: pointerSelectors[key],
    })),
  };
}

export function getOnboardingContent(t: TFunction<"onboarding">, role: OnboardingRole): OnboardingContent {
  return buildRoleContent(t, role);
}
