import { describe, expect, it } from "vitest";
import { listedByHistory } from "../useSessionsData";

describe("the Sessions hub lists the learner's own sessions from learner_session_history", () => {
  const history = new Map([["enrol-1", new Set(["s1", "s2"])]]);

  it("keeps a learner-side session its enrollment's history holds, drops one it does not", () => {
    const rows = [
      { id: "s1", viewer_enrollment_id: "enrol-1" },
      { id: "stray", viewer_enrollment_id: "enrol-1" },
    ];
    expect(listedByHistory(rows, history).map((r) => r.id)).toEqual(["s1"]);
  });

  it("keeps sessions the viewer delivers (no viewer enrollment)", () => {
    expect(listedByHistory([{ id: "given", viewer_enrollment_id: null }], history)).toHaveLength(1);
  });

  it("keeps an enrollment's rows when its history could not be read", () => {
    expect(listedByHistory([{ id: "x", viewer_enrollment_id: "enrol-2" }], history)).toHaveLength(1);
  });
});
