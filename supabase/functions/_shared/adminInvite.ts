import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  type InviteLookups,
  type InviteRowInput,
  type ValidatedInviteRow,
  normalizeEmail,
  validateInviteRows,
} from "./adminInviteRules.ts";

// THE admin provisioning service. Every admin way of adding a person — single
// add (Admin -> Learners / Coaches), sponsor creation (Admin -> Organizations)
// and bulk import (CSV/Excel) — runs through runAdminInvite(); the only entry
// point is the admin-invite-users edge function. Rules live in
// adminInviteRules.ts (pure, unit-tested).
//
// Guarantees:
//   * one auth account per email — an existing account is reused (enrollment
//     only / sponsor link, after the admin accepted the preview offer), never
//     duplicated;
//   * admin-added people are ACTIVE immediately (never the approval queue);
//   * enrollments are created only through admin_create_programme_enrollment
//     (the validated SQL writer) — no raw inserts;
//   * access is set up through an emailed Supabase invite/recovery link that
//     lands on /set-new-password. No password is ever generated or returned.

export const SITE_URL = "https://clariva.club";
export const SETUP_REDIRECT = `${SITE_URL}/set-new-password`;

export type RowResultStatus = "invited" | "enrolled" | "linked" | "partial" | "failed" | "skipped";

export interface RowResult {
  row_index: number;
  row_id?: string;
  email: string;
  status: RowResultStatus;
  message?: string;
  user_id?: string;
  enrollment_id?: string;
  email_sent?: boolean;
}

