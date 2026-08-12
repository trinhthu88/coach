import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/send-email.ts";
import { AccessApprovedEmail } from "../_shared/email-templates/access-approved.tsx";

const SITE_URL = "https://clariva.club";

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // This function is configured with verify_jwt = true, so a request that reaches
    // this code already has a valid session. Decode the verified token to get the caller id.
    const claims = decodeJwtPayload(token);
    const callerId = typeof claims?.sub === "string" ? claims.sub : null;
    if (!callerId) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleRows } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    const isAdmin = (roleRows ?? []).some((r: { role: string }) => r.role === "admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { request_id, resend_magic_link } = body as { request_id?: string; resend_magic_link?: boolean };
    if (!request_id) {
      return new Response(JSON.stringify({ error: "request_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: reqRow, error: reqErr } = await admin
      .from("access_requests")
      .select("*")
      .eq("id", request_id)
      .maybeSingle();
    if (reqErr || !reqRow) {
      return new Response(JSON.stringify({ error: "Request not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (reqRow.status === "approved" && !resend_magic_link) {
      return new Response(JSON.stringify({ error: "Already approved" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const role = reqRow.role === "coach" ? "coach" : "coachee";

    let userId: string | null = null;

    // Reuse an existing auth account if a previous attempt already created it.
    const { data: existingProfile } = await admin
      .from("profiles")
      .select("id")
      .ilike("email", reqRow.email)
      .maybeSingle();

    if (existingProfile?.id) {
      userId = existingProfile.id;
      const { error: updateUserErr } = await admin.auth.admin.updateUserById(userId, {
        email_confirm: true,
        user_metadata: {
          full_name: reqRow.full_name,
          role,
        },
      });

      if (updateUserErr) {
        return new Response(
          JSON.stringify({ error: updateUserErr.message || "Failed to update existing user" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      // No password is set here — access is passwordless via the magic link
      // emailed below. The user can set a real password afterwards (enforced
      // by must_change_password below, which routes them to /set-new-password).
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: reqRow.email,
        email_confirm: true,
        user_metadata: {
          full_name: reqRow.full_name,
          role,
        },
      });

      if (createErr || !created.user) {
        return new Response(
          JSON.stringify({ error: createErr?.message || "Failed to create user" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      userId = created.user.id;
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "Could not resolve user account" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The handle_new_user trigger created profile + role + role-specific profile
    // already with status = pending_approval. Promote to active and mark must_change_password.
    await admin
      .from("profiles")
      .update({ status: "active", must_change_password: true })
      .eq("id", userId);

    if (role === "coach") {
      await admin
        .from("coach_profiles")
        .update({ approval_status: "active", last_approved_at: new Date().toISOString() })
        .eq("id", userId);
    } else {
      await admin
        .from("coachee_profiles")
        .update({ approval_status: "active", last_approved_at: new Date().toISOString() })
        .eq("id", userId);
    }

    await admin
      .from("access_requests")
      .update({
        status: "approved",
        reviewed_at: new Date().toISOString(),
        reviewed_by: callerId,
      })
      .eq("id", request_id);

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: reqRow.email,
      options: { redirectTo: `${SITE_URL}/dashboard` },
    });

    let emailSent = false;
    if (linkErr || !linkData?.properties?.action_link) {
      console.error("Failed to generate magic link", { error: linkErr, email: reqRow.email });
    } else {
      const html = await renderAsync(
        React.createElement(AccessApprovedEmail, {
          fullName: reqRow.full_name,
          confirmationUrl: linkData.properties.action_link,
        })
      );
      const text = await renderAsync(
        React.createElement(AccessApprovedEmail, {
          fullName: reqRow.full_name,
          confirmationUrl: linkData.properties.action_link,
        }),
        { plainText: true }
      );
      const result = await sendEmail({
        to: reqRow.email,
        subject: "You're approved — log in to Clariva",
        html,
        text,
      });
      if (!result.ok) {
        console.error("Failed to send access-approved email", { error: result.error, email: reqRow.email });
      }
      emailSent = result.ok;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        user_id: userId,
        email: reqRow.email,
        role,
        email_sent: emailSent,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
