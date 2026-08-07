import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getUserRole } from "../utils";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_sessions",
  title: "List sessions",
  description: "List coaching sessions visible to the signed-in user.",
  inputSchema: {
    status: z.enum(["pending", "confirmed", "completed", "cancelled"]).optional().describe("Filter by session status"),
    limit: z.number().int().min(1).max(100).default(50).describe("Maximum number of sessions to return"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, limit }, ctx) => {
    const userId = ctx.getUserId();
    if (!userId) throw new ToolError("Not authenticated" );
    const role = await getUserRole(userId);
    if (!role) throw new ToolError("Role not found" );

    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("sessions")
      .select(`
        id, topic, start_time, duration_minutes, status, confirmed_at, cancelled_at,
        coach:coach_id(full_name),
        coachee:coachee_id(full_name)
      `)
      .order("start_time", { ascending: false })
      .limit(limit);

    if (role === "admin") {
      // no filter
    } else if (role === "coach") {
      query = query.or(`coach_id.eq.${userId}`);
    } else {
      query = query.eq("coachee_id", userId);
    }

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) throw new ToolError(error.message );
    return { content: [{ type: "text", text: JSON.stringify(data ?? []) }] };
  },
});
