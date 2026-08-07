import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getUserRole } from "../utils";
import { supabaseAdmin } from "../supabase";

export default defineTool({
  name: "reject_access_request",
  title: "Reject access request",
  description: "Reject a pending access request.",
  inputSchema: {
    request_id: z.string().uuid().describe("UUID of the pending access request"),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  handler: async ({ request_id }, ctx) => {
    const callerId = ctx.getUserId();
    if (!callerId) throw new ToolError({ message: "Not authenticated" });
    const role = await getUserRole(callerId);
    if (role !== "admin") throw new ToolError({ message: "Admin access required" });

    const admin = supabaseAdmin();
    const { data: reqRow, error: reqErr } = await admin
      .from("access_requests")
      .select("status")
      .eq("id", request_id)
      .maybeSingle();
    if (reqErr || !reqRow) throw new ToolError({ message: reqErr?.message ?? "Request not found" });
    if (reqRow.status !== "pending") throw new ToolError({ message: "Request is not pending" });

    const { error } = await admin
      .from("access_requests")
      .update({ status: "rejected", reviewed_at: new Date().toISOString(), reviewed_by: callerId })
      .eq("id", request_id);
    if (error) throw new ToolError({ message: error.message });
    return { content: [{ type: "text", text: "Access request rejected." }] };
  },
});
