import { describe, expect, it } from "vitest";
import {
  normalizeSheetRow,
  validateInviteRows,
  type InviteLookups,
} from "../../../supabase/functions/_shared/adminInviteRules";

const lookups = (): InviteLookups => ({
  programmes: [
    { id: "prog-a", name: "Leadership" },
    { id: "prog-b", name: "Foundations" },
  ],
  cohorts: [
    { id: "coh-a", name: "Cohort A", programme_id: "prog-a", organization_id: "org-1", start_date: "2026-01-01", end_date: "2026-12-31" },
    { id: "coh-future", name: "Future", programme_id: "prog-a", organization_id: null, start_date: "2026-11-01", end_date: "2027-03-01" },
    { id: "coh-dup-a", name: "Spring", programme_id: "prog-a", organization_id: "org-1", start_date: null, end_date: "2026-12-31" },
    { id: "coh-dup-b", name: "Spring", programme_id: "prog-b", organization_id: "org-2", start_date: null, end_date: "2026-12-31" },
    { id: "coh-old", name: "Old", programme_id: "prog-b", organization_id: "org-1", start_date: "2025-01-01", end_date: "2025-06-01" },
    { id: "coh-orphan", name: "Orphan", programme_id: null, organization_id: null, start_date: null, end_date: "2026-12-31" },
    { id: "coh-undated", name: "Undated", programme_id: "prog-a", organization_id: null, start_date: null, end_date: null },
  ],
  organizations: [
    { id: "org-1", name: "Acme" },
    { id: "org-2", name: "Globex" },
    { id: "org-sponsored", name: "Initech" },
  ],
  existingUsersByEmail: new Map([
    ["existing@example.com", { id: "user-existing", roles: ["coachee"] }],
    ["busy@example.com", { id: "user-busy", roles: ["coachee"] }],
    ["already-sponsor@example.com", { id: "user-sponsor", roles: ["sponsor"] }],
  ]),
  activeCoachIdByEmail: new Map([["coach@example.com", "coach-1"]]),
  sponsoredOrganizationIds: new Set(["org-sponsored"]),
  ongoingEnrollmentUserIds: new Set(["user-busy"]),
  ongoingEnrollmentCohortByUser: new Map([["user-busy", "coh-dup-a"]]),
  today: "2026-09-21",
});

const one = (row: Parameters<typeof validateInviteRows>[0][number]) => validateInviteRows([row], lookups())[0];

describe("admin invite rules", () => {
  it("accepts a learner with no cohort or organization", () => {
    const r = one({ full_name: "Jane", email: " Jane@Example.com ", role: "learner" });
    expect(r).toMatchObject({ status: "valid", action: "create", role: "coachee", email: "jane@example.com", cohort_id: null, programme_id: null });
  });

  it("derives the programme and organization from the cohort", () => {
    const r = one({ full_name: "Jane", email: "jane@example.com", role: "coachee", cohort: "cohort a" });
    expect(r).toMatchObject({ status: "valid", cohort_id: "coh-a", programme_id: "prog-a", organization_id: "org-1", enrollment_start_date: "2026-09-21" });
  });

  it("starts a future cohort's enrollment on the cohort start date", () => {
    expect(one({ full_name: "J", email: "j@example.com", role: "coach", cohort: "Future" }).enrollment_start_date).toBe("2026-11-01");
  });

  it("keeps an explicit organization over the cohort's, flagged as an organization mismatch", () => {
    const r = one({ full_name: "J", email: "j@example.com", role: "coachee", cohort: "coh-a", organization: "Globex" });
    // A cohort may mix organizations, so the row still runs; the admin sees
    // the flag in the preview before confirming.
    expect(r).toMatchObject({ organization_id: "org-2", status: "organization_mismatch", action: "create" });
    expect(r.message).toMatch(/Acme/);
    expect(r.message).toMatch(/Globex/);
  });

  it("does not flag an organization that matches the cohort's, or a cohort without one", () => {
    expect(one({ full_name: "J", email: "j@example.com", role: "coachee", cohort: "coh-a", organization: "Acme" }).status).toBe("valid");
    expect(one({ full_name: "J", email: "j@example.com", role: "coachee", cohort: "Future", organization: "Globex" }).status).toBe("valid");
  });

  it("rejects a programme that conflicts with the cohort", () => {
    expect(one({ full_name: "J", email: "j@example.com", role: "coachee", cohort: "Cohort A", programme: "Foundations" }).status).toBe("programme_cohort_mismatch");
    expect(one({ full_name: "J", email: "j@example.com", role: "coachee", cohort: "Orphan" }).status).toBe("programme_cohort_mismatch");
  });

  it("uses the programme to disambiguate a cohort name, else reports it", () => {
    expect(one({ full_name: "J", email: "j@example.com", role: "coachee", cohort: "Spring" }).status).toBe("ambiguous_cohort");
    expect(one({ full_name: "J", email: "j@example.com", role: "coachee", cohort: "Spring", programme: "Foundations" }))
      .toMatchObject({ status: "valid", cohort_id: "coh-dup-b", organization_id: "org-2" });
  });

  it("reports unknown references and closed / undated cohorts", () => {
    expect(one({ full_name: "J", email: "j@example.com", role: "coachee", cohort: "Nope" }).status).toBe("unknown_cohort");
    expect(one({ full_name: "J", email: "j@example.com", role: "coachee", programme: "Nope", cohort: "Cohort A" }).status).toBe("unknown_programme");
    expect(one({ full_name: "J", email: "j@example.com", role: "coachee", cohort: "Cohort A", organization: "Nope" }).status).toBe("unknown_organization");
    expect(one({ full_name: "J", email: "j@example.com", role: "coachee", cohort: "Old" }).status).toBe("cohort_closed");
    expect(one({ full_name: "J", email: "j@example.com", role: "coachee", cohort: "Undated" }).status).toBe("cohort_undated");
  });

  it("requires a cohort when only a programme or organization is given", () => {
    expect(one({ full_name: "J", email: "j@example.com", role: "coachee", programme: "Leadership" }).status).toBe("cohort_required");
    expect(one({ full_name: "J", email: "j@example.com", role: "coach", organization: "Acme" }).status).toBe("cohort_required");
  });

  it("validates identity fields and duplicates within the file", () => {
    const rows = validateInviteRows(
      [
        { full_name: "A", email: "not-an-email", role: "coachee" },
        { full_name: "", email: "b@example.com", role: "coachee" },
        { full_name: "C", email: "c@example.com", role: "admin" },
        { full_name: "D", email: "d@example.com", role: "coachee" },
        { full_name: "D again", email: "D@example.com", role: "coach" },
      ],
      lookups(),
    );
    expect(rows.map((r) => r.status)).toEqual(["bad_email", "missing_name", "invalid_role", "valid", "duplicate_in_file"]);
    expect(rows.every((r) => r.status === "valid" || r.action === "skip")).toBe(true);
  });

  describe("existing accounts are never duplicated", () => {
    it("offers enrollment only and executes it only once accepted", () => {
      const offered = one({ full_name: "E", email: "existing@example.com", role: "coachee", cohort: "Cohort A" });
      expect(offered).toMatchObject({ status: "existing_user", offer: "enroll_only", action: "skip", existing_user_id: "user-existing" });
      const accepted = one({ full_name: "E", email: "existing@example.com", role: "coachee", cohort: "Cohort A", accept_existing: true });
      expect(accepted.action).toBe("enroll_only");
    });

    it("skips an existing account with nothing to add or already in that cohort", () => {
      expect(one({ full_name: "E", email: "existing@example.com", role: "coachee" })).toMatchObject({ status: "existing_user", offer: null, action: "skip" });
      expect(one({ full_name: "B", email: "busy@example.com", role: "coachee", cohort: "coh-dup-a", accept_existing: true }))
        .toMatchObject({ status: "existing_user", offer: null, action: "skip" });
    });

    it("offers to move an ongoing enrollment to another cohort, only once accepted", () => {
      const offered = one({ full_name: "B", email: "busy@example.com", role: "coachee", cohort: "Cohort A" });
      expect(offered).toMatchObject({ status: "existing_user", offer: "transition", action: "skip", existing_user_id: "user-busy" });
      expect(offered.message).toMatch(/kept in their enrollment history/);
      const accepted = one({ full_name: "B", email: "busy@example.com", role: "coachee", cohort: "Cohort A", accept_existing: true });
      expect(accepted.action).toBe("transition");
    });
  });

  describe("sponsors", () => {
    it("requires an organization and no enrollment fields", () => {
      expect(one({ full_name: "S", email: "s@example.com", role: "sponsor" }).status).toBe("organization_required");
      expect(one({ full_name: "S", email: "s@example.com", role: "sponsor", organization: "Acme", cohort: "Cohort A" }).status).toBe("sponsor_not_enrollable");
      expect(one({ full_name: "S", email: "s@example.com", role: "sponsor", organization: "Acme", title: "VP" }))
        .toMatchObject({ status: "valid", action: "create", organization_id: "org-1", title: "VP" });
    });

    it("rejects an organization that already has a sponsor", () => {
      expect(one({ full_name: "S", email: "s@example.com", role: "sponsor", organization: "Initech" }).status).toBe("organization_has_sponsor");
    });

    it("offers sponsor access to an existing non-sponsor account", () => {
      expect(one({ full_name: "E", email: "existing@example.com", role: "sponsor", organization: "Acme", accept_existing: true }))
        .toMatchObject({ status: "existing_user", offer: "link_sponsor", action: "link_sponsor" });
      expect(one({ full_name: "E", email: "already-sponsor@example.com", role: "sponsor", organization: "Acme", accept_existing: true }).action).toBe("skip");
    });
  });

  it("resolves the legacy assign-coach column for learners", () => {
    expect(one({ full_name: "J", email: "j@example.com", role: "coachee", assign_coach_email: "COACH@example.com" }).assign_coach_id).toBe("coach-1");
    expect(one({ full_name: "J", email: "j@example.com", role: "coachee", assign_coach_email: "nobody@example.com" }).status).toBe("coach_not_found");
  });
});

describe("normalizeSheetRow", () => {
  it("maps header variants to the canonical columns", () => {
    expect(
      normalizeSheetRow({ "Full name*": " Jane ", "Email*": "jane@example.com", "Role*": "Learner", Programme: "P", Cohort: "C", Organisation: "O" }),
    ).toMatchObject({ full_name: "Jane", email: "jane@example.com", role: "Learner", programme: "P", cohort: "C", organization: "O" });
  });

  it("falls back to the default role and legacy Name column", () => {
    expect(normalizeSheetRow({ Name: "Jo", Email: "jo@example.com" }, "coach")).toMatchObject({ full_name: "Jo", role: "coach" });
  });

  it("leaves a blank Role cell blank for file rows, so the preview reports invalid_role", () => {
    const row = normalizeSheetRow({ Name: "Jo", Email: "jo@example.com", Role: "" });
    expect(row.role).toBe("");
    expect(validateInviteRows([row], lookups())[0].status).toBe("invalid_role");
  });
});
