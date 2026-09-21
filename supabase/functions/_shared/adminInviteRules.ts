// Pure validation / derivation rules for admin-added users.
//
// This module is the single rule set behind every admin provisioning entry
// point (single add, bulk import, sponsor creation) — see adminInvite.ts. It
// has NO runtime imports so it runs unchanged in Deno (edge functions) and in
// Vitest (src/lib/__tests__/adminInviteRules.test.ts).

export type InviteRole = "coachee" | "coach" | "sponsor";

/** One row as submitted by the client (single add, a spreadsheet row, or a resume). */
export interface InviteRowInput {
  /** bulk_invite_rows.id when resuming/retrying a tracked row. */
  row_id?: string;
  full_name?: string;
  email?: string;
  /** coachee | learner | coach | sponsor (case-insensitive; a few aliases accepted). */
  role?: string;
  /** Programme name or id (optional; derived from the cohort). */
  programme?: string;
  /** Cohort name or id (optional). */
  cohort?: string;
  /** Organization name or id (optional; defaults to the cohort's organization; required for sponsors). */
  organization?: string;
  /** Sponsor-only profile fields. */
  title?: string;
  department?: string;
  /** Legacy bulk-invite fields (learners only). */
  session_limit?: number | string | null;
  assign_coach_email?: string;
  assign_coach_id?: string;
  /**
   * The admin confirmed the "existing account" offer shown in the preview:
   * add the enrollment only (learner/coach) or link sponsor access (sponsor).
   * Without it an existing email is skipped — never duplicated.
   */
  accept_existing?: boolean;
}

export interface ProgrammeRef { id: string; name: string }
export interface CohortRef {
  id: string;
  name: string;
  programme_id: string | null;
  organization_id: string | null;
  start_date: string | null;
  end_date: string | null;
}
export interface OrganizationRef { id: string; name: string }
export interface ExistingUserRef { id: string; roles: string[] }

export interface InviteLookups {
  programmes: ProgrammeRef[];
  cohorts: CohortRef[];
  organizations: OrganizationRef[];
  /** Lower-cased email -> existing account. */
  existingUsersByEmail: Map<string, ExistingUserRef>;
  /** Lower-cased email -> active coach id (legacy "Assign coach email"). */
  activeCoachIdByEmail?: Map<string, string>;
  /** Organization ids that already have a sponsor (sponsor_profiles.organization_id is UNIQUE). */
  sponsoredOrganizationIds?: Set<string>;
  /** User ids holding an ongoing (active / at_risk / paused) enrollment. */
  ongoingEnrollmentUserIds?: Set<string>;
  /** User id -> cohort of their ongoing enrollment (tells "same cohort" from "move"). */
  ongoingEnrollmentCohortByUser?: Map<string, string | null>;
  /** YYYY-MM-DD; injectable for tests. */
  today: string;
}

export type InviteProblem =
  | "missing_name"
  | "bad_email"
  | "invalid_role"
  | "duplicate_in_file"
  | "unknown_programme"
  | "unknown_cohort"
  | "ambiguous_cohort"
  | "unknown_organization"
  | "programme_cohort_mismatch"
  | "cohort_required"
  | "cohort_closed"
  | "cohort_undated"
  | "organization_required"
  | "organization_has_sponsor"
  | "sponsor_not_enrollable"
  | "coach_not_found";

/**
 * organization_mismatch is a WARNING, not a problem: the row's organization
 * differs from the cohort's default organization. A cohort may mix learners
 * from several organizations (sponsor visibility is decided by the
 * enrollment's own organization, never the cohort's), so the row still runs —
 * the admin sees it flagged in the preview before confirming.
 */
export type PreviewStatus = "valid" | "existing_user" | "organization_mismatch" | InviteProblem;

/** What executing this row would do. */
export type InviteAction = "create" | "enroll_only" | "transition" | "link_sponsor" | "skip";

/** What an existing account is offered (executed only once the admin accepts). */
export type InviteOffer = "enroll_only" | "transition" | "link_sponsor";

export interface ValidatedInviteRow {
  row_index: number;
  row_id?: string;
  email: string;
  full_name: string;
  role: InviteRole;
  programme_id: string | null;
  cohort_id: string | null;
  organization_id: string | null;
  /** First day of the enrollment: today, or the cohort start when it is in the future. */
  enrollment_start_date: string | null;
  title: string | null;
  department: string | null;
  session_limit: number | null;
  assign_coach_id: string | null;
  existing_user_id: string | null;
  status: PreviewStatus;
  /** Only for existing_user rows: what the admin is being offered. */
  offer: InviteOffer | null;
  accept_existing: boolean;
  action: InviteAction;
  message?: string;
}

