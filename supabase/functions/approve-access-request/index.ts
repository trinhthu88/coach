import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function generatePassword(): string {
  // 14-char password: lowercase + uppercase + digits + symbols
  const lowers = "abcdefghijkmnpqrstuvwxyz";
  const uppers = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$%&*";
  const all = lowers + uppers + digits + symbols;
  const buf = new Uint8Array(14);
  crypto.getRandomValues(buf);
  const pick = (set: string, byte: number) => set[byte % set.length];
  // Force one of each class for the first 4 chars, then random for rest
  const chars = [
    pick(lowers, buf[0]),
    pick(uppers, buf[1]),
    pick(digits, buf[2]),
    pick(symbols, buf[3]),
    ...Array.from(buf.slice(4)).map((b) => pick(all, b)),
  ];
  // Shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller via JWT claims (works with signing-keys system)
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callerId = claimsData.claims.sub as string;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roleRows } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    const isAdmin = (roleRows ?? []).some((r: any) => r.role === "admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { request_id } = body as { request_id?: string };
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
    if (reqRow.status === "approved") {
      return new Response(JSON.stringify({ error: "Already approved" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const role = reqRow.role === "coach" ? "coach" : "coachee";
    const tempPassword = generatePassword();

    // Create the auth user (auto-confirm so they can sign in immediately)
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: reqRow.email,
      password: tempPassword,
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

    const userId = created.user.id;

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
        reviewed_by: userData.user.id,
      })
      .eq("id", request_id);

    return new Response(
      JSON.stringify({
        ok: true,
        user_id: userId,
        email: reqRow.email,
        temp_password: tempPassword,
        role,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message ?? String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
