import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/send-email.ts";
import { DailyPromptEmail } from "../_shared/email-templates/daily-prompt.tsx";

// Not user-triggered — invoked once a day (07:00) by an external cron
// service (or a pg_cron -> pg_net call) hitting this endpoint with the
// CRON_SECRET shared secret, hence verify_jwt = false in config.toml.
//
// Who gets which prompt today is decided in SQL by
// daily_prompt_targets_internal(): each enrollment's current Training week
// comes from its own cohort's Training calendar (cohort overrides included)
// and "today" is the programme time zone (Asia/Ho_Chi_Minh). The in-app
// get_todays_prompt() reads the same daily_prompt_for_enrollment_internal().

const SITE_URL = "https://clariva.club";

interface PromptTarget {
  enrollment_id: string;
  user_id: string;
  prompt_id: string;
  prompt_text: string;
  prompt_text_vi: string | null;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
  preferred_language: string | null;
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const CRON_SECRET = Deno.env.get("CRON_SECRET");
    const providedSecret = req.headers.get("x-cron-secret");
    if (!CRON_SECRET || providedSecret !== CRON_SECRET) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: targetRows, error: targetsErr } = await admin.rpc("daily_prompt_targets_internal");
    if (targetsErr) throw targetsErr;
    const targets = (targetRows ?? []) as PromptTarget[];

    let notified = 0;

    const { data: profileRows } = targets.length
      ? await admin
          .from("profiles")
          .select("id, full_name, email, preferred_language")
          .in("id", [...new Set(targets.map((target) => target.user_id))])
      : { data: [] };
    const profileById = new Map(((profileRows ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]));

    for (const target of targets) {
      const profile = profileById.get(target.user_id);
      if (!profile) continue;
      const enrollmentId = target.enrollment_id;
      const prompt = { id: target.prompt_id, prompt_text: target.prompt_text, prompt_text_vi: target.prompt_text_vi };

      const isVi = profile.preferred_language === "vi";
      const promptText = (isVi && prompt.prompt_text_vi) || prompt.prompt_text;

      const { error: notifErr } = await admin.from("notifications").insert({
        user_id: profile.id,
        notification_type: "daily_prompt",
        title: "Today's coaching nudge",
        title_vi: "Gợi ý coaching hôm nay",
        body: promptText,
        link: "/dashboard",
      });
      if (notifErr) {
        console.error("Failed to insert daily_prompt notification", { userId: profile.id, error: notifErr });
      }

      const { error: responseErr } = await admin.from("daily_prompt_responses").upsert(
        { daily_prompt_id: prompt.id, user_id: profile.id, enrollment_id: enrollmentId, opened_at: null },
        { onConflict: "enrollment_id,daily_prompt_id", ignoreDuplicates: true }
      );
      if (responseErr) {
        console.error("Failed to seed daily_prompt_responses row", { userId: profile.id, error: responseErr });
      }

      if (profile.email) {
        const props = {
          fullName: profile.full_name || "there",
          promptText,
          dashboardUrl: `${SITE_URL}/dashboard`,
          isVi,
        };
        const html = await renderAsync(React.createElement(DailyPromptEmail, props));
        const text = await renderAsync(React.createElement(DailyPromptEmail, props), { plainText: true });
        const result = await sendEmail({
          to: profile.email,
          subject: isVi ? "Gợi ý coaching hôm nay" : "Today's coaching nudge",
          html,
          text,
        });
        if (!result.ok) {
          console.error("Failed to send daily-prompt email", { error: result.error, email: profile.email });
        }
      }

      notified++;
    }

    return new Response(JSON.stringify({ ok: true, notified }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-daily-prompt failed", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
