import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";
import {
  getGoogleBusyIntervals,
  makeAdminClient,
  requestUser,
  validBusyWindow,
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
    const body = await req.json().catch(() => ({}));
    const { coach_id, time_min, time_max } = body as {
      coach_id?: unknown;
      time_min?: unknown;
      time_max?: unknown;
    };
    if (
      typeof coach_id !== "string" ||
      typeof time_min !== "string" ||
      typeof time_max !== "string" ||
      !validBusyWindow(time_min, time_max)
    ) {
      return new Response(JSON.stringify({ error: "A coach and valid time window are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Respect the same coach-profile visibility rules used by the booking
    // screens; the function must not become a way to inspect arbitrary users'
    // private calendars.
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const authorization = req.headers.get("Authorization");
    if (!supabaseUrl || !anonKey || !authorization) throw new Error("Supabase client is not configured");
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: visibleCoach, error: visibilityError } = await callerClient
      .from("coach_profiles")
      .select("id")
      .eq("id", coach_id)
      .maybeSingle();
    if (visibilityError || !visibleCoach) {
      return new Response(JSON.stringify({ error: "Coach is not available to this account" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await getGoogleBusyIntervals(makeAdminClient(), coach_id, time_min, time_max);
    // Learners need only busy intervals; connection status stays private to the
    // coach-facing status endpoint.
    return new Response(JSON.stringify({ busy: result.busy }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Google Calendar availability lookup failed", error instanceof Error ? error.message : "unknown error");
    return new Response(JSON.stringify({ error: "Could not check coach calendar availability" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
