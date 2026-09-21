import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasAnyCompetencyRating, type PeerFeedbackState } from "@/hooks/sessions/types";

/** P1-9 / rule 5: no fabricated data, no persisted defaults, no silent zeros. */
const SRC = join(process.cwd(), "src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("no fabricated values", () => {
  it("9a: the Admin dashboard growth figure is a real count, never an assumed rate", () => {
    const dash = code(read("pages/admin/AdminDashboard.tsx"));
    expect(dash).not.toMatch(/\*\s*0\.9\d|\*\s*1\.0\d/);
    expect(dash).toMatch(/newCoacheesThisMonth/);
  });

  it("9b: peer competencies start unrated and a save needs at least one real rating", () => {
    const hook = code(read("hooks/sessions/useSessionPeerFeedback.ts"));
    expect(hook).not.toMatch(/\b70\b/);
    expect(hook).toMatch(/hasAnyCompetencyRating\(/);
    const unrated: PeerFeedbackState = {
      ethical_practice: null, coaching_mindset: null, maintains_agreements: null, trust_safety: null,
      maintains_presence: null, listens_actively: null, evokes_awareness: null, facilitates_growth: null,
      feedback_note: "", existed: false,
    };
    expect(hasAnyCompetencyRating(unrated)).toBe(false);
    expect(hasAnyCompetencyRating({ ...unrated, trust_safety: 60 })).toBe(true);
  });

  it("9c: learner dashboard hooks never turn a failed canonical read into 0", () => {
    for (const file of [
      "hooks/dashboard/useCoachingReceiveCardData.ts",
      "hooks/dashboard/useMentoringCardData.ts",
      "hooks/journey/useJourneyProgramme.ts",
      "hooks/coaching/useCanonicalCoaching.ts",
    ]) {
      const text = code(read(file));
      expect(text, file).not.toMatch(/(required|completed|booked|due|overdue)_units\s*\?\?\s*0/);
      expect(text, file).toMatch(/throw\s+(progressResult\.error|progressError|error)\b/);
    }
    // The Coaching card's goal figure is the canonical engagement number, not a milestone ratio.
    const card = code(read("pages/dashboard/cards/CoachingReceiveCard.tsx"));
    expect(card).toMatch(/useLearnerCanonicalEngagement\(/);
    expect(card).not.toMatch(/goalProgressPct/);
  });

  it("9c: sponsor KPIs show '—' when unknown, and no spend is estimated without billing data", () => {
    for (const file of ["pages/sponsor/SponsorDashboard.tsx", "pages/sponsor/SponsorCohorts.tsx"]) {
      const text = code(read(file));
      expect(text, file).not.toMatch(/kpis\?\.(completed_units|required_units|active_count|enrollment_count)\s*\?\?\s*0/);
      expect(text, file).not.toMatch(/on_track_pct\s*\?\?\s*0/);
    }
    expect(code(read("pages/sponsor/SponsorDashboard.tsx"))).not.toMatch(/spendToDate|projectedExhaustionDate|budgetUsedPct/);
  });

  it("9d: no code claims a completed session is not a fulfilled requirement unit", () => {
    for (const file of ["pages/AdminSessions.tsx", "hooks/coaching/useCanonicalCoaching.ts", "hooks/journey/useJourneyProgramme.ts",
      "hooks/dashboard/useCoachingReceiveCardData.ts", "pages/dashboard/cards/CoachingReceiveCard.tsx"]) {
      expect(read(file), file).not.toMatch(/NOT a completed programme unit|not a completed unit|held-but-unevidenced|counts as booked, not completed/i);
    }
  });
});
