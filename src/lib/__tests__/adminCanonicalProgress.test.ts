import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));

import { averageCanonicalCompletion, canonicalAtRisk, type AdminCanonicalProgressRow } from "../adminCanonicalProgress";

const row = (patch: Partial<AdminCanonicalProgressRow>) => ({ progress_available: true, full_completion_pct: null, effective_enrollment_status: "active", enrollment_status: "active", ...patch }) as AdminCanonicalProgressRow;

describe("Admin reads the canonical completion engine", () => {
  it("averages the canonical full_completion_pct (enrollments without progress are excluded, not zero)", () => {
    expect(averageCanonicalCompletion([row({ full_completion_pct: 80 }), row({ full_completion_pct: 60 }), row({ progress_available: false })])).toBe(70);
    expect(averageCanonicalCompletion([])).toBe(0);
  });

  it("counts at-risk by the canonical EFFECTIVE status Learner and Sponsor see, not the stored one", () => {
    const rows = [
      row({ enrollment_id: "a", effective_enrollment_status: "at_risk", enrollment_status: "active" }),
      row({ enrollment_id: "b", effective_enrollment_status: "completed", enrollment_status: "at_risk" }),
    ];
    expect(canonicalAtRisk(rows).map((r) => r.enrollment_id)).toEqual(["a"]);
  });
});