export interface PreviewRow extends Omit<ValidatedInviteRow, "session_limit" | "assign_coach_id"> {
  programme_name: string | null;
  cohort_name: string | null;
  organization_name: string | null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function loadInviteLookups(admin: SupabaseClient): Promise<InviteLookups> {
  const [
    { data: programmes },
    { data: cohorts },
    { data: organizations },
    { data: profiles },
    { data: roles },
    { data: coachProfiles },
    { data: sponsors },
    { data: ongoing },
  ] = await Promise.all([
    admin.from("programmes").select("id, name"),
    admin.from("cohorts").select("id, name, programme_id, organization_id, start_date, end_date"),
    admin.from("organizations").select("id, name"),
    admin.from("profiles").select("id, email"),
    admin.from("user_roles").select("user_id, role"),
    admin.from("coach_profiles").select("id, approval_status"),
    admin.from("sponsor_profiles").select("organization_id"),
    admin.from("programme_enrollments").select("user_id, cohort_id").in("status", ["active", "at_risk", "paused"]),
  ]);

  const rolesByUser = new Map<string, string[]>();
  for (const r of roles ?? []) {
    const list = rolesByUser.get(r.user_id) ?? [];
    list.push(String(r.role));
    rolesByUser.set(r.user_id, list);
  }
  const existingUsersByEmail = new Map<string, { id: string; roles: string[] }>();
  for (const p of profiles ?? []) {
    if (!p.email) continue;
    existingUsersByEmail.set(normalizeEmail(p.email), { id: p.id, roles: rolesByUser.get(p.id) ?? [] });
  }
  const activeCoachIds = new Set(
    (coachProfiles ?? []).filter((c) => c.approval_status === "active").map((c) => c.id as string),
  );
  const activeCoachIdByEmail = new Map<string, string>();
  for (const [email, user] of existingUsersByEmail) {
    if (user.roles.includes("coach") && activeCoachIds.has(user.id)) activeCoachIdByEmail.set(email, user.id);
  }

  return {
    programmes: (programmes ?? []).map((p) => ({ id: p.id, name: p.name ?? "" })),
    cohorts: (cohorts ?? []).map((c) => ({
      id: c.id,
      name: c.name ?? "",
      programme_id: c.programme_id ?? null,
      organization_id: c.organization_id ?? null,
      start_date: c.start_date ?? null,
      end_date: c.end_date ?? null,
    })),
    organizations: (organizations ?? []).map((o) => ({ id: o.id, name: o.name ?? "" })),
    existingUsersByEmail,
    activeCoachIdByEmail,
    sponsoredOrganizationIds: new Set((sponsors ?? []).map((s) => s.organization_id as string)),
    ongoingEnrollmentUserIds: new Set((ongoing ?? []).map((e) => e.user_id as string)),
    ongoingEnrollmentCohortByUser: new Map(
      (ongoing ?? []).map((e) => [e.user_id as string, (e.cohort_id as string | null) ?? null]),
    ),
    today: todayIso(),
  };
}

export function toPreviewRows(rows: ValidatedInviteRow[], lookups: InviteLookups): PreviewRow[] {
  const programmeName = new Map(lookups.programmes.map((p) => [p.id, p.name]));
  const cohortName = new Map(lookups.cohorts.map((c) => [c.id, c.name]));
  const orgName = new Map(lookups.organizations.map((o) => [o.id, o.name]));
  return rows.map(({ session_limit: _s, assign_coach_id: _a, ...row }) => ({
    ...row,
    programme_name: row.programme_id ? programmeName.get(row.programme_id) ?? null : null,
    cohort_name: row.cohort_id ? cohortName.get(row.cohort_id) ?? null : null,
    organization_name: row.organization_id ? orgName.get(row.organization_id) ?? null : null,
  }));
}

function errorMessage(error: unknown): string {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  const e = error as { message?: string; details?: string };
  const raw = e.message || e.details || String(error);
  // admin_create_programme_enrollment raises a JSON payload for an ongoing enrollment.
  try {
    const payload = JSON.parse(raw) as { code?: string };
    if (payload.code === "ongoing_enrollment_exists") {
      return "This person already has an ongoing enrollment — change it from their edit sheet (it will be transitioned)";
    }
  } catch {
    /* not JSON */
  }
  return raw;
}

/** Idempotently grants the role and marks its role profile active. Never removes other roles. */
async function ensureRole(
  admin: SupabaseClient,
  userId: string,
  row: ValidatedInviteRow,
): Promise<string | null> {
  const now = new Date().toISOString();
  if (row.role === "sponsor") {
    // Profile first, then the role: trg_user_roles_sponsor_exclusive strips the
    // trigger-default coachee role/profile from non-enrolled sponsors, and never
    // touches someone who holds an enrollment.
    const { error: spErr } = await admin.from("sponsor_profiles").insert({
      user_id: userId,
      organization_id: row.organization_id,
      title: row.title,
      department: row.department,
    });
    if (spErr) return spErr.message;
    const { error: roleErr } = await admin
      .from("user_roles")
      .upsert({ user_id: userId, role: "sponsor" }, { onConflict: "user_id,role" });
    return roleErr?.message ?? null;
  }

  const { error: roleErr } = await admin
    .from("user_roles")
    .upsert({ user_id: userId, role: row.role }, { onConflict: "user_id,role" });
  if (roleErr) return roleErr.message;
  const table = row.role === "coach" ? "coach_profiles" : "coachee_profiles";
  const { data: existing } = await admin.from(table).select("id, approval_status").eq("id", userId).maybeSingle();
  if (!existing) {
    const { error } = await admin.from(table).insert({ id: userId, approval_status: "active", last_approved_at: now });
    return error?.message ?? null;
  }
  if (existing.approval_status === "pending_approval") {
    const { error } = await admin
      .from(table)
      .update({ approval_status: "active", last_approved_at: now })
      .eq("id", userId);
    return error?.message ?? null;
  }
  return null;
}

async function createEnrollment(
  admin: SupabaseClient,
  userId: string,
  row: ValidatedInviteRow,
): Promise<{ enrollment_id?: string; error?: string }> {
  if (!row.cohort_id || !row.programme_id) return {};
  const { data, error } = await admin.rpc("admin_create_programme_enrollment", {
    p_user_id: userId,
    p_programme_id: row.programme_id,
    p_cohort_id: row.cohort_id,
    p_organization_id: row.organization_id,
    p_start_date: row.enrollment_start_date ?? todayIso(),
  });
  if (error) return { error: errorMessage(error) };
  return { enrollment_id: (data as { id?: string } | null)?.id };
}

/**
 * Moves an existing person to the row's cohort through the one transition
 * path: the ongoing enrollment is closed (never deleted or rewritten) and the
 * new one is created — history stays intact.
 */
async function transitionEnrollment(
  admin: SupabaseClient,
  userId: string,
  row: ValidatedInviteRow,
): Promise<{ enrollment_id?: string; error?: string }> {
  if (!row.cohort_id || !row.programme_id) return { error: "A cohort is required to move an enrollment" };
  const { data, error } = await admin.rpc("admin_transition_enrollment", {
    p_user_id: userId,
    p_programme_id: row.programme_id,
    p_cohort_id: row.cohort_id,
    p_organization_id: row.organization_id,
    p_effective_date: todayIso(),
  });
  if (error) return { error: errorMessage(error) };
  return { enrollment_id: (data as { enrollment_id?: string } | null)?.enrollment_id };
}

async function applyLearnerExtras(admin: SupabaseClient, userId: string, row: ValidatedInviteRow, callerId: string) {
  if (row.role !== "coachee") return;
  if (row.session_limit) {
    await admin
      .from("session_limits")
      .upsert({ coachee_id: userId, monthly_limit: row.session_limit }, { onConflict: "coachee_id" });
  }
  if (row.assign_coach_id) {
    await admin.from("coachee_coach_allowlist").upsert(
      { coachee_id: userId, coach_id: row.assign_coach_id, created_by: callerId, source: "admin_added" },
      { onConflict: "coachee_id,coach_id", ignoreDuplicates: true },
    );
  }
}

/** Creates a brand-new account and emails its setup (invite) link. */
async function createAccount(
  admin: SupabaseClient,
  row: ValidatedInviteRow,
): Promise<{ user_id?: string; error?: string }> {
  const { data, error } = await admin.auth.admin.inviteUserByEmail(row.email, {
    // handle_new_user() only honours 'coach'; anything else provisions the
    // default coachee rows, which ensureRole() then corrects under admin authority.
    data: { full_name: row.full_name, role: row.role },
    redirectTo: SETUP_REDIRECT,
  });
  if (error && /already (been )?registered|already exists/i.test(error.message)) {
    // An auth account without a Clariva profile (e.g. a half-finished earlier
    // signup): repair the profile and send the setup link instead of failing.
    return adoptOrphanAuthUser(admin, row);
  }
  if (error || !data?.user) return { error: error?.message || "Failed to create the account" };
  const userId = data.user.id;
  // Admin-added: active immediately, and must choose a password on first sign-in.
  const { error: profErr } = await admin
    .from("profiles")
    .update({ full_name: row.full_name, status: "active", must_change_password: true })
    .eq("id", userId);
  if (profErr) return { user_id: userId, error: profErr.message };
  return { user_id: userId };
}

async function findAuthUserIdByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) return null;
    const hit = data.users.find((u) => normalizeEmail(u.email) === email);
    if (hit) return hit.id;
    if (data.users.length < 1000) return null;
  }
  return null;
}

async function adoptOrphanAuthUser(
  admin: SupabaseClient,
  row: ValidatedInviteRow,
): Promise<{ user_id?: string; error?: string }> {
  const userId = await findAuthUserIdByEmail(admin, row.email);
  if (!userId) return { error: "An auth account exists for this email but could not be found to repair" };
  const { error: profErr } = await admin
    .from("profiles")
    .upsert(
      { id: userId, email: row.email, full_name: row.full_name, status: "active", must_change_password: true },
      { onConflict: "id" },
    );
  if (profErr) return { user_id: userId, error: profErr.message };
  const sent = await resendSetupLink(admin, userId);
  return { user_id: userId, error: sent.email_sent ? undefined : `Setup email not sent: ${sent.error ?? "unknown error"}` };
}

/** Executes one validated row. Never throws. */
export async function executeInviteRow(
  admin: SupabaseClient,
  row: ValidatedInviteRow,
  callerId: string,
): Promise<RowResult> {
  const out: RowResult = { row_index: row.row_index, row_id: row.row_id, email: row.email, status: "skipped" };
  try {
    if (row.action === "skip") {
      return { ...out, status: "skipped", message: row.message, user_id: row.existing_user_id ?? undefined };
    }

    if (row.action === "create") {
      const created = await createAccount(admin, row);
      if (!created.user_id) return { ...out, status: "failed", message: created.error };
      const userId = created.user_id;
      const problems: string[] = [];
      if (created.error) problems.push(created.error);
      const roleErr = await ensureRole(admin, userId, row);
      if (roleErr) problems.push(`Role: ${roleErr}`);
      const enrollment = await createEnrollment(admin, userId, row);
      if (enrollment.error) problems.push(`Enrollment: ${enrollment.error}`);
      await applyLearnerExtras(admin, userId, row, callerId);
      return {
        ...out,
        status: problems.length ? "partial" : "invited",
        message: problems.length ? `Account created and setup email sent, but: ${problems.join("; ")}` : undefined,
        user_id: userId,
        enrollment_id: enrollment.enrollment_id,
        email_sent: true,
      };
    }

    const userId = row.existing_user_id!;
    if (row.action === "link_sponsor") {
      const roleErr = await ensureRole(admin, userId, row);
      if (roleErr) return { ...out, status: "failed", message: roleErr, user_id: userId };
      await activateIfPending(admin, userId);
      return { ...out, status: "linked", user_id: userId };
    }

    // enroll_only / transition
    const roleErr = await ensureRole(admin, userId, row);
    if (roleErr) return { ...out, status: "failed", message: roleErr, user_id: userId };
    const enrollment =
      row.action === "transition"
        ? await transitionEnrollment(admin, userId, row)
        : await createEnrollment(admin, userId, row);
    if (enrollment.error) return { ...out, status: "failed", message: enrollment.error, user_id: userId };
    await activateIfPending(admin, userId);
    await applyLearnerExtras(admin, userId, row, callerId);
    return { ...out, status: "enrolled", user_id: userId, enrollment_id: enrollment.enrollment_id };
  } catch (err) {
    return { ...out, status: "failed", message: err instanceof Error ? err.message : String(err) };
  }
}

