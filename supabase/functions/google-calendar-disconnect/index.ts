import { buildCorsHeaders } from "../_shared/cors.ts";
import {
  decryptRefreshToken,
  makeAdminClient,
  requestUser,
  userHasCoachRole,
} from "../_shared/googleCalendar.ts";

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const user = await requestUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = makeAdminClient();
    if (!(await userHasCoachRole(admin, user.id))) {
      return new Response(JSON.stringify({ error: "Coach access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: connection, error: readError } = await admin
      .from("google_calendar_connections")
      .select("refresh_token_ciphertext")
      .eq("coach_id", user.id)
      .maybeSingle();
    if (readError) throw new Error("Could not load Google Calendar connection");

    if (connection?.refresh_token_ciphertext && Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID") &&
        Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET") && Deno.env.get("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY")) {
      try {
        const token = await decryptRefreshToken(connection.refresh_token_ciphertext as string);
        await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
        });
      } catch {
        // Local credentials are still removed below if Google has already
        // revoked the grant or its token endpoint is temporarily unavailable.
      }
    }

    const { error: deleteError } = await admin
      .from("google_calendar_connections")
      .delete()
      .eq("coach_id", user.id);
    if (deleteError) throw new Error("Could not remove Google Calendar connection");

    return new Response(JSON.stringify({ disconnected: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Google Calendar disconnect failed", error instanceof Error ? error.message : "unknown error");
    return new Response(JSON.stringify({ error: "Could not disconnect Google Calendar" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
