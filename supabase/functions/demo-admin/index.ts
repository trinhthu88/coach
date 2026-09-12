import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";
import {
  DEMO_ACCOUNTS,
  DEMO_FIXTURE_VERSION,
  DEMO_LEADER_COUNT,
  DEMO_ORGANIZATION_NAME,
  DEMO_ORGANIZATION_SLUG,
  DEMO_PROGRAMMES,
} from "./manifest.ts";

type Action = "status" | "reset" | "manifest";

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function isUuid(value: string | undefined): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, corsHeaders);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const fixedOrganizationId = Deno.env.get("DEMO_ORGANIZATION_ID");
    if (!supabaseUrl || !serviceKey || !isUuid(fixedOrganizationId)) {
      return json({ error: "Live demo is not configured for this deployment" }, 503, corsHeaders);
    }

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    const admin = createClient(supabaseUrl, serviceKey);
    if (!token) return json({ error: "Missing or invalid session" }, 401, corsHeaders);
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) return json({ error: "Missing or invalid session" }, 401, corsHeaders);
    const callerId = user.id;

    const { data: roleRows, error: roleError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    if (roleError) throw roleError;
    if (!(roleRows ?? []).some((row: { role: string }) => row.role === "admin")) {
      return json({ error: "Forbidden" }, 403, corsHeaders);
    }

    const body = await req.json().catch(() => ({})) as {
      action?: Action;
      organization_id?: string;
    };
    const action = body.action ?? "status";

    if (action === "manifest") {
      return json({
        fixture_version: DEMO_FIXTURE_VERSION,
        organization_name: DEMO_ORGANIZATION_NAME,
        organization_slug: DEMO_ORGANIZATION_SLUG,
        leader_count: DEMO_LEADER_COUNT,
        account_count: DEMO_ACCOUNTS.length,
        programmes: DEMO_PROGRAMMES,
      }, 200, corsHeaders);
    }

    if (action === "status") {
      // Status may inspect a card selected by the admin, but only the fixed
      // deployment target can ever return demo data.
      if (body.organization_id !== fixedOrganizationId) {
        return json({ configured: true, is_demo: false }, 200, corsHeaders);
      }
      const { data: rows, error } = await admin.rpc("get_demo_organization_status", {
        p_organization_id: fixedOrganizationId,
      });
      if (error) throw error;
      const status = Array.isArray(rows) ? rows[0] : rows;
      if (!status) return json({ configured: true, is_demo: false }, 200, corsHeaders);
      return json({
        configured: true,
        is_demo: true,
        ...status,
      }, 200, corsHeaders);
    }

    if (action === "reset") {
      // The reset executor is intentionally a separate server-side deployment
      // step. Never turn a missing executor into a partial client-side reset.
      const { data: rows, error: statusError } = await admin.rpc("get_demo_organization_status", {
        p_organization_id: fixedOrganizationId,
      });
      if (statusError) throw statusError;
      const status = Array.isArray(rows) ? rows[0] : rows;
      if (!status) return json({ error: "The fixed demo organization is not registered" }, 409, corsHeaders);
      if (status.state !== "ready") {
        return json({ error: `Demo reset is unavailable while the registry is ${status.state}` }, 409, corsHeaders);
      }
      return json({
        error: "The demo reset executor is not enabled in this deployment",
        operation: "reset",
        organization_id: fixedOrganizationId,
      }, 501, corsHeaders);
    }

    return json({ error: "Unsupported demo action" }, 400, corsHeaders);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500, corsHeaders);
  }
});