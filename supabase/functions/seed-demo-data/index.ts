import { buildCorsHeaders } from "../_shared/cors.ts";

// Deliberately retained as a discoverable compatibility endpoint. Seeding is
// local-reset-only and must run from supabase/seed.sql in one transaction.
Deno.serve(async (req) => {
  const headers = buildCorsHeaders(req, {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  });
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  return new Response(JSON.stringify({
    error: "Demo seeding is disabled through the API (410).",
    instructions: "Run `supabase db reset` locally; it applies supabase/seed.sql after migrations.",
  }), { status: 410, headers: { ...headers, "Content-Type": "application/json" } });
});