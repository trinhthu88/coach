import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";

// Sponsors are admin-assigned, not self-service — there is no access_requests
// row for them to approve. This mirrors approve-access-request's account
// creation/temp-password pattern but provisions directly from an
// organization_id the admin picked, rather than from a submitted request.

function generatePassword(): string {
  const lowers = "abcdefghijkmnpqrstuvwxyz";
  const uppers = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$%&*";
  const all = lowers + uppers + digits + symbols;
  const buf = new Uint8Array(14);
  crypto.getRandomValues(buf);
  const pick = (set: string, byte: number) => set[byte % set.length];
  const chars = [
    pick(lowers, buf[0]),
    pick(uppers, buf[1]),
    pick(digits, buf[2]),
    pick(symbols, buf[3]),
    ...Array.from(buf.slice(4)).map((b) => pick(all, b)),
  ];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

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

    const claims = decodeJwtPayload(token);
    const callerId = typeof claims?.sub === "string" ? claims.sub : null;
    if (!callerId) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", callerId);
    const isAdmin = (roleRows ?? []).some((r: { role: string }) => r.role === "admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const {
      organization_id,
      email,
      full_name,
      title,
      department,
      force_reset_password,
    } = body as {
      organization_id?: string;
      email?: string;
      full_name?: string;
      title?: string;
      department?: string;
      force_reset_password?: boolean;
    };

    if (!organization_id) {
      return new Response(JSON.stringify({ error: "organization_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .select("id, name")
      .eq("id", organization_id)
      .maybeSingle();
    if (orgErr || !org) {
      return new Response(JSON.stringify({ error: "Organization not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existingSponsor } = await admin
      .from("sponsor_profiles")
      .select("user_id")
      .eq("organization_id", organization_id)
      .maybeSingle();

    let userId: string;
    let resolvedEmail: string;
    let resolvedFullName: string;
    const tempPassword = generatePassword();

    if (existingSponsor) {
      // Reset flow: this org already has a sponsor. Only regenerate their
      // password — never repoint sponsor_profiles to a different account,
      // and ignore any email/full_name/title/department in the request body.
      if (!force_reset_password) {
        return new Response(
          JSON.stringify({ error: "This organization already has a sponsor. Use the reset-password action instead." }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      userId = existingSponsor.user_id;
      const { data: prof } = await admin.from("profiles").select("email, full_name").eq("id", userId).maybeSingle();
      resolvedEmail = prof?.email ?? "";
      resolvedFullName = prof?.full_name ?? "";

      const { error: pwErr } = await admin.auth.admin.updateUserById(userId, { password: tempPassword });
      if (pwErr) {
        return new Response(JSON.stringify({ error: pwErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      if (!email || !full_name) {
        return new Response(JSON.stringify({ error: "email and full_name required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      resolvedEmail = email;
      resolvedFullName = full_name;

      const { data: existingProfile } = await admin
        .from("profiles")
        .select("id")
        .ilike("email", email)
        .maybeSingle();

      if (existingProfile?.id) {
        userId = existingProfile.id;
        const { error: updateUserErr } = await admin.auth.admin.updateUserById(userId, {
          password: tempPassword,
          email_confirm: true,
          user_metadata: { full_name, role: "sponsor" },
        });
        if (updateUserErr) {
          return new Response(JSON.stringify({ error: updateUserErr.message || "Failed to update existing user" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
          // handle_new_user() only recognizes 'coach'; anything else defaults to
          // 'coachee'. That's intentional — the public signup path must never be
          // able to grant itself 'sponsor' just by passing role metadata. This
          // function fixes the role up explicitly below, under admin authority,
          // after the trigger has run.
          user_metadata: { full_name, role: "sponsor" },
        });
        if (createErr || !created.user) {
          return new Response(JSON.stringify({ error: createErr?.message || "Failed to create user" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        userId = created.user.id;
      }

      // Undo handle_new_user()'s default coachee provisioning, then set up sponsor.
      await admin.from("user_roles").delete().eq("user_id", userId).eq("role", "coachee");
      await admin.from("coachee_profiles").delete().eq("id", userId);
      await admin.from("user_roles").upsert({ user_id: userId, role: "sponsor" }, { onConflict: "user_id,role" });
      const { error: spErr } = await admin.from("sponsor_profiles").insert({
        user_id: userId,
        organization_id,
        title: title || null,
        department: department || null,
      });
      if (spErr) {
        return new Response(JSON.stringify({ error: spErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    await admin.from("profiles").update({ status: "active", must_change_password: true }).eq("id", userId);

    return new Response(
      JSON.stringify({ ok: true, user_id: userId, email: resolvedEmail, full_name: resolvedFullName, temp_password: tempPassword }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
