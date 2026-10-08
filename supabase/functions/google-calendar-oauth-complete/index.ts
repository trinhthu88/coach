import { buildCorsHeaders } from "../_shared/cors.ts";
import {
  canCompleteGoogleCalendarOAuth,
  hashOAuthState,
} from "../_shared/googleCalendarOAuth.ts";
import {
  encryptRefreshToken,
  googleCalendarRedirectUri,
  invalidateGoogleCalendarAccessToken,
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

  const respond = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const user = await requestUser(req);
    if (!user) return respond({ error: "Authentication required" }, 401);
    const admin = makeAdminClient();
    if (!(await userHasCoachRole(admin, user.id))) {
      return respond({ error: "Coach access required" }, 403);
    }
    if (!isGoogleCalendarConfigured()) {
      return respond({ error: "Google Calendar is not configured" }, 503);
    }

    const body = await req.json().catch(() => ({}));
    const { code, state } = body as { code?: unknown; state?: unknown };
    if (
      typeof code !== "string" || code.length < 1 || code.length > 4096 ||
      typeof state !== "string" || state.length < 43 || state.length > 128
    ) {
      return respond({ error: "A valid Google authorization code and state are required" }, 400);
    }

    const stateHash = await hashOAuthState(state);
    const { data: stateRow, error: stateError } = await admin
      .from("google_calendar_oauth_states")
      .select("coach_id, code_verifier, expires_at")
      .eq("state_hash", stateHash)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (stateError || !stateRow) return respond({ error: "Google authorization state expired; try again" }, 400);
    if (!canCompleteGoogleCalendarOAuth({
      coachId: stateRow.coach_id,
      userId: user.id,
      codeVerifier: stateRow.code_verifier,
      expiresAt: stateRow.expires_at,
    })) {
      return respond({ error: "This Google authorization was started by a different coach" }, 403);
    }

    // Consume the state before exchanging the code. The conditional delete
    // makes concurrent/replayed completion requests single-use.
    const { data: consumed, error: consumeError } = await admin
      .from("google_calendar_oauth_states")
      .delete()
      .eq("state_hash", stateHash)
      .eq("coach_id", user.id)
      .gt("expires_at", new Date().toISOString())
      .select("code_verifier")
      .maybeSingle();
    if (consumeError || !consumed?.code_verifier) {
      return respond({ error: "This Google authorization was already used; try again" }, 409);
    }

    const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET")!;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: googleCalendarRedirectUri(),
        grant_type: "authorization_code",
        code_verifier: consumed.code_verifier,
      }),
    });
    if (!tokenResponse.ok) {
      console.error("Google Calendar authorization-code exchange failed", tokenResponse.status);
      return respond({ error: "Google authorization could not be completed; reconnect and try again" }, 502);
    }
    const tokenResult = await tokenResponse.json();
    if (typeof tokenResult.access_token !== "string") {
      return respond({ error: "Google did not return an access token" }, 502);
    }

    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenResult.access_token}` },
    });
    if (!userInfoResponse.ok) return respond({ error: "Could not verify the Google account" }, 502);
    const userInfo = await userInfoResponse.json();
    if (typeof userInfo.email !== "string" || !userInfo.email_verified) {
      return respond({ error: "Google did not verify the account email" }, 400);
    }

    let refreshToken = typeof tokenResult.refresh_token === "string"
      ? tokenResult.refresh_token as string
      : null;
    if (!refreshToken) {
      const { data: existing, error: existingError } = await admin
        .from("google_calendar_connections")
        .select("refresh_token_ciphertext, needs_reconnect")
        .eq("coach_id", user.id)
        .maybeSingle();
      if (
        existingError || !existing?.refresh_token_ciphertext || existing.needs_reconnect
      ) {
        return respond({ error: "Google did not provide a refresh token; reconnect with account access enabled" }, 400);
      }
      // The existing refresh token is already encrypted at rest. Preserve the
      // ciphertext instead of decrypting and re-encrypting it.
      refreshToken = null;
      const { error: saveError } = await admin.from("google_calendar_connections").upsert({
        coach_id: user.id,
        google_email: userInfo.email,
        refresh_token_ciphertext: existing.refresh_token_ciphertext,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        consecutive_error_count: 0,
        needs_reconnect: false,
      });
      if (saveError) return respond({ error: "Could not save the Google Calendar connection" }, 500);
    } else {
      const encryptedRefreshToken = await encryptRefreshToken(refreshToken);
      const { error: saveError } = await admin.from("google_calendar_connections").upsert({
        coach_id: user.id,
        google_email: userInfo.email,
        refresh_token_ciphertext: encryptedRefreshToken,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        consecutive_error_count: 0,
        needs_reconnect: false,
      });
      if (saveError) return respond({ error: "Could not save the Google Calendar connection" }, 500);
    }

    invalidateGoogleCalendarAccessToken(user.id);
    return respond({ ok: true, google_email: userInfo.email });
  } catch (error) {
    console.error("Google Calendar OAuth completion failed", error instanceof Error ? error.message : "unknown error");
    return respond({ error: "Google Calendar authorization could not be completed" }, 500);
  }
});
