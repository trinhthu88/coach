import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getUserRole } from "../utils";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_coachee_profile",
  title: "Get coachee profile",
  description: "Get the full profile for a coachee, including programme enrollment and limits.",
  inputSchema: {
    coachee_id: z.string().uuid().describe("UUID of the coachee"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ coachee_id }, ctx) => {
    const userId = ctx.getUserId();
    if (!userId) throw new ToolError({ message: "Not authenticated" });
    const role = await getUserRole(userId);
    if (!role) throw new ToolError({ message: "Role not found" });

    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("profiles")
      .select(`
        id, full_name, email, bio, avatar_url, status, created_at,
        coachee_profiles(industry, job_title, location, phone, timezone, goals),
        programme_enrollments(id, start_date, end_date, status, progress_pct, programmes(name, duration_months, coachee_session_limit, peer_session_limit, peer_given_limit)),
        session_limits(monthly_limit)
      `)
      .eq("id", coachee_id)
      .maybeSingle();

    if (error) throw new ToolError({ message: error.message });
    if (!data) throw new ToolError({ message: "Coachee not found or access denied" });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
});
