import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { EnrollmentConflictNotice } from "../EnrollmentConflictNotice";

describe("EnrollmentConflictNotice", () => {
  it("shows the conflicting enrollment details and provides an explicit review action", () => {
    render(
      <MemoryRouter>
        <EnrollmentConflictNotice
          conflict={{
            enrollmentId: "enrollment-current",
            programmeId: "programme-current",
            programmeName: "Leadership Foundations",
            cohortId: "cohort-current",
            cohortName: "September Cohort",
            status: "paused",
            startDate: "2026-09-01",
            endDate: "2026-12-01",
          }}
          reviewHref="/admin/coachees/learner-1/enrollments/enrollment-current"
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Enrollment already in progress")).toBeInTheDocument();
    expect(screen.getByText("Leadership Foundations")).toBeInTheDocument();
    expect(screen.getByText("September Cohort")).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("2026-09-01")).toBeInTheDocument();
    expect(screen.getByText("2026-12-01")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review enrollment" })).toHaveAttribute(
      "href",
      "/admin/coachees/learner-1/enrollments/enrollment-current"
    );
  });
});
