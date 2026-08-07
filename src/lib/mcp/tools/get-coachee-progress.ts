import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getUserRole } from "../utils";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_coachee_progress",
  title: "Get coachee progress",
  description: "Get a coachee's programme progress, session counts, and average goal ratings.",
  inputSchema: {
    coachee_id: z.string().uuid().describe("UUID of the coachee"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ coachee_id }, ctx) => {
    const userId = ctx.getUserId();
    if (!userId) throw new ToolError("Not authenticated" );
    const role = await getUserRole(userId);
    if (!role) throw new ToolError("Role not found" );
    if (role === "coachee" && userId !== coachee_id) throw new ToolError("You can only view your own progress" );

    const supabase = supabaseForUser(ctx);
    const [{ data: enrollment }, { data: sessions }, { data: ratings }] = await Promise.all([
      supabase
        .from("programme_enrollments")
        .select("id, start_date, end_date, progress_pct, status, programmes(name, duration_months, coachee_session_limit)")
        .eq("coachee_id", coachee_id)
        .maybeSingle(),
      supabase.from("sessions").select("status", { count: "exact" }).eq("coachee_id", coachee_id),
      supabase.from("coachee_goal_ratings").select("start_rating, current_rating, target_rating").eq("coachee_id", coachee_id),
    ]);

    const completed = sessions?.filter((s) => s.status === "completed").length ?? 0;
    const avgCurrent = ratings && ratings.length > 0
      ? ratings.reduce((sum, r) => sum + r.current_rating, 0) / ratings.length
      : null;
    const avgTarget = ratings && ratings.length > 0
      ? ratings.reduce((sum, r) => sum + r.target_rating, 0) / ratings.length
      : null;

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          enrollment,
          session_counts: { total: sessions?.length ?? 0, completed },
          goal_averages: { current: avgCurrent, target: avgTarget, goal_count: ratings?.length ?? 0 },
        }),
      }],
    };
  },
});
