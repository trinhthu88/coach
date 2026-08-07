import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_coaches",
  title: "List coaches",
  description: "List all active coaches in the directory.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).default(50).describe("Maximum number of coaches to return"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    const userId = ctx.getUserId();
    if (!userId) throw new ToolError("Not authenticated" );

    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("profiles")
      .select(`
        id, full_name, email, avatar_url, status,
        coach_profiles(title, specialties, years_experience, rating_avg, sessions_completed, country_based, approval_status)
      `)
      .eq("coach_profiles.approval_status", "active")
      .order("full_name")
      .limit(limit);

    if (error) throw new ToolError(error.message );
    return { content: [{ type: "text", text: JSON.stringify(data ?? []) }] };
  },
});
