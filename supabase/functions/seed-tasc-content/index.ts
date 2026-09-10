// Retired: all demo data is local-reset-only in supabase/seed.sql.
import { buildCorsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const headers = buildCorsHeaders(req, {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  });
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  return new Response(JSON.stringify({
    error: "TASC demo seeding is disabled (410).",
    instructions: "Run PGOPTIONS='-c app.seed_environment=local' supabase db reset locally; demo data is in supabase/seed.sql.",
  }), { status: 410, headers: { ...headers, "Content-Type": "application/json" } });
});