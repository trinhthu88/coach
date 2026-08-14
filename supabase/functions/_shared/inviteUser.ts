import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Core account-creation mechanics shared by every "invite a new user" edge function
// (coach-invite-coachee, admin-bulk-invite-users). Callers own their own
// authorization and any rate/cap checks — this only does the account creation +
// optional coach assignment, nothing else.

export interface InviteUserParams {
  email: string;
  full_name: string;
  role: "coach" | "coachee";
  /** Only applied when role === 'coachee'. Inserts one coachee_coach_allowlist row. */
  assignCoachId?: string;
  /** Whoever is performing this invite — recorded as coachee_coach_allowlist.created_by. */
  callerId: string;
  /** Origin used to build the invite email's redirectTo (…/set-new-password). */
  siteUrl: string;
}

export type InviteUserResult =
  | { status: "invited"; created_user_id: string }
  | { status: "already_exists"; existing_user_id: string }
  | { status: "failed"; error_message: string };

/** Looks up whether a profiles row already exists for this email (case-insensitive). */
export async function findExistingProfileByEmail(
  admin: SupabaseClient,
  email: string
): Promise<{ id: string } | null> {
  const { data } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
  return data ?? null;
}

export async function inviteUser(admin: SupabaseClient, params: InviteUserParams): Promise<InviteUserResult> {
  const existing = await findExistingProfileByEmail(admin, params.email);
  if (existing?.id) {
    return { status: "already_exists", existing_user_id: existing.id };
  }

  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(params.email, {
    data: { full_name: params.full_name, role: params.role },
    redirectTo: `${params.siteUrl}/set-new-password`,
  });
  if (inviteErr || !invited.user) {
    return { status: "failed", error_message: inviteErr?.message || "Failed to invite user" };
  }
  const userId = invited.user.id;

  // handle_new_user() already created profiles/user_roles/(coach|coachee)_profiles rows
  // (status = pending_approval) via the auth.users insert trigger.
  await admin.from("profiles").update({ must_change_password: true }).eq("id", userId);

  if (params.assignCoachId && params.role === "coachee") {
    const { error: allowErr } = await admin.from("coachee_coach_allowlist").insert({
      coachee_id: userId,
      coach_id: params.assignCoachId,
      created_by: params.callerId,
    });
    if (allowErr) {
      return { status: "failed", error_message: `Invited but failed to assign coach: ${allowErr.message}` };
    }
  }

  return { status: "invited", created_user_id: userId };
}
