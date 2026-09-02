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
// The prompt for a given day is the same for every enrollee of a programme
// (it only depends on that programme's current training_week + today's
// date), so this resolves it once per programme rather than once per user —
// see get_todays_prompt() for the equivalent per-caller logic this mirrors.

const SITE_URL = "https://clariva.club";

interface TrainingWeekRow {
  id: string;
  week_number: number;
  unlock_date: string;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
  preferred_language: string | null;
}

function dayNumberFor(unlockDate: string): number {
  const unlock = new Date(`${unlockDate}T00:00:00Z`);
  const today = new Date();
  const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const days = Math.floor((todayUTC.getTime() - unlock.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  return Math.min(7, Math.max(1, days));
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

    const { data: modules, error: modulesErr } = await admin
      .from("programme_modules")
      .select("programme_id")
      .eq("module", "daily_prompt")
      .eq("enabled", true);
    if (modulesErr) throw modulesErr;
    const programmeIds = [...new Set((modules ?? []).map((m) => m.programme_id))];

    let notified = 0;
    let skipped = 0;

    for (const programmeId of programmeIds) {
      const { data: currentWeek } = await admin
        .from("training_weeks")
        .select("id, week_number, unlock_date")
        .eq("programme_id", programmeId)
        .eq("is_visible", true)
        .not("unlock_date", "is", null)
        .lte("unlock_date", new Date().toISOString().slice(0, 10))
        .order("week_number", { ascending: false })
        .limit(1)
        .maybeSingle<TrainingWeekRow>();
      if (!currentWeek) continue;

      const dayNum = dayNumberFor(currentWeek.unlock_date);
      const { data: prompt } = await admin
        .from("daily_prompts")
        .select("id, prompt_text, prompt_text_vi")
        .eq("training_week_id", currentWeek.id)
        .eq("day_number", dayNum)
        .maybeSingle();
      if (!prompt) continue;

      const { data: enrollments } = await admin
        .from("programme_enrollments")
        .select("user_id")
        .eq("programme_id", programmeId)
        .eq("status", "active");
      const userIds = [...new Set((enrollments ?? []).map((e) => e.user_id))];
      if (userIds.length === 0) continue;

      const { data: existingResponses } = await admin
        .from("daily_prompt_responses")
        .select("user_id")
        .eq("daily_prompt_id", prompt.id)
        .in("user_id", userIds);
      const alreadyNotified = new Set((existingResponses ?? []).map((r) => r.user_id));

      const pendingIds = userIds.filter((id) => !alreadyNotified.has(id));
      skipped += alreadyNotified.size;
      if (pendingIds.length === 0) continue;

      const { data: profiles } = await admin
        .from("profiles")
        .select("id, full_name, email, preferred_language")
        .in("id", pendingIds);

      for (const profile of (profiles ?? []) as ProfileRow[]) {
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
          { daily_prompt_id: prompt.id, user_id: profile.id, opened_at: null },
          { onConflict: "daily_prompt_id,user_id", ignoreDuplicates: true }
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
    }

    return new Response(JSON.stringify({ ok: true, notified, skipped }), {
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
