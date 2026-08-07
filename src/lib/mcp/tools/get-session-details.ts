import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getUserRole } from "../utils";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_session_details",
  title: "Get session details",
  description: "Get full details for a coaching session, including notes and goal ratings.",
  inputSchema: {
    session_id: z.string().uuid().describe("UUID of the session"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ session_id }, ctx) => {
    const userId = ctx.getUserId();
    if (!userId) throw new ToolError({ message: "Not authenticated" });
    const role = await getUserRole(userId);
    if (!role) throw new ToolError({ message: "Role not found" });

    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("sessions")
      .select(`
        id, topic, start_time, duration_minutes, status, meeting_url, action_items,
        coach_notes, coachee_notes, coachee_rating, coachee_rating_comment,
        coach:coach_id(id, full_name),
        coachee:coachee_id(id, full_name),
        session_goal_ratings(id, goal_id, rating, note, created_at, coachee_goals(title))
      `)
      .eq("id", session_id)
      .maybeSingle();

    if (error) throw new ToolError({ message: error.message });
    if (!data) throw new ToolError({ message: "Session not found or access denied" });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
});
