import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getUserRole } from "../utils";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_coachee_goals",
  title: "List coachee goals",
  description: "List goals and current ratings for a coachee.",
  inputSchema: {
    coachee_id: z.string().uuid().describe("UUID of the coachee"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ coachee_id }, ctx) => {
    const userId = ctx.getUserId();
    if (!userId) throw new ToolError({ message: "Not authenticated" });
    const role = await getUserRole(userId);
    if (!role) throw new ToolError({ message: "Role not found" });
    if (role === "coachee" && userId !== coachee_id) throw new ToolError({ message: "You can only view your own goals" });

    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("coachee_goals")
      .select(`
        id, title, description, status, target_date, sort_order, created_at,
        coachee_goal_ratings(start_rating, current_rating, target_rating)
      `)
      .eq("coachee_id", coachee_id)
      .order("sort_order");

    if (error) throw new ToolError({ message: error.message });
    return { content: [{ type: "text", text: JSON.stringify(data ?? []) }] };
  },
});
