import { describe, expect, it } from "vitest";
import { scopeLearnerSessions } from "../learnerSessionScope";

const row = (id: string, enrollment_id: string | null) => ({ id, enrollment_id });

describe("Sessions hub — learner rows follow the active enrollment", () => {
  const rows = [row("b-coaching", "enr-b"), row("a-coaching", "enr-a"), row("peer-provided", "partner-enr"), row("legacy", null)];

  it("hides the learner's own past-programme sessions and keeps everything else", () => {
    const scoped = scopeLearnerSessions(rows, "enr-b", ["enr-b", "enr-a"], false);
    expect(scoped.rows.map((r) => r.id)).toEqual(["b-coaching", "peer-provided", "legacy"]);
    expect(scoped.hiddenPast).toBe(1);
  });

  it("shows past programmes only on request", () => {
    expect(scopeLearnerSessions(rows, "enr-b", ["enr-b", "enr-a"], true).rows).toHaveLength(4);
  });

  it("each session appears once -- scoping never duplicates rows", () => {
    const scoped = scopeLearnerSessions(rows, "enr-b", ["enr-b", "enr-a"], true);
    expect(new Set(scoped.rows.map((r) => r.id)).size).toBe(scoped.rows.length);
  });
});
