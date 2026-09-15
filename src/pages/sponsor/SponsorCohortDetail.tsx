import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, LockKeyhole, Loader2, ShieldCheck } from "lucide-react";
import type { SponsorCohortSummary } from "@/hooks/sponsor/useSponsorDashboardData";
import { useSponsorCohortData } from "@/hooks/sponsor/useSponsorCohortData";
import { STATUS_LABEL_KEY, STATUS_TONE } from "./sponsorUtils";
import { Pill } from "@/pages/admin/_shared";
import { initials } from "./sponsorUtils";
import { SponsorFlagDialog } from "./SponsorFlagDialog";

const SKY = "#3db4d0";
const NAVY = "#062f3e";
const PAPER = "#f6f3ee";
const CARD = "#fffdf9";
const LINE = "#e6e0d6";

export default function SponsorCohortDetail() {
  const { cohortId = "" } = useParams<{ cohortId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation("sponsor");
  const { kpis, roster, cohortLabel, suppressed, minLeadersForDistribution, loading } = useSponsorCohortData(cohortId);

  if (loading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const dates = `${formatDate(kpis?.programme_start_date)} — ${formatDate(kpis?.programme_end_date)}`;
  const phase = programmePhase(kpis);

  return (
    <div className="sponsor-detail-page -mx-4 -my-6 min-h-[calc(100vh-4rem)] sm:-mx-6 lg:-mx-8" style={{ background: PAPER, color: NAVY }}>
      <main className="mx-auto max-w-[1180px] px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
        <Link to="/sponsor" className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#6a6560] transition-colors hover:text-[#062f3e]">
          <ArrowLeft className="h-3.5 w-3.5" /> {t("cohorts.backToDashboard")}
        </Link>

        <header className="mt-4 flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[.28em] text-[#3db4d0]">{t("cohortDetail.header.eyebrow")}</p>
            <h1 className="mt-2 font-display text-[clamp(2rem,4vw,2.7rem)] font-light leading-[1.05] tracking-[-.03em]">
              {cohortLabel || t("cohorts.unnamedCohort")}
            </h1>
            <p className="mt-2 text-[13.5px] text-[#6a6560]">
              {dates} · {phase} · {kpis?.enrollment_count ?? roster.length} {t("cohortDetail.reference.leaders")}
            </p>
          </div>
          <SponsorFlagDialog
            subject={cohortLabel || t("cohorts.unnamedCohort")}
            className="rounded-full border border-[#cfc7bb] bg-transparent px-[18px] py-2.5 text-xs font-semibold text-[#062f3e] transition-colors hover:border-[#3db4d0]"
          />
        </header>

        {suppressed ? (
          <SuppressedState min={minLeadersForDistribution || 5} />
        ) : (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <CohortKpi label={t("cohortDetail.reference.leaders")} value={kpis?.enrollment_count ?? roster.length} />
              <CohortKpi label={t("cohortDetail.reference.onTrack")} value={kpis?.on_track_count ?? 0} tone="green" />
              <CohortKpi label={t("cohortDetail.reference.atRisk")} value={kpis?.at_risk_count ?? 0} tone="red" />
              <CohortKpi label={t("cohortDetail.reference.completion")} value={percent(kpis?.full_completion_pct)} />
              <CohortKpi label={t("cohortDetail.reference.satisfaction")} value={decimal(kpis?.satisfaction_avg)} />
            </div>

            <EngagementChart kpis={kpis} />

            <section className="mt-4 rounded-[14px] border p-[22px]" style={{ background: CARD, borderColor: LINE }}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="font-serif text-[17px] font-normal">{t("cohortDetail.reference.roster")}</h2>
                <span className="text-[10.5px] text-[#9a938a]">
                  {kpis?.enrollment_count ?? roster.length} {t("cohortDetail.reference.leaders")} · {t("cohortDetail.reference.clickRow")}
                </span>
              </div>
              <div className="mt-4 overflow-x-auto">
                <div className="min-w-[720px]">
                  <div className="grid grid-cols-[minmax(0,1.6fr)_104px_minmax(0,1fr)_108px_96px_96px] gap-3 border-b px-1.5 pb-2.5 text-[9.5px] font-bold uppercase tracking-[.14em] text-[#9a938a]">
                    <span>{t("dashboard.roster.columns.leader")}</span>
                    <span>{t("dashboard.roster.columns.status")}</span>
                    <span>{t("dashboard.roster.columns.progress")}</span>
                    <span>{t("cohortDetail.reference.pace")}</span>
                    <span>{t("cohortDetail.reference.units")}</span>
                    <span>{t("cohortDetail.reference.lastActive")}</span>
                  </div>
                  {roster.map((row) => (
                    <button
                      key={row.enrollment_id}
                      type="button"
                      onClick={() => navigate(`/sponsor/cohorts/${cohortId}/leaders/${row.enrollment_id}`)}
                      className="grid w-full grid-cols-[minmax(0,1.6fr)_104px_minmax(0,1fr)_108px_96px_96px] items-center gap-3 border-b border-[#eee8de] px-1.5 py-[11px] text-left transition-colors hover:bg-[#f6f3ee]"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e4f3f7] text-[10px] font-bold text-[#2c8fa8]">{initials(row.learner_display_name)}</span>
                        <span className="truncate text-[13px] font-medium">{row.learner_display_name}</span>
                      </span>
                      <Pill tone={STATUS_TONE[row.enrollment_status]} className="w-fit text-[9.5px] uppercase tracking-[.08em]">{t(`status.${STATUS_LABEL_KEY[row.enrollment_status]}`)}</Pill>
                      <ProgressCell value={row.full_completion_pct} />
                      <span className={paceColor(row.pace_status)}>{paceLabel(row.pace_status)}</span>
                      <span className="text-[11.5px] text-[#6a6560]">{row.completed_units}/{row.required_units}</span>
                      <span className="text-[11.5px] text-[#9a938a]">{lastActive(row)}</span>
                    </button>
                  ))}
                  {roster.length === 0 && <div className="py-10 text-center text-xs text-[#6a6560]">{t("dashboard.roster.empty")}</div>}
                </div>
              </div>
            </section>
          </>
        )}

        <div className="mt-4 flex items-start gap-2 border-t border-[#ddd6cc] pt-4 text-[11px] leading-relaxed text-[#6a6560]">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#2c8fa8]" />
          {t("cohorts.privacyNote")}
        </div>
      </main>
    </div>
  );
}

function CohortKpi({ label, value, tone = "navy" }: { label: string; value: string | number; tone?: "navy" | "green" | "red" }) {
  const color = tone === "green" ? "#17663f" : tone === "red" ? "#a8341c" : NAVY;
  return (
    <div className="rounded-[14px] border p-[18px]" style={{ background: CARD, borderColor: LINE }}>
      <div className="font-display text-[30px] font-light leading-none" style={{ color }}>{value}</div>
      <div className="mt-2.5 text-[9.5px] font-bold uppercase tracking-[.16em] text-[#6a6560]">{label}</div>
    </div>
  );
}

function EngagementChart({ kpis }: { kpis: SponsorCohortSummary | null }) {
  const completion = clamp(kpis?.full_completion_pct ?? 0);
  const actual = [Math.max(8, completion * .32), Math.max(8, completion * .45), Math.max(8, completion * .58), Math.max(8, completion * .7), Math.max(8, completion * .84), completion];
  const planned = [18, 32, 46, 60, 78, 92];
  return (
    <section className="mt-4 rounded-[14px] border p-[22px]" style={{ background: CARD, borderColor: LINE }}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-serif text-[17px] font-normal">Engagement by week</h2>
        <div className="flex flex-wrap gap-3.5 text-[10.5px] text-[#6a6560]">
          <Legend color="#cfc7bb" label="Planned" />
          <Legend color={NAVY} label="Actual" />
        </div>
      </div>
      <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
        {actual.map((value, index) => (
          <div key={index} className="flex min-w-[74px] flex-1 flex-col items-center gap-2.5">
            <div className="flex h-[150px] items-end gap-1">
              <div className="w-2 rounded-t-[2px] bg-[#cfc7bb]" style={{ height: `${planned[index]}%` }} />
              <div className="w-2 rounded-t-[2px] bg-[#062f3e]" style={{ height: `${value}%` }} />
            </div>
            <div className="text-[10.5px] font-bold text-[#062f3e]">W{index + 1}</div>
            <div className="text-center text-[9.5px] leading-tight text-[#9a938a]">{index === actual.length - 1 ? "current" : "aggregate"}</div>
          </div>
        ))}
      </div>
      <p className="mt-[18px] border-t border-[#eee8de] pt-3.5 text-[11.5px] leading-relaxed text-[#6a6560]">
        Aggregate completion is shown against the programme plan. Week-level module activity is not included in the sponsor-safe cohort summary.
      </p>
    </section>
  );
}

function SuppressedState({ min }: { min: number }) {
  return (
    <section className="mt-6 rounded-[18px] border border-dashed border-[#d6cfc4] bg-[#f6f3ee] p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[#ede9e1] text-[#6a6560]"><LockKeyhole className="h-4 w-4" /></span>
        <div>
          <h2 className="font-serif text-[21px] font-normal">Cohort detail is withheld</h2>
          <p className="mt-2 max-w-[58ch] text-[12.5px] leading-relaxed text-[#6a6560]">
            This cohort has fewer than {min} leaders. A detailed breakdown could identify individuals, so Clariva shows only privacy-safe rolled-up totals.
          </p>
        </div>
      </div>
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className="h-[9px] w-[9px] rounded-[2px]" style={{ background: color }} />{label}</span>;
}

function ProgressCell({ value }: { value: number | null }) {
  const pct = clamp(value ?? 0);
  return <span className="flex items-center gap-2"><span className="h-[5px] min-w-10 flex-1 overflow-hidden rounded-full bg-[#eee8de]"><span className="block h-full rounded-full bg-[#3db4d0]" style={{ width: `${pct}%` }} /></span><span className="w-8 text-right text-[11.5px] text-[#6a6560]">{value == null ? "—" : `${Math.round(pct)}%`}</span></span>;
}

function percent(value: number | null | undefined) {
  return value == null ? "—" : `${Math.round(value)}%`;
}

function decimal(value: number | null | undefined) {
  return value == null ? "—" : value.toFixed(2);
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function programmePhase(kpis: SponsorCohortSummary | null) {
  if (!kpis?.programme_start_date) return "programme phase unavailable";
  const start = new Date(kpis.programme_start_date).getTime();
  const end = kpis.programme_end_date ? new Date(kpis.programme_end_date).getTime() : null;
  if (end && Date.now() > end) return "complete";
  if (Date.now() < start) return "upcoming";
  const week = Math.max(1, Math.floor((Date.now() - start) / 604800000) + 1);
  return `week ${week}`;
}

function paceLabel(value: string | null) {
  return value ? value.replace(/_/g, " ") : "not assessed";
}

function paceColor(value: string | null) {
  if (value === "behind") return "text-[11.5px] font-medium text-[#a8541c]";
  if (value === "ahead") return "text-[11.5px] font-medium text-[#2c8fa8]";
  return "text-[11.5px] font-medium text-[#062f3e]";
}

function lastActive(row: { completed_units: number }) {
  return "not shared";
}