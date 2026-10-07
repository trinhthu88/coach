import { buildCorsHeaders } from "../_shared/cors.ts";
import {
  hashOAuthState,
  makeAdminClient,
} from "../_shared/googleCalendar.ts";

function redirectToApp(
  origin: string,
  result: "complete" | "error" | "denied",
  values: { code?: string; state?: string } = {},
): Response {
  const target = new URL("/coach/availability", origin);
  target.searchParams.set("calendar", result);
  if (values.code) target.searchParams.set("code", values.code);
  if (values.state) target.searchParams.set("state", values.state);
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
    const { data: stateRow, error: stateError } = await admin
      .from("google_calendar_oauth_states")
      .select("coach_id, return_origin, code_verifier")
      .eq("state_hash", stateHash)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (stateError || !stateRow || !stateRow.code_verifier) {
      return new Response("This Google Calendar authorization has expired. Return to Clariva and try again.", {
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const returnOrigin = stateRow.return_origin as string;
    const providerError = requestUrl.searchParams.get("error");
    if (providerError) {
      await admin.from("google_calendar_oauth_states").delete().eq("state_hash", stateHash);
      return redirectToApp(returnOrigin, providerError === "access_denied" ? "denied" : "error");
    }
    const code = requestUrl.searchParams.get("code");
    if (!code) {
      await admin.from("google_calendar_oauth_states").delete().eq("state_hash", stateHash);
      return redirectToApp(returnOrigin, "error");
    }

    // The browser completes the code exchange with its authenticated Clariva
    // session. This public OAuth redirect handler never receives or stores a
    // Google token.
    return redirectToApp(returnOrigin, "complete", { code, state });
  } catch (error) {
    console.error("Google Calendar OAuth callback failed", error instanceof Error ? error.message : "unknown error");
    // The origin is only trusted after looking up a live, single-use state row.
    return new Response("Google Calendar authorization could not be completed.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
});
