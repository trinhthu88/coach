import { describe, expect, it } from "vitest";
import { DEMO_ACCOUNTS, DEMO_PROGRAMMES, LIVE_DEMO_ORG_ID } from "../../../supabase/functions/seed-demo-data/manifest";

describe("live demo manifest", () => {
  it("defines the fixed organization and four manually shared accounts", () => {
    expect(LIVE_DEMO_ORG_ID).toBe("d3000000-0000-4000-8000-000000000001");
    expect(DEMO_ACCOUNTS.map((account) => account.kind)).toEqual([
      "learner_a", "learner_c", "coach", "sponsor",
    ]);
    expect(new Set(DEMO_ACCOUNTS.map((account) => account.email)).size).toBe(4);
  });

  it("gives learner A coaching only and learner C the complete blended experience", () => {
    const byCode = Object.fromEntries(DEMO_PROGRAMMES.map((programme) => [programme.code, programme]));
    expect(Object.keys(byCode)).toEqual(["A", "B", "C", "D"]);
    expect(byCode.A.modules).toEqual(["coaching"]);
    expect(byCode.C.modules).toEqual([
      "coaching", "mentoring", "peer_coaching", "triads", "training", "quiz", "daily_prompt",
    ]);
    expect(byCode.D.lifecycle).toBe("historical");
    expect(DEMO_PROGRAMMES.reduce((sum, programme) => sum + programme.leaderCount, 0)).toBe(40);
  });
});
