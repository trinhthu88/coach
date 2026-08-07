import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_programmes",
  title: "List programmes",
  description: "List active coaching programmes and their session limits.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    const userId = ctx.getUserId();
    if (!userId) throw new ToolError("Not authenticated" );

    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("programmes")
      .select("id, name, description, duration_months, coachee_session_limit, coach_session_limit, peer_session_limit, peer_given_limit, color, is_active")
      .eq("is_active", true)
      .order("name");

    if (error) throw new ToolError(error.message );
    return { content: [{ type: "text", text: JSON.stringify(data ?? []) }] };
  },
});
