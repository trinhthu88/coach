import { describe, expect, it, vi } from "vitest";
import { requestAdminEnrollment } from "../enrollmentTransition";

describe("requestAdminEnrollment", () => {
  it.each(["active", "at_risk", "paused"])("does not modify an existing %s enrollment when the RPC reports a conflict", async (status) => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message: JSON.stringify({
          code: "ongoing_enrollment_exists",
          enrollment_id: "existing-enrollment",
          programme_id: "programme-a",
          cohort_id: "cohort-a",
          status,
          start_date: "2026-09-01",
          end_date: "2026-12-01",
        }),
      },
    });

    const result = await requestAdminEnrollment(
      {
        userId: "learner-1",
        programmeId: "programme-b",
        cohortId: "cohort-b",
        organizationId: "organization-1",
      },
      { rpc }
    );

    expect(result).toMatchObject({
      kind: "conflict",
      conflict: { enrollmentId: "existing-enrollment", status },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("create_programme_enrollment", expect.objectContaining({
      p_user_id: "learner-1",
      p_programme_id: "programme-b",
      p_cohort_id: "cohort-b",
    }));
  });
});
