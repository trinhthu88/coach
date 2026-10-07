import { buildCorsHeaders } from "../_shared/cors.ts";
import {
  decryptRefreshToken,
  encryptRefreshToken,
  googleCalendarRedirectUri,
  hashOAuthState,
  invalidateGoogleCalendarAccessToken,
  makeAdminClient,
} from "../_shared/googleCalendar.ts";

function redirectToApp(origin: string, result: "connected" | "error" | "denied"): Response {
  const target = new URL("/coach/availability", origin);
  target.searchParams.set("calendar", result);
  return Response.redirect(target.toString(), 302);
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const requestUrl = new URL(req.url);
  const state = requestUrl.searchParams.get("state");
  if (!state) return new Response("Google Calendar authorization could not be completed.", { status: 400 });

  try {
    const admin = makeAdminClient();
    const stateHash = await hashOAuthState(state);
    // Delete-and-return makes the short-lived OAuth state single-use.
    const { data: stateRow, error: stateError } = await admin
      .from("google_calendar_oauth_states")
      .delete()
      .eq("state_hash", stateHash)
      .gt("expires_at", new Date().toISOString())
      .select("coach_id, return_origin")
      .maybeSingle();
    if (stateError || !stateRow) {
      return new Response("This Google Calendar authorization has expired. Return to Clariva and try again.", {
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const returnOrigin = stateRow.return_origin as string;
    const providerError = requestUrl.searchParams.get("error");
    if (providerError === "access_denied") return redirectToApp(returnOrigin, "denied");
    const code = requestUrl.searchParams.get("code");
    if (!code || providerError) return redirectToApp(returnOrigin, "error");

    const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");
    if (!clientId || !clientSecret || !Deno.env.get("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY")) {
      return redirectToApp(returnOrigin, "error");
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: googleCalendarRedirectUri(),
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResponse.ok) return redirectToApp(returnOrigin, "error");
    const tokenResult = await tokenResponse.json();
    if (typeof tokenResult.access_token !== "string") return redirectToApp(returnOrigin, "error");

    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenResult.access_token}` },
    });
    if (!userInfoResponse.ok) return redirectToApp(returnOrigin, "error");
    const userInfo = await userInfoResponse.json();
    if (typeof userInfo.email !== "string" || !userInfo.email_verified) {
      return redirectToApp(returnOrigin, "error");
    }

    let refreshToken = tokenResult.refresh_token as string | undefined;
    if (!refreshToken) {
      // Google may omit a refresh token when the coach has already granted
      // access. Preserve the existing encrypted one during reconnection.
      const { data: existing, error: existingError } = await admin
        .from("google_calendar_connections")
        .select("refresh_token_ciphertext")
        .eq("coach_id", stateRow.coach_id)
        .maybeSingle();
      if (existingError || !existing?.refresh_token_ciphertext) {
        return redirectToApp(returnOrigin, "error");
      }
      refreshToken = await decryptRefreshToken(existing.refresh_token_ciphertext as string);
    }

    const encryptedRefreshToken = await encryptRefreshToken(refreshToken);
    const { error: saveError } = await admin.from("google_calendar_connections").upsert({
      coach_id: stateRow.coach_id,
      google_email: userInfo.email,
      refresh_token_ciphertext: encryptedRefreshToken,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (saveError) return redirectToApp(returnOrigin, "error");
    invalidateGoogleCalendarAccessToken(stateRow.coach_id as string);
    return redirectToApp(returnOrigin, "connected");
  } catch (error) {
    console.error("Google Calendar OAuth callback failed", error instanceof Error ? error.message : "unknown error");
    // The origin is only trusted after looking up a live, single-use state row.
    return new Response("Google Calendar authorization could not be completed.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
});
