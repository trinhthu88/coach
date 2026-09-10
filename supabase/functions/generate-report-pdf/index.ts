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

    let requestBody: { p_cohort_id?: unknown; cohort_id?: unknown } = {};
    try { requestBody = await req.json(); } catch { /* validation below returns 400 */ }
    const requestedCohort = requestBody.p_cohort_id ?? requestBody.cohort_id;
    if (typeof requestedCohort !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedCohort)) {
      return new Response(JSON.stringify({ error: "p_cohort_id must be a valid cohort UUID" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const [cohortRes, enrollmentRes] = await Promise.all([
      asUser.rpc("sponsor_cohort_summaries", { p_cohort_id: requestedCohort }),
      asUser.rpc("sponsor_enrollment_summaries", { p_cohort_id: requestedCohort }),
    ]);
    if (cohortRes.error) throw cohortRes.error;
    if (enrollmentRes.error) throw enrollmentRes.error;
    const cohort = cohortRes.data?.[0];
    if (!cohort || cohort.suppressed) {
      return new Response(JSON.stringify({ error: "Detailed sponsor report is suppressed to protect privacy" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows = enrollmentRes.data ?? [];
    const kpis = rows.length ? {
      leaders_enrolled: rows.length,
      sessions_used: rows.reduce((n, r) => n + r.coaching_completed_count, 0),
      sessions_entitled: rows.reduce((n, r) => n + r.required_units, 0),
    } : null;
    const roster = rows.map((r) => ({
      full_name: r.learner_display_name,
      cohort_name: r.cohort_label,
      enrollment_status: r.enrollment_status,
      sessions_completed: r.coaching_completed_count,
      sessions_entitled: r.required_units,
    })) as RosterRow[];

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
    text(cohort.cohort_label ?? "Sponsor cohort", { size: 13, f: bold, gap: 2 });
    text(`Issued ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, {
      size: 9,
      color: muted,
      gap: 18,
    });

    text("Key metrics", { size: 13, f: bold, gap: 10 });
    text(`Leaders enrolled: ${kpis?.leaders_enrolled ?? "—"}`);
    text(`Sessions used: ${kpis?.sessions_used ?? 0} / ${kpis?.sessions_entitled ?? 0}`);
    text("Privacy-safe enrollment and cohort metrics only.", { gap: 18 });

    if (roster.length > 0) {
      text("Leader roster", { size: 13, f: bold, gap: 10 });
      const cols = [
        { label: "Leader", w: 150 },
        { label: "Cohort", w: 110 },
        { label: "Status", w: 80 },
        { label: "Sessions", w: 70 },
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
        ];
        values.forEach((v, i) => {
          page.drawText(String(v).slice(0, 28), { x, y, size: 9, font, color: ink });
          x += cols[i].w;
        });
        y -= 14;
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
