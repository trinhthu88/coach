import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";
import {
  DEMO_ACCOUNTS,
  DEMO_ANCHOR_DATE,
  DEMO_BATCH_1_CONTRACT,
  DEMO_BATCH_2_CONTRACT,
  DEMO_BATCH_3_CONTRACT,
  DEMO_BATCH_4_CONTRACT,
  DEMO_FIXTURE_VERSION,
  DEMO_FIXTURE_IDS,
  DEMO_LEADER_COUNT,
  DEMO_ORGANIZATION_ID,
  DEMO_ORGANIZATION_NAME,
  DEMO_ORGANIZATION_SLUG,
  DEMO_PROGRAMMES,
} from "./manifest.ts";

type Action = "status" | "provision" | "reset" | "operation" | "manifest";

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function isUuid(value: string | undefined): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, corsHeaders);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const configuredOrganizationId = Deno.env.get("DEMO_ORGANIZATION_ID");
    if (
      !supabaseUrl ||
      !serviceKey ||
      !isUuid(configuredOrganizationId) ||
      configuredOrganizationId !== DEMO_ORGANIZATION_ID
    ) {
      return json({ error: "Live demo is not configured for this deployment" }, 503, corsHeaders);
    }
    const fixedOrganizationId = DEMO_ORGANIZATION_ID;

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    const admin = createClient(supabaseUrl, serviceKey);
    if (!token) return json({ error: "Missing or invalid session" }, 401, corsHeaders);
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) return json({ error: "Missing or invalid session" }, 401, corsHeaders);
    const callerId = user.id;

    const { data: roleRows, error: roleError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    if (roleError) throw roleError;
    if (!(roleRows ?? []).some((row: { role: string }) => row.role === "admin")) {
      return json({ error: "Forbidden" }, 403, corsHeaders);
    }

    const body = await req.json().catch(() => ({})) as {
      action?: Action;
      organization_id?: string;
      idempotency_key?: string;
      operation_id?: string;
      expected_generation?: number;
    };
    const action = body.action ?? "status";

    if (action === "manifest") {
      return json({
        fixture_version: DEMO_FIXTURE_VERSION,
        organization_name: DEMO_ORGANIZATION_NAME,
        organization_slug: DEMO_ORGANIZATION_SLUG,
        leader_count: DEMO_LEADER_COUNT,
        account_count: DEMO_ACCOUNTS.length,
        programmes: DEMO_PROGRAMMES,
        anchor_date: DEMO_ANCHOR_DATE,
        fixture_ids: DEMO_FIXTURE_IDS,
        batch_1_contract: DEMO_BATCH_1_CONTRACT,
        batch_2_contract: DEMO_BATCH_2_CONTRACT,
        batch_3_contract: DEMO_BATCH_3_CONTRACT,
        batch_4_contract: DEMO_BATCH_4_CONTRACT,
      }, 200, corsHeaders);
    }

    if (action === "status") {
      // Status may inspect a card selected by the admin, but only the fixed
      // deployment target can ever return demo data.
      if (body.organization_id !== fixedOrganizationId) {
        return json({ configured: true, is_demo: false }, 200, corsHeaders);
      }
      const { data: rows, error } = await admin.rpc("get_demo_organization_status", {
        p_organization_id: fixedOrganizationId,
      });
      if (error) throw error;
      const status = Array.isArray(rows) ? rows[0] : rows;
      if (!status) return json({ configured: true, is_demo: false }, 200, corsHeaders);
      return json({
        configured: true,
        is_demo: true,
        ...status,
      }, 200, corsHeaders);
    }

    if (action === "operation") {
      if (!isUuid(body.operation_id)) return json({ error: "A valid operation_id is required" }, 400, corsHeaders);
      const { data: operation, error } = await admin
        .from("demo_operations")
        .select("*")
        .eq("id", body.operation_id)
        .eq("organization_id", fixedOrganizationId)
        .maybeSingle();
      if (error) throw error;
      if (!operation) return json({ error: "Demo operation not found" }, 404, corsHeaders);
      return json({ configured: true, is_demo: true, operation }, 200, corsHeaders);
    }

    if (action === "provision" || action === "reset") {
      if (body.organization_id && body.organization_id !== fixedOrganizationId) {
        return json({ error: "The demo target is fixed for this deployment" }, 403, corsHeaders);
      }

      const { error: collisionError } = await admin.rpc("demo_assert_no_account_collisions");
      if (collisionError) throw collisionError;

      const { error: configureError } = await admin.rpc("demo_configure_target", {
        p_organization_id: fixedOrganizationId,
        p_fixture_version: DEMO_FIXTURE_VERSION,
        p_anchor_date: DEMO_ANCHOR_DATE,
      });
      if (configureError) throw configureError;

      const idempotencyKey = body.idempotency_key?.trim() || `${action}-${crypto.randomUUID()}`;
      if (action === "reset") {
        const { data: started, error: startError } = await admin.rpc("demo_begin_batch_4_operation", {
          p_organization_id: fixedOrganizationId,
          p_operation: "reset",
          p_idempotency_key: idempotencyKey,
          p_requested_by: callerId,
          p_fixture_version: DEMO_FIXTURE_VERSION,
          p_anchor_date: DEMO_ANCHOR_DATE,
          p_expected_generation: typeof body.expected_generation === "number" ? body.expected_generation : null,
        });
        if (startError) throw startError;
        const operation = Array.isArray(started) ? started[0] : started;
        if (!operation) throw new Error("Batch 4 did not return a lifecycle record");

        if (operation.status === "started") {
          const { data: applied, error: applyError } = await admin.rpc("demo_apply_batch_4", {
            p_operation_id: operation.id,
          });
          if (applyError) {
            await admin.rpc("demo_fail_operation", {
              p_operation_id: operation.id,
              p_error_message: applyError.message,
            });
            throw applyError;
          }

          const { data: finished, error: finishError } = await admin.rpc("demo_finish_operation", {
            p_operation_id: operation.id,
            p_affected_counts: Array.isArray(applied) ? applied[0] : applied,
          });
          if (finishError) {
            await admin.rpc("demo_fail_operation", {
              p_operation_id: operation.id,
              p_error_message: finishError.message,
            });
            throw finishError;
          }
          return json({ configured: true, is_demo: true, operation: Array.isArray(finished) ? finished[0] : finished }, 200, corsHeaders);
        }

        const statusCode = operation.status === "busy" || operation.status === "failed" ? 409 : 200;
        return json({ configured: true, is_demo: true, operation }, statusCode, corsHeaders);
      }

      // Batch 3 depends on the Batch 2 structure. Keep the two reconciliations
      // as separate lifecycle operations so each generation boundary remains
      // explicit and retryable.
      const { data: batch2Started, error: batch2StartError } = await admin.rpc("demo_begin_batch_2_operation", {
        p_organization_id: fixedOrganizationId,
        p_operation: action,
        p_idempotency_key: `${idempotencyKey}:batch2`,
        p_requested_by: callerId,
        p_fixture_version: DEMO_FIXTURE_VERSION,
        p_anchor_date: DEMO_ANCHOR_DATE,
        p_expected_generation: typeof body.expected_generation === "number" ? body.expected_generation : null,
      });
      if (batch2StartError) throw batch2StartError;
      const batch2Operation = Array.isArray(batch2Started) ? batch2Started[0] : batch2Started;
      if (!batch2Operation) throw new Error("Batch 2 did not return a lifecycle record");

      let batch2Finished = batch2Operation;
      if (batch2Operation.status === "started") {
        const { data: applied, error: applyError } = await admin.rpc("demo_apply_batch_2", {
          p_operation_id: batch2Operation.id,
        });
        if (applyError) {
          await admin.rpc("demo_fail_operation", {
            p_operation_id: batch2Operation.id,
            p_error_message: applyError.message,
          });
          throw applyError;
        }

        const { data: finished, error: finishError } = await admin.rpc("demo_finish_operation", {
          p_operation_id: batch2Operation.id,
          p_affected_counts: Array.isArray(applied) ? applied[0] : applied,
        });
        if (finishError) {
          await admin.rpc("demo_fail_operation", {
            p_operation_id: batch2Operation.id,
            p_error_message: finishError.message,
          });
          throw finishError;
        }
        batch2Finished = Array.isArray(finished) ? finished[0] : finished;
      }

      if (batch2Finished.status === "busy" || batch2Finished.status === "failed") {
        return json({ configured: true, is_demo: true, operation: batch2Finished }, 409, corsHeaders);
      }

      const { data: batch3Started, error: batch3StartError } = await admin.rpc("demo_begin_batch_3_operation", {
        p_organization_id: fixedOrganizationId,
        p_operation: action,
        p_idempotency_key: `${idempotencyKey}:batch3`,
        p_requested_by: callerId,
        p_fixture_version: DEMO_FIXTURE_VERSION,
        p_anchor_date: DEMO_ANCHOR_DATE,
        p_expected_generation: typeof batch2Finished.generation_after === "number"
          ? batch2Finished.generation_after
          : null,
      });
      if (batch3StartError) throw batch3StartError;
      const batch3Operation = Array.isArray(batch3Started) ? batch3Started[0] : batch3Started;
      if (!batch3Operation) throw new Error("Batch 3 did not return a lifecycle record");

      if (batch3Operation.status === "started") {
        const { data: applied, error: applyError } = await admin.rpc("demo_apply_batch_3", {
          p_operation_id: batch3Operation.id,
        });
        if (applyError) {
          await admin.rpc("demo_fail_operation", {
            p_operation_id: batch3Operation.id,
            p_error_message: applyError.message,
          });
          throw applyError;
        }

        const { data: finished, error: finishError } = await admin.rpc("demo_finish_operation", {
          p_operation_id: batch3Operation.id,
          p_affected_counts: Array.isArray(applied) ? applied[0] : applied,
        });
        if (finishError) {
          await admin.rpc("demo_fail_operation", {
            p_operation_id: batch3Operation.id,
            p_error_message: finishError.message,
          });
          throw finishError;
        }
        return json({ configured: true, is_demo: true, operation: Array.isArray(finished) ? finished[0] : finished }, 200, corsHeaders);
      }

      const statusCode = batch3Operation.status === "busy" || batch3Operation.status === "failed" ? 409 : 200;
      return json({ configured: true, is_demo: true, operation: batch3Operation }, statusCode, corsHeaders);
    }

    return json({ error: "Unsupported demo action" }, 400, corsHeaders);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500, corsHeaders);
  }
});