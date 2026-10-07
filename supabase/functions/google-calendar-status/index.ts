import { buildCorsHeaders } from "../_shared/cors.ts";
import {
  getCalendarConnectionStatus,
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
    const status = await getCalendarConnectionStatus(admin, user.id);
    return new Response(JSON.stringify(status), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Google Calendar status failed", error instanceof Error ? error.message : "unknown error");
    return new Response(JSON.stringify({ error: "Could not load Google Calendar connection" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
