import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getUserRole } from "../utils";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_coachees",
  title: "List coachees",
  description: "List coachees visible to the signed-in user (all for admins, assigned coachees for coaches).",
  inputSchema: {
    limit: z.number().int().min(1).max(100).default(50).describe("Maximum number of coachees to return"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    const userId = ctx.getUserId();
    if (!userId) throw new ToolError("Not authenticated" );
    const role = await getUserRole(userId);
    if (!role || role === "coachee") throw new ToolError("Admin or coach access required" );

    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("profiles")
      .select("id, full_name, email, status, created_at, coachee_profiles!inner(industry, job_title, location)")
      .eq("coachee_profiles.id", "id")
      .order("full_name")
      .limit(limit);

    if (role === "coach") {
      query = query.eq("sessions.coach_id", userId);
    }

    const { data, error } = await query;
    if (error) throw new ToolError(error.message );
    return { content: [{ type: "text", text: JSON.stringify(data ?? []) }] };
  },
});
