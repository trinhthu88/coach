import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_coach_profile",
  title: "Get coach profile",
  description: "Get the full profile for a coach.",
  inputSchema: {
    coach_id: z.string().uuid().describe("UUID of the coach"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ coach_id }, ctx) => {
    const userId = ctx.getUserId();
    if (!userId) throw new ToolError("Not authenticated" );

    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("profiles")
      .select(`
        id, full_name, email, bio, avatar_url, status, created_at,
        coach_profiles(title, specialties, diplomas_certifications, years_experience, rating_avg, sessions_completed, country_based, nationality, calendly_url, peer_coaching_opt_in)
      `)
      .eq("id", coach_id)
      .maybeSingle();

    if (error) throw new ToolError(error.message );
    if (!data) throw new ToolError("Coach not found or access denied" );
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
});
