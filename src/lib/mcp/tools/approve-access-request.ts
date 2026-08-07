import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getUserRole, generatePassword } from "../utils";
import { supabaseAdmin } from "../supabase";

export default defineTool({
  name: "approve_access_request",
  title: "Approve access request",
  description: "Approve a pending access request, create the user account, and return a one-time temporary password.",
  inputSchema: {
    request_id: z.string().uuid().describe("UUID of the pending access request"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ request_id }, ctx) => {
    const callerId = ctx.getUserId();
    if (!callerId) throw new ToolError("Not authenticated" );
    const role = await getUserRole(callerId);
    if (role !== "admin") throw new ToolError("Admin access required" );

    const admin = supabaseAdmin();
    const { data: reqRow, error: reqErr } = await admin
      .from("access_requests")
      .select("*")
      .eq("id", request_id)
      .maybeSingle();
    if (reqErr || !reqRow) throw new ToolError(reqErr?.message ?? "Request not found" );
    if (reqRow.status === "approved") throw new ToolError("Request already approved" );

    const userRole = reqRow.role === "coach" ? "coach" : "coachee";
    const tempPassword = generatePassword();
    let userId: string | null = null;

    const { data: existingProfile } = await admin
      .from("profiles")
      .select("id")
      .ilike("email", reqRow.email)
      .maybeSingle();

    if (existingProfile?.id) {
      userId = existingProfile.id;
      const { error: updateUserErr } = await admin.auth.admin.updateUserById(userId, {
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: reqRow.full_name, role: userRole },
      });
      if (updateUserErr) throw new ToolError(updateUserErr.message ?? "Failed to update existing user" );
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: reqRow.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: reqRow.full_name, role: userRole },
      });
      if (createErr || !created.user) throw new ToolError(createErr?.message ?? "Failed to create user" );
      userId = created.user.id;
    }

    if (!userId) throw new ToolError("Could not resolve user account" );

    await admin.from("profiles").update({ status: "active", must_change_password: true }).eq("id", userId);
    if (userRole === "coach") {
      await admin.from("coach_profiles").update({ approval_status: "active", last_approved_at: new Date().toISOString() }).eq("id", userId);
    } else {
      await admin.from("coachee_profiles").update({ approval_status: "active", last_approved_at: new Date().toISOString() }).eq("id", userId);
    }
    await admin.from("access_requests").update({ status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: callerId }).eq("id", request_id);

    return {
      content: [{ type: "text", text: `Approved. Email: ${reqRow.email}\nTemporary password: ${tempPassword}\nRole: ${userRole}` }],
      structuredContent: { email: reqRow.email, temp_password: tempPassword, role: userRole, user_id: userId },
    };
  },
});
