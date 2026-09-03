import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { buildCorsHeaders } from "../_shared/cors.ts";

// Phase 3 (programme management completion): server-rendered PDF version of
// SponsorReport.tsx's on-screen preview, called by the sponsor from a
// "Download PDF Report" button (verify_jwt = true — this runs as the
// calling sponsor, not a cron job).
//
// Built with pdf-lib (pure JS, no headless browser) rather than rendering
// the existing HTML preview to PDF — Supabase Edge Functions run on Deno
// Deploy, which has no Chromium available, so an HTML->PDF-via-browser
// pipeline isn't an option here the way it would be on a Node server.
//
// Two Supabase clients are used deliberately: `asUser` forwards the
// caller's JWT so the sponsor_* SECURITY DEFINER functions resolve
// `auth.uid()` to the actual sponsor (they're org-scoped server-side, same
// as every other sponsor_* consumer — see useSponsorDashboardData.ts);
// `admin` (service-role) is only used for Storage, which has no per-row
// RLS need here since the sponsor never talks to Storage directly, only
// via the signed URL this function hands back.

interface RosterRow {
  full_name: string;
  cohort_name: string | null;
  enrollment_status: string;
  sessions_completed: number;
  sessions_entitled: number;
  goal_growth: number | null;
}

interface ProgrammeEngagementRow {
  week_number: number;
  week_title: string;
  skill_card_completion_pct: number | null;
  quiz_avg_score: number | null;
  quiz_completion_pct: number | null;
  triad_completion_pct: number | null;
  daily_prompt_response_rate: number | null;
  avg_confidence_score: number | null;
}

interface TopReflectionRow {
  anonymized_quote: string;
  week_number: number;
  role_played: string;
}