export const PROBLEM_MESSAGE: Record<InviteProblem, string> = {
  missing_name: "Full name is required",
  bad_email: "Invalid email address",
  invalid_role: "Role must be learner (coachee), coach or sponsor",
  duplicate_in_file: "Duplicate email in this file",
  unknown_programme: "Programme not found",
  unknown_cohort: "Cohort not found",
  ambiguous_cohort: "Several cohorts have this name — add the programme to pick one",
  unknown_organization: "Organization not found",
  programme_cohort_mismatch: "The cohort does not belong to the given programme",
  cohort_required: "A cohort is required to enroll in a programme or organization",
  cohort_closed: "The cohort has already ended",
  cohort_undated: "The cohort has no end date yet — set its dates before enrolling",
  organization_required: "Sponsors must be linked to an organization",
  organization_has_sponsor: "This organization already has a sponsor",
  sponsor_not_enrollable: "Sponsors are not enrolled — leave programme and cohort empty",
  coach_not_found: "No matching active coach for 'Assign coach email'",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLE_ALIASES: Record<string, InviteRole> = {
  coachee: "coachee",
  learner: "coachee",
  leader: "coachee",
  participant: "coachee",
  "học viên": "coachee",
  coach: "coach",
  sponsor: "sponsor",
};

export function normalizeRole(raw: string | undefined | null): InviteRole | null {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) return null;
  return ROLE_ALIASES[key] ?? null;
}

export function normalizeEmail(raw: string | undefined | null): string {
  return String(raw ?? "").trim().toLowerCase();
}

function clean(raw: unknown): string {
  return String(raw ?? "").trim();
}

function matchByIdOrName<T extends { id: string; name: string }>(items: T[], key: string): T[] {
  if (!key) return [];
  const byId = items.filter((i) => i.id === key);
  if (byId.length) return byId;
  const lower = key.toLowerCase();
  return items.filter((i) => i.name.trim().toLowerCase() === lower);
}

function parseLimit(raw: InviteRowInput["session_limit"]): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * Validates one row against the lookups. `seenEmails` carries the
 * duplicate-in-file state across a batch (mutated).
 */
