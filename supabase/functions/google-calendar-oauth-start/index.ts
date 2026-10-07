import { buildCorsHeaders } from "../_shared/cors.ts";
import {
  createOAuthState,
  googleCalendarRedirectUri,
  hashOAuthState,
  isAllowedCalendarReturnOrigin,
  isGoogleCalendarConfigured,
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
    if (!isGoogleCalendarConfigured()) {
      return new Response(JSON.stringify({ error: "Google Calendar is not configured" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const origin = req.headers.get("Origin") ?? "";
    if (!isAllowedCalendarReturnOrigin(origin)) {
      return new Response(JSON.stringify({ error: "This app origin is not allowed for Google Calendar" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const state = createOAuthState();
    const stateHash = await hashOAuthState(state);
    const { error: stateError } = await admin.from("google_calendar_oauth_states").insert({
      state_hash: stateHash,
      coach_id: user.id,
      return_origin: origin,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    if (stateError) throw new Error("Could not start Google Calendar authorization");

    const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID")!;
    const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizeUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: googleCalendarRedirectUri(),
      response_type: "code",
      scope: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/calendar.freebusy",
        "https://www.googleapis.com/auth/calendar.events.owned",
      ].join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    }).toString();

    return new Response(JSON.stringify({ authorization_url: authorizeUrl.toString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Google Calendar OAuth start failed", error instanceof Error ? error.message : "unknown error");
    return new Response(JSON.stringify({ error: "Could not start Google Calendar authorization" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
