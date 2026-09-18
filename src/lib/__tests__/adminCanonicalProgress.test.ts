import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));

import { averageCanonicalCompletion, canonicalAtRisk, type AdminCanonicalProgressRow } from "../adminCanonicalProgress";
import { countOverdueActions } from "@/pages/admin/alertScan";

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

  it("counts overdue actions from every original action record", () => {
    const now = new Date("2026-05-01T12:00:00Z");
    const counts = countOverdueActions(
      [
        { enrollment_id: "e1", status: "open", due_date: "2026-04-01" },
        { enrollment_id: "e1", status: "in_progress", due_date: "2026-04-30" },
        { enrollment_id: "e1", status: "completed", due_date: "2026-03-01" },
        { enrollment_id: "e1", status: "open", due_date: "2026-05-01" },
        { enrollment_id: "e2", status: "open", due_date: null },
      ],
      now
    );
    expect(counts.get("e1")).toBe(2);
    expect(counts.has("e2")).toBe(false);
  });
});