export function validateInviteRow(
  raw: InviteRowInput,
  row_index: number,
  lookups: InviteLookups,
  seenEmails: Set<string>,
): ValidatedInviteRow {
  const email = normalizeEmail(raw.email);
  const full_name = clean(raw.full_name);
  const role = normalizeRole(raw.role);
  const programmeKey = clean(raw.programme);
  const cohortKey = clean(raw.cohort);
  const organizationKey = clean(raw.organization);
  const accept_existing = raw.accept_existing === true;

  const base: ValidatedInviteRow = {
    row_index,
    row_id: raw.row_id,
    email,
    full_name,
    role: role ?? "coachee",
    programme_id: null,
    cohort_id: null,
    organization_id: null,
    enrollment_start_date: null,
    title: clean(raw.title) || null,
    department: clean(raw.department) || null,
    session_limit: parseLimit(raw.session_limit),
    assign_coach_id: null,
    existing_user_id: null,
    status: "valid",
    offer: null,
    accept_existing,
    action: "skip",
  };
  const fail = (problem: InviteProblem, message?: string): ValidatedInviteRow => ({
    ...base,
    status: problem,
    action: "skip",
    message: message ?? PROBLEM_MESSAGE[problem],
  });

  if (!EMAIL_RE.test(email)) return fail("bad_email");
  if (!full_name) return fail("missing_name");
  if (!role) return fail("invalid_role");
  if (seenEmails.has(email)) return fail("duplicate_in_file");
  seenEmails.add(email);
  let orgWarning: string | null = null;
  const withWarning = (message: string) => (orgWarning ? `${message}. ${orgWarning}` : message);

  // Programme (optional). Resolved first so it can disambiguate a cohort name.
  let programme: ProgrammeRef | null = null;
  if (programmeKey) {
    const matches = matchByIdOrName(lookups.programmes, programmeKey);
    if (matches.length === 0) return fail("unknown_programme");
    programme = matches[0];
  }

  // Organization (optional; required for sponsors).
  let organization: OrganizationRef | null = null;
  if (organizationKey) {
    const matches = matchByIdOrName(lookups.organizations, organizationKey);
    if (matches.length === 0) return fail("unknown_organization");
    organization = matches[0];
  }

  if (role === "sponsor") {
    if (programmeKey || cohortKey) return fail("sponsor_not_enrollable");
    if (!organization) return fail("organization_required");
    base.organization_id = organization.id;
  } else {
    // Cohort (optional). The cohort owns the programme.
    let cohort: CohortRef | null = null;
    if (cohortKey) {
      let matches = matchByIdOrName(lookups.cohorts, cohortKey);
      if (matches.length > 1 && programme) {
        const inProgramme = matches.filter((c) => c.programme_id === programme!.id);
        if (inProgramme.length) matches = inProgramme;
      }
      if (matches.length === 0) return fail("unknown_cohort");
      if (matches.length > 1) return fail("ambiguous_cohort");
      cohort = matches[0];
      if (!cohort.programme_id) return fail("programme_cohort_mismatch", "The cohort has no programme");
      if (programme && programme.id !== cohort.programme_id) return fail("programme_cohort_mismatch");
      if (!cohort.end_date) return fail("cohort_undated");
      if (cohort.end_date < lookups.today) return fail("cohort_closed");
    } else if (programme || organization) {
      // An enrollment is always cohort-scoped; programme/organization alone
      // would be silently dropped, so reject instead.
      return fail("cohort_required");
    }

    if (cohort) {
      base.cohort_id = cohort.id;
      base.programme_id = cohort.programme_id;
      base.organization_id = organization?.id ?? cohort.organization_id ?? null;
      if (organization && cohort.organization_id && cohort.organization_id !== organization.id) {
        const cohortOrg = lookups.organizations.find((o) => o.id === cohort!.organization_id)?.name ?? "another organization";
        orgWarning =
          `Organization differs from the cohort's default (${cohortOrg}) — the enrollment will belong to ` +
          `${organization.name}, and only ${organization.name}'s sponsor will see this person`;
      }
      base.enrollment_start_date =
        cohort.start_date && cohort.start_date > lookups.today ? cohort.start_date : lookups.today;
    }

    // Legacy learner-only extras.
    if (role === "coachee") {
      if (raw.assign_coach_id) {
        const known = [...(lookups.activeCoachIdByEmail?.values() ?? [])].includes(raw.assign_coach_id);
        if (!known) return fail("coach_not_found");
        base.assign_coach_id = raw.assign_coach_id;
      } else if (clean(raw.assign_coach_email)) {
        const coachId = lookups.activeCoachIdByEmail?.get(normalizeEmail(raw.assign_coach_email));
        if (!coachId) return fail("coach_not_found");
        base.assign_coach_id = coachId;
      }
    }
  }

  const existing = lookups.existingUsersByEmail.get(email);
  if (existing) {
    base.existing_user_id = existing.id;
    if (role === "sponsor") {
      if (existing.roles.includes("sponsor")) {
        return { ...base, status: "existing_user", action: "skip", message: "Already a sponsor — nothing to add" };
      }
      if (lookups.sponsoredOrganizationIds?.has(base.organization_id!)) return fail("organization_has_sponsor");
      return {
        ...base,
        status: "existing_user",
        offer: "link_sponsor",
        action: accept_existing ? "link_sponsor" : "skip",
        message: "An account with this email exists — sponsor access can be added to it",
      };
    }
    if (!base.cohort_id) {
      return { ...base, status: "existing_user", action: "skip", message: "An account with this email exists — nothing to add" };
    }
    if (lookups.ongoingEnrollmentUserIds?.has(existing.id)) {
      if (lookups.ongoingEnrollmentCohortByUser?.get(existing.id) === base.cohort_id) {
        return {
          ...base,
          status: "existing_user",
          action: "skip",
          message: "Already enrolled in this cohort — nothing to add",
        };
      }
      // Never a second concurrent enrollment and never an overwrite: the
      // current enrollment is closed (kept in their history) and this one opens.
      return {
        ...base,
        status: "existing_user",
        offer: "transition",
        action: accept_existing ? "transition" : "skip",
        message: withWarning(
          "An account with this email has an ongoing enrollment in another cohort — it can be closed " +
            "(kept in their enrollment history) and replaced by this one",
        ),
      };
    }
    return {
      ...base,
      status: "existing_user",
      offer: "enroll_only",
      action: accept_existing ? "enroll_only" : "skip",
      message: withWarning("An account with this email exists — the enrollment can be added to it"),
    };
  }

  if (role === "sponsor" && lookups.sponsoredOrganizationIds?.has(base.organization_id!)) {
    return fail("organization_has_sponsor");
  }

  if (orgWarning) return { ...base, status: "organization_mismatch", action: "create", message: orgWarning };
  return { ...base, status: "valid", action: "create" };
}

export function validateInviteRows(rows: InviteRowInput[], lookups: InviteLookups): ValidatedInviteRow[] {
  const seen = new Set<string>();
  return rows.map((row, index) => validateInviteRow(row, index, lookups, seen));
}

/**
 * Maps a spreadsheet row (any header casing/spacing, EN or VI) to an
 * InviteRowInput. Used by the client parser; kept here so the column contract
 * lives next to the rules. Role is a REQUIRED column of an import file: pass
 * no defaultRole for file rows, so a blank Role cell is reported as
 * invalid_role in the preview instead of being silently filled in.
 */
export function normalizeSheetRow(raw: Record<string, unknown>, defaultRole?: string): InviteRowInput {
  const byKey = new Map<string, unknown>();
  for (const [k, v] of Object.entries(raw)) {
    byKey.set(k.toLowerCase().replace(/[\s_*-]+/g, ""), v);
  }
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = byKey.get(k);
      if (v !== undefined && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  };
  const limit = pick("sessionlimit");
  return {
    full_name: pick("fullname", "name", "hoten", "họtên", "tên"),
    email: pick("email", "emailaddress"),
    role: pick("role", "vaitrò", "vaitro") || defaultRole || "",
    programme: pick("programme", "program", "chươngtrình", "chuongtrinh"),
    cohort: pick("cohort", "khóa", "khoa"),
    organization: pick("organization", "organisation", "company", "tổchức", "tochuc"),
    title: pick("title", "jobtitle", "chứcdanh"),
    department: pick("department", "phòngban"),
    session_limit: limit === "" ? undefined : limit,
    assign_coach_email: pick("assigncoachemail") || undefined,
  };
}