/** An admin adding an existing, still-pending person activates them; other statuses are left alone. */
async function activateIfPending(admin: SupabaseClient, userId: string) {
  await admin.from("profiles").update({ status: "active" }).eq("id", userId).eq("status", "pending_approval");
}

export interface RunAdminInviteOptions {
  rows: InviteRowInput[];
  callerId: string;
  /** Validate only; nothing is written. */
  dryRun: boolean;
  /** Track the run in bulk_invite_batches/rows (bulk imports). */
  track?: boolean;
  /** Resume/retry into an existing batch. */
  batchId?: string | null;
}

export interface RunAdminInviteResult {
  batch_id: string | null;
  preview: PreviewRow[];
  results: RowResult[];
}

/** Validate (and, unless dryRun, execute) a list of rows. The one admin provisioning path. */
export async function runAdminInvite(admin: SupabaseClient, opts: RunAdminInviteOptions): Promise<RunAdminInviteResult> {
  const lookups = await loadInviteLookups(admin);
  const validated = validateInviteRows(opts.rows, lookups);
  const preview = toPreviewRows(validated, lookups);
  if (opts.dryRun) return { batch_id: null, preview, results: [] };

  let batchId = opts.batchId ?? null;
  if (opts.track) {
    if (!batchId) {
      const { data: batch, error } = await admin
        .from("bulk_invite_batches")
        .insert({ created_by: opts.callerId, total_rows: validated.length })
        .select("id")
        .single();
      if (error || !batch) throw new Error(error?.message || "Failed to create the import batch");
      batchId = batch.id;
    }
    // Track every untracked row as pending up front, so a crash mid-loop
    // leaves the rest resumable.
    for (const v of validated) {
      if (v.row_id) continue;
      const { data: inserted } = await admin
        .from("bulk_invite_rows")
        .insert({
          batch_id: batchId,
          row_index: v.row_index,
          email: v.email,
          full_name: v.full_name,
          role: v.role,
          programme_id: v.programme_id,
          cohort_id: v.cohort_id,
          organization_id: v.organization_id,
          title: v.title,
          department: v.department,
          accept_existing: v.accept_existing,
          assign_coach_id: v.assign_coach_id,
          session_limit: v.session_limit,
          status: "pending",
        })
        .select("id")
        .single();
      if (inserted) v.row_id = inserted.id;
    }
  }

  const results: RowResult[] = [];
  for (const v of validated) {
    const result = await executeInviteRow(admin, v, opts.callerId);
    results.push(result);
    if (opts.track && v.row_id) {
      await admin
        .from("bulk_invite_rows")
        .update({
          status: result.status,
          error_message: result.message ?? null,
          created_user_id: result.user_id ?? null,
          enrollment_id: result.enrollment_id ?? null,
        })
        .eq("id", v.row_id);
    }
  }
  return { batch_id: batchId, preview, results };
}

/**
 * Re-sends the account setup email. A person who never activated their invite
 * gets the invite again; anyone else gets a password-recovery link. Both land
 * on /set-new-password and go through auth-email-hook. No password is set.
 */
export async function resendSetupLink(
  admin: SupabaseClient,
  userId: string,
): Promise<{ email: string; full_name: string; email_sent: boolean; error?: string }> {
  const { data: profile } = await admin.from("profiles").select("email, full_name").eq("id", userId).maybeSingle();
  if (!profile?.email) return { email: "", full_name: "", email_sent: false, error: "Person not found" };
  const { data: authUser } = await admin.auth.admin.getUserById(userId);
  const neverActivated = !authUser?.user?.email_confirmed_at && !authUser?.user?.last_sign_in_at;

  if (neverActivated) {
    const { error } = await admin.auth.admin.inviteUserByEmail(profile.email, {
      data: { full_name: profile.full_name },
      redirectTo: SETUP_REDIRECT,
    });
    if (!error) {
      await admin.from("profiles").update({ must_change_password: true }).eq("id", userId);
      return { email: profile.email, full_name: profile.full_name, email_sent: true };
    }
  }
  const { error } = await admin.auth.resetPasswordForEmail(profile.email, { redirectTo: SETUP_REDIRECT });
  return {
    email: profile.email,
    full_name: profile.full_name,
    email_sent: !error,
    error: error?.message,
  };
}
