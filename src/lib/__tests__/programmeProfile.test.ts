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
  // point(n) is due 2026-01-(3n): CP5 is due 2026-01-15.
  const journey = [point(1, "overdue"), point(2, "overdue"), point(3, "completed"), point(4, "completed"), point(5, "current"), point(6, "upcoming"), point(7, "upcoming")];
  const TODAY = "2026-01-15";

  it("focuses the checkpoint due today", () => {
    expect(journeyFocusIndex(journey, TODAY)).toBe(4);
  });

  it("without a checkpoint due today, focuses the next one by date; a finished programme focuses its final checkpoint", () => {
    expect(journeyFocusIndex([point(1, "completed"), point(2, "overdue"), point(3, "upcoming")], "2026-01-07")).toBe(2);
    expect(journeyFocusIndex([point(1, "upcoming"), point(2, "upcoming")], "2026-01-01")).toBe(0);
    expect(journeyFocusIndex([point(1, "completed"), point(2, "overdue")], "2026-02-01")).toBe(1);
    expect(journeyFocusIndex([])).toBe(-1);
  });

  it("several checkpoints can be current (available, not yet due): the position is still one calendar point", () => {
    const available = [point(1, "completed"), point(2, "completed_late"), point(3, "current"), point(4, "current"), point(5, "current")];
    expect(journeyFocusIndex(available, "2026-01-08")).toBe(2);
    expect(journeyWindow(available, 3, null, "2026-01-08").focusIndex).toBe(2);
  });

  it("position is calendar-based: requirements completed early never move it to the last checkpoint", () => {
    const at = (n: number, due_on: string, state: ProgrammeJourneyPoint["state"]) => ({ ...point(n, state), due_on });
    // Everything done (18/18) in September; the last checkpoints are months away.
    const done = [at(1, "2026-06-24", "completed"), at(2, "2026-08-23", "completed"), at(3, "2026-10-06", "completed"), at(4, "2027-02-19", "completed")];
    expect(journeyFocusIndex(done, "2026-09-22")).toBe(2);
    expect(journeyFocusIndex(done, "2027-03-01")).toBe(3);
    // A checkpoint due today is the position whether or not it is completed.
    expect(journeyFocusIndex(done, "2026-10-06")).toBe(2);
  });

  it("the Dashboard window is contextual (previous, current, next, next) — not the last N", () => {
    const midProgramme = [
      point(1, "completed"), point(2, "completed"), point(3, "overdue"), point(4, "upcoming"),
      point(5, "upcoming"), point(6, "upcoming"), point(7, "upcoming"), point(8, "upcoming"), point(9, "upcoming"), point(10, "upcoming"),
    ];
    // CP3 (01-09) has passed; CP4 (01-12) is next.
    const window = journeyWindow(midProgramme, 4, null, "2026-01-10");
    expect(window.points.map((p) => p.checkpoint_number)).toEqual([3, 4, 5, 6]);
    expect(window.points).toEqual(midProgramme.slice(2, 6));
    expect(window.lastShown).not.toBe(window.total);

    // Not started yet: the first checkpoints.
    expect(journeyWindow(midProgramme, 4, null, "2025-12-01").points.map((p) => p.checkpoint_number)).toEqual([1, 2, 3, 4]);

    // Finished programme: the window ends on the final checkpoint.
    expect(journeyWindow(midProgramme, 4, null, "2026-03-01").points.map((p) => p.checkpoint_number)).toEqual([7, 8, 9, 10]);
  });

  it("a paged window reaches CP1 and the final checkpoint without leaving the Dashboard", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => point(i + 1, i < 6 ? "completed" : i === 6 ? "current" : "upcoming"));
    const today = "2026-01-21"; // CP7
    expect(journeyWindow(twelve, 4, null, today).firstShown).toBe(6);
    expect(journeyWindow(twelve, 4, 0, today).points.map((p) => p.checkpoint_number)).toEqual([1, 2, 3, 4]);
    expect(journeyWindow(twelve, 4, -3, today).firstShown).toBe(1);
    expect(journeyWindow(twelve, 4, 99, today).points.map((p) => p.checkpoint_number)).toEqual([9, 10, 11, 12]);
    // Paging never changes the position.
    expect(journeyWindow(twelve, 4, 0, today).focusIndex).toBe(6);
  });

  it("a summary window is an unaltered consecutive slice around the current position", () => {
    const window = journeyWindow(journey, 4, null, TODAY);
    expect(window.points.map((p) => p.checkpoint_number)).toEqual([4, 5, 6, 7]);
    expect(window.points).toEqual(journey.slice(3, 7));
    expect(window).toMatchObject({ firstShown: 4, lastShown: 7, total: 7, truncated: true });
  });

  it("the full journey is never narrowed", () => {
    expect(journeyWindow(journey).points).toBe(journey);
    expect(journeyWindow(journey.slice(0, 3), 4).truncated).toBe(false);
  });

  it("parses completed_late as a canonical state", () => {
    const parsed = parseProgrammeJourney([{ checkpoint_number: 1, due_on: "2026-01-05", label: null, module_scope: ["training"], required_units: 1, completed_units: 1, state: "completed_late" }]);
    expect(parsed.map((p) => p.state)).toEqual(["completed_late"]);
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
