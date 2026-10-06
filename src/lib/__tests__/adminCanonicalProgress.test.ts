import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));

import { canonicalAtRisk, fetchAdminCompletionRate, type AdminCanonicalProgressRow } from "../adminCanonicalProgress";
import { supabase } from "@/integrations/supabase/client";

const row = (patch: Partial<AdminCanonicalProgressRow>) => ({ progress_available: true, full_completion_pct: null, effective_enrollment_status: "active", enrollment_status: "active", ...patch }) as AdminCanonicalProgressRow;

describe("Admin reads the canonical completion engine", () => {
  it("reads the completion rate summed like Sponsor's, from the server (Prompt 9d)", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: [{ enrollment_count: 2, required_units: 4, completed_units: 1, full_completion_pct: 25 }], error: null } as never);
    await expect(fetchAdminCompletionRate(["a", "b"])).resolves.toBe(25);
    expect(supabase.rpc).toHaveBeenCalledWith("admin_canonical_completion_rate", { p_enrollment_ids: ["a", "b"] });
    await expect(fetchAdminCompletionRate([])).resolves.toBeNull();
  });

  it("counts at-risk by the canonical EFFECTIVE status Learner and Sponsor see, not the stored one", () => {
    const rows = [
      row({ enrollment_id: "a", effective_enrollment_status: "at_risk", enrollment_status: "active" }),
      row({ enrollment_id: "b", effective_enrollment_status: "completed", enrollment_status: "at_risk" }),
    ];
    expect(canonicalAtRisk(rows).map((r) => r.enrollment_id)).toEqual(["a"]);
  });
});
