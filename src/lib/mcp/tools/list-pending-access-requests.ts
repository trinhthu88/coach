import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getUserRole } from "../utils";
import { supabaseAdmin } from "../supabase";

export default defineTool({
  name: "list_pending_access_requests",
  title: "List pending access requests",
  description: "List all access requests awaiting admin approval.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    const userId = ctx.getUserId();
    if (!userId) throw new ToolError("Not authenticated" );
    const role = await getUserRole(userId);
    if (role !== "admin") throw new ToolError("Admin access required" );

    const { data, error } = await supabaseAdmin()
      .from("access_requests")
      .select("id, full_name, email, role, company, job_title, industry, motivation, created_at, status")
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) throw new ToolError(error.message );
    return { content: [{ type: "text", text: JSON.stringify(data ?? []) }] };
  },
});
