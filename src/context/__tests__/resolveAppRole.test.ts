import { describe, expect, it } from "vitest";
import { resolveAppRole } from "../AuthContext";

describe("resolveAppRole", () => {
  it("routes a Sponsor who also carries the trigger-default coachee row to the Sponsor portal", () => {
    expect(resolveAppRole(["coachee", "sponsor"])).toBe("sponsor");
  });

  it("keeps admin and coach ahead of coachee", () => {
    expect(resolveAppRole(["coachee", "admin"])).toBe("admin");
    expect(resolveAppRole(["coachee", "coach"])).toBe("coach");
    expect(resolveAppRole(["coachee"])).toBe("coachee");
  });

  it("ranks sponsor > coach > coachee for users holding several roles", () => {
    expect(resolveAppRole(["coach", "sponsor"])).toBe("sponsor");
    expect(resolveAppRole(["coachee", "coach", "sponsor"])).toBe("sponsor");
    expect(resolveAppRole(["coachee", "coach"])).toBe("coach");
  });

  it("never defaults a missing or unrecognised role to coachee", () => {
    expect(resolveAppRole([])).toBeNull();
    expect(resolveAppRole(["learner"])).toBeNull();
  });
});
