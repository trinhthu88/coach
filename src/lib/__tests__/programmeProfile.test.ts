import { describe, expect, it } from "vitest";
import {
  configuredLearningItems,
  journeyFocusIndex,
  journeyWindow,
  parseProgrammeExperience,
  parseProgrammeJourney,
  programmeModuleRows,
  type ProgrammeJourneyPoint,
  type ProgrammeProgressFacts,
} from "../programmeProfile";

const point = (n: number, state: ProgrammeJourneyPoint["state"]): ProgrammeJourneyPoint => ({
  checkpoint_number: n,
  due_on: `2026-01-${String(n * 3).padStart(2, "0")}`,
  label: null,
  module_scope: ["training"],
  required_units: n,
  completed_units: state === "completed" ? n : 0,
  state,
});

describe("parseProgrammeJourney", () => {
  it("keeps every canonical field untouched and orders by checkpoint number", () => {
    const raw = [
      { checkpoint_number: 2, due_on: "2026-01-12", label: "Week 2", module_scope: ["training"], required_units: 2, completed_units: 0, state: "overdue" },
      { checkpoint_number: 1, due_on: "2026-01-05", label: null, module_scope: ["training"], required_units: 1, completed_units: 0, state: "overdue" },
    ];
    expect(parseProgrammeJourney(raw)).toEqual([
      { checkpoint_number: 1, due_on: "2026-01-05", label: null, module_scope: ["training"], required_units: 1, completed_units: 0, state: "overdue" },
      { checkpoint_number: 2, due_on: "2026-01-12", label: "Week 2", module_scope: ["training"], required_units: 2, completed_units: 0, state: "overdue" },
    ]);
  });

  it("drops malformed rows instead of inventing values", () => {
    expect(parseProgrammeJourney([{ checkpoint_number: 1, due_on: "2026-01-05", state: "bogus" }, null, "x"])).toEqual([]);
    expect(parseProgrammeJourney(null)).toEqual([]);
  });
});

describe("parseProgrammeExperience", () => {
  it("parses the learning breakdown and coaching utilisation from the shared contract", () => {
    const parsed = parseProgrammeExperience({
      learning_breakdown: [
        { key: "skill_cards", label: "Skill Cards", required_units: 6, due_units: 6, completed_units: 5, progress_available: true, status: "overdue" },
        { key: "daily_prompts", label: "Daily Prompts", required_units: 0, due_units: 0, completed_units: 0, progress_available: false, status: "unavailable" },
      ],
      coaching_utilisation: { required_units: 4, completed_units: 4, booked_units: 0, next_session_at: null },
    });
    expect(configuredLearningItems(parsed.learningBreakdown).map((i) => `${i.label} ${i.completed_units}/${i.required_units}`)).toEqual(["Skill Cards 5/6"]);
    expect(parsed.coachingUtilisation).toMatchObject({ required_units: 4, completed_units: 4, booked_units: 0, next_session_at: null });
  });

  it("returns an empty experience for an unauthorised/empty payload", () => {
    expect(parseProgrammeExperience({})).toEqual({ weeklyParticipation: [], learningBreakdown: [], coachingUtilisation: null });
  });
});

describe("journey focus and window", () => {
  const journey = [point(1, "overdue"), point(2, "overdue"), point(3, "completed"), point(4, "completed"), point(5, "current"), point(6, "upcoming"), point(7, "upcoming")];

  it("focuses the backend's current checkpoint", () => {
    expect(journeyFocusIndex(journey)).toBe(4);
  });

  it("falls back to the last passed checkpoint, then the first", () => {
    expect(journeyFocusIndex([point(1, "completed"), point(2, "overdue"), point(3, "upcoming")])).toBe(1);
    expect(journeyFocusIndex([point(1, "upcoming"), point(2, "upcoming")])).toBe(0);
    expect(journeyFocusIndex([])).toBe(-1);
  });

  it("a summary window is an unaltered consecutive slice around the current position", () => {
    const window = journeyWindow(journey, 4);
    expect(window.points.map((p) => p.checkpoint_number)).toEqual([4, 5, 6, 7]);
    expect(window.points).toEqual(journey.slice(3, 7));
    expect(window).toMatchObject({ firstShown: 4, lastShown: 7, total: 7, truncated: true });
  });

  it("the full journey is never narrowed", () => {
    expect(journeyWindow(journey).points).toBe(journey);
    expect(journeyWindow(journey.slice(0, 3), 4).truncated).toBe(false);
  });
});

describe("programmeModuleRows", () => {
  it("maps canonical columns in the one canonical module order", () => {
    const facts = {
      coaching_completed_units: 4, coaching_required_units: 4, coaching_due_units: 4,
      training_completed_units: 5, training_required_units: 6, training_due_units: 6,
      peer_completed_units: 2, peer_required_units: 2, peer_due_units: 2,
      mentoring_completed_units: 2, mentoring_required_units: 2, mentoring_due_units: 2,
      triad_completed_units: 1, triad_required_units: 2, triad_due_units: 2,
    } as ProgrammeProgressFacts;
    expect(programmeModuleRows(facts).map((m) => `${m.key} ${m.completed}/${m.required}`)).toEqual([
      "coaching 4/4",
      "training 5/6",
      "peer 2/2",
      "mentoring 2/2",
      "triads 1/2",
    ]);
  });
});
