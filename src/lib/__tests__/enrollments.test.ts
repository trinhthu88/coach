import { describe, expect, it, vi } from "vitest";
import {
  createProgrammeEnrollment,
  enrollmentQueryKey,
  isOngoingEnrollment,
  parseOngoingEnrollmentConflict,
  resolveSelectedEnrollment,
  type Enrollment,
} from "../enrollments";

const activeEnrollment: Enrollment = {
  id: "enrollment-active",
  user_id: "learner-1",
  programme_id: "programme-current",
  cohort_id: "cohort-current",
  organization_id: "organization-1",
  start_date: "2026-09-01",
  end_date: "2026-12-01",
  status: "active",
};

const completedEnrollment: Enrollment = {
  ...activeEnrollment,
  id: "enrollment-completed",
  programme_id: "programme-history",
  cohort_id: "cohort-history",
  status: "completed",
};

describe("enrollment conflict handling", () => {
  it.each(["active", "at_risk", "paused"] as const)("treats %s as an ongoing enrollment that blocks another enrollment", (status) => {
    expect(isOngoingEnrollment(status)).toBe(true);

    const conflict = parseOngoingEnrollmentConflict({
      code: "P0001",
      message: JSON.stringify({
        code: "ongoing_enrollment_exists",
        enrollment_id: "enrollment-current",
        programme_id: "programme-current",
        programme_name: "Leadership Foundations",
        cohort_id: "cohort-current",
        cohort_name: "September Cohort",
        status,
        start_date: "2026-09-01",
        end_date: "2026-12-01",
      }),
    });

    expect(conflict).toMatchObject({
      enrollmentId: "enrollment-current",
      programmeName: "Leadership Foundations",
      cohortName: "September Cohort",
      status,
      startDate: "2026-09-01",
      endDate: "2026-12-01",
    });
  });

  it("permits an RPC-created enrollment after a completed enrollment", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: activeEnrollment, error: null });

    const result = await createProgrammeEnrollment(
      { rpc },
      {
        userId: "learner-1",
        programmeId: "programme-new",
        cohortId: "cohort-new",
        organizationId: "organization-1",
        startDate: "2027-01-01",
        endDate: "2027-04-01",
      }
    );

    expect(result).toEqual({ kind: "created", enrollment: activeEnrollment });
    expect(rpc).toHaveBeenCalledWith("create_programme_enrollment", {
      p_user_id: "learner-1",
      p_programme_id: "programme-new",
      p_cohort_id: "cohort-new",
      p_organization_id: "organization-1",
      p_start_date: "2027-01-01",
      p_end_date: "2027-04-01",
    });
  });

  it("returns the current enrollment conflict for the same programme and a new cohort", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message: JSON.stringify({
          code: "ongoing_enrollment_exists",
          enrollment_id: "enrollment-current",
          programme_id: "programme-current",
          cohort_id: "cohort-current",
          status: "active",
          start_date: "2026-09-01",
          end_date: "2026-12-01",
        }),
      },
    });

    const result = await createProgrammeEnrollment(
      { rpc },
      {
        userId: "learner-1",
        programmeId: "programme-current",
        cohortId: "cohort-new",
        organizationId: "organization-1",
      }
    );

    expect(result).toMatchObject({
      kind: "conflict",
      conflict: { enrollmentId: "enrollment-current", cohortId: "cohort-current", status: "active" },
    });
  });
});

describe("explicit enrollment context", () => {
  it("keeps an explicitly selected completed enrollment instead of replacing it with the ongoing enrollment", () => {
    expect(resolveSelectedEnrollment([activeEnrollment, completedEnrollment], completedEnrollment.id)).toEqual(completedEnrollment);
  });

  it("uses distinct cache keys for different enrollment IDs", () => {
    expect(enrollmentQueryKey("journey-goals", "enrollment-active")).not.toEqual(
      enrollmentQueryKey("journey-goals", "enrollment-completed")
    );
  });
});