const PAGE_SIZE: [number, number] = [612, 792]; // US Letter
const MARGIN = 56;

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const {
      data: { user },
      error: userErr,
    } = await asUser.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [kpisRes, growthRes, rosterRes, satisfactionRes, orgRes, engagementRes, topReflectionsRes] = await Promise.all([
      asUser.rpc("sponsor_kpis"),
      asUser.rpc("sponsor_goal_growth_summary"),
      asUser.rpc("sponsor_roster"),
      asUser.rpc("sponsor_satisfaction_summary"),
      asUser.from("sponsor_profiles").select("organizations(name)").eq("user_id", user.id).maybeSingle(),
      asUser.rpc("sponsor_programme_engagement"),
      asUser.rpc("sponsor_top_reflections", { p_limit: 3 }),
    ]);
    if (kpisRes.error) throw kpisRes.error;

    const kpis = kpisRes.data?.[0] ?? null;
    const growth = growthRes.data?.[0] ?? null;
    const roster = (rosterRes.data ?? []) as RosterRow[];
    const satisfaction = satisfactionRes.data?.[0] ?? null;
    const orgName = (orgRes.data as { organizations: { name: string } | null } | null)?.organizations?.name ?? "Your organization";
    const engagement = (engagementRes.data ?? []) as ProgrammeEngagementRow[];
    const topReflections = (topReflectionsRes.data ?? []) as TopReflectionRow[];

    // ------------------------------------------------------------------
    // Build the PDF
    // ------------------------------------------------------------------
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const brand = rgb(0x06 / 255, 0x2f / 255, 0x3e / 255);
    const muted = rgb(0.4, 0.45, 0.47);
    const ink = rgb(0.04, 0.11, 0.15);

    let page = doc.addPage(PAGE_SIZE);
    let y = PAGE_SIZE[1] - MARGIN;

    function newPageIfNeeded(neededHeight: number) {
      if (y - neededHeight < MARGIN) {
        page = doc.addPage(PAGE_SIZE);
        y = PAGE_SIZE[1] - MARGIN;
      }
    }

    function text(str: string, opts: { size?: number; f?: typeof font; color?: ReturnType<typeof rgb>; gap?: number } = {}) {
      const size = opts.size ?? 11;
      newPageIfNeeded(size + (opts.gap ?? 6));
      page.drawText(str, { x: MARGIN, y, size, font: opts.f ?? font, color: opts.color ?? ink });
      y -= size + (opts.gap ?? 6);
    }

    text("Clariva Sponsor Summary", { size: 20, f: bold, color: brand, gap: 4 });
    text(orgName, { size: 13, f: bold, gap: 2 });
    text(`Issued ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, {
      size: 9,
      color: muted,
      gap: 18,
    });

    text("Key metrics", { size: 13, f: bold, gap: 10 });
    text(`Leaders enrolled: ${kpis?.leaders_enrolled ?? "—"}`);
    text(`Sessions used: ${kpis?.sessions_used ?? 0} / ${kpis?.sessions_entitled ?? 0}`);
    text(`Average rating: ${satisfaction?.avg_rating != null ? Number(satisfaction.avg_rating).toFixed(1) : "—"} / 5.0`);
    text(`At risk: ${kpis?.at_risk_count ?? 0}`, { gap: 18 });

    text("Goal growth", { size: 13, f: bold, gap: 10 });
    text(
      growth?.avg_growth != null
        ? `Average growth: +${Math.round(growth.avg_growth)} pts across ${growth.enrolled_leaders_count ?? 0} leaders`
        : "No goal ratings recorded yet.",
      { gap: 18 }
    );

    if (roster.length > 0) {
      text("Leader roster", { size: 13, f: bold, gap: 10 });
      const cols = [
        { label: "Leader", w: 150 },
        { label: "Cohort", w: 110 },
        { label: "Status", w: 80 },
        { label: "Sessions", w: 70 },
        { label: "Growth", w: 70 },
      ];
      newPageIfNeeded(20);
      let x = MARGIN;
      for (const c of cols) {
        page.drawText(c.label, { x, y, size: 9, font: bold, color: muted });
        x += c.w;
      }
      y -= 16;

      for (const r of roster) {
        newPageIfNeeded(14);
        x = MARGIN;
        const values = [
          r.full_name,
          r.cohort_name || "—",
          r.enrollment_status,
          `${r.sessions_completed}/${r.sessions_entitled}`,
          r.goal_growth != null ? `+${Math.round(r.goal_growth)}` : "—",
        ];
        values.forEach((v, i) => {
          page.drawText(String(v).slice(0, 28), { x, y, size: 9, font, color: ink });
          x += cols[i].w;
        });
        y -= 14;
      }
    }

    // Programme impact — omitted entirely when there's no engagement data
    // (mirrors SponsorReport.tsx's on-screen preview, which does the same).
    if (engagement.length > 0) {
      newPageIfNeeded(20);
      y -= 10;
      text("Programme impact", { size: 13, f: bold, gap: 10 });

      const avgOf = (values: (number | null)[]) => {
        const present = values.filter((v): v is number => v != null);
        return present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : null;
      };
      const fmtPct = (v: number | null) => (v != null ? `${Math.round(v)}%` : "—");
      text(`Skill card completion: ${fmtPct(avgOf(engagement.map((w) => w.skill_card_completion_pct)))}`);
      text(`Quiz completion: ${fmtPct(avgOf(engagement.map((w) => w.quiz_completion_pct)))}`);
      text(`Triad completion: ${fmtPct(avgOf(engagement.map((w) => w.triad_completion_pct)))}`);
      text(`Daily prompt response rate: ${fmtPct(avgOf(engagement.map((w) => w.daily_prompt_response_rate)))}`, { gap: 18 });

      if (topReflections.length > 0) {
        newPageIfNeeded(20);
        text("In their own words", { size: 11, f: bold, gap: 8 });
        for (const q of topReflections) {
          const quote = q.anonymized_quote.length > 200 ? `${q.anonymized_quote.slice(0, 200)}…` : q.anonymized_quote;
          text(`"${quote}" — Week ${q.week_number}`, { size: 9, color: muted, gap: 10 });
        }
        y -= 8;
      }
    }

    newPageIfNeeded(30);
    y -= 10;
    text(
      "Prepared from aggregate programme data. Session notes, chat messages, reflections and goal wording are excluded from Clariva sponsor reporting.",
      { size: 8, color: muted }
    );

    const pdfBytes = await doc.save();

    // ------------------------------------------------------------------
    // Upload + best-effort cleanup of this sponsor's older reports
    // ------------------------------------------------------------------
    const folder = user.id;
    const path = `${folder}/${Date.now()}.pdf`;

    const { data: existing } = await admin.storage.from("sponsor-reports").list(folder);
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const stale = (existing || [])
      .filter((f) => new Date(f.created_at ?? 0).getTime() < dayAgo)
      .map((f) => `${folder}/${f.name}`);
    if (stale.length > 0) {
      await admin.storage.from("sponsor-reports").remove(stale);
    }

    const { error: uploadErr } = await admin.storage.from("sponsor-reports").upload(path, pdfBytes, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (uploadErr) throw uploadErr;

    const { data: signed, error: signErr } = await admin.storage
      .from("sponsor-reports")
      .createSignedUrl(path, 60 * 60 * 24);
    if (signErr || !signed) throw signErr ?? new Error("Failed to sign URL");

    return new Response(JSON.stringify({ ok: true, url: signed.signedUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("generate-report-pdf failed", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
