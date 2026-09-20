import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ChevronDown, LockKeyhole, Loader2, ShieldCheck } from "lucide-react";
import type { SponsorCohortSummary, SponsorRosterRow } from "@/hooks/sponsor/useSponsorDashboardData";
import { useSponsorCohortData } from "@/hooks/sponsor/useSponsorCohortData";
import { Pill } from "@/pages/admin/_shared";
import { STATUS_LABEL_KEY, STATUS_TONE, cohortLifecycleStatus, cohortProgress, effectiveSponsorStatus, initials } from "./sponsorUtils";
import { SponsorFlagDialog } from "./SponsorFlagDialog";
import { SponsorDataErrorState } from "./SponsorDataErrorState";
import { moduleScopeLabelFor } from "@/components/programme/profileTheme";

const SKY = "#3db4d0";
const NAVY = "#062f3e";
const PAPER = "#f6f3ee";
const CARD = "#fffdf9";
const LINE = "#e6e0d6";
const GREEN = "#17663f";
const PLUM = "#7a5aa8";
const TEAL = "#2c8fa8";

type SortKey = "name" | "status" | "coaching" | "training" | "peer" | "mentoring" | "triads";
type FilterKey = "all" | "attention" | "pace" | "coaching" | "learning";

export default function SponsorCohortDetail() {
  const { cohortId = "" } = useParams<{ cohortId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation("sponsor");
  const {
    kpis,
    roster,
    cohortLabel,
    suppressed,
    minLeadersForDistribution,
    loading,
    error,
    retry,
  } = useSponsorCohortData(cohortId);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const progress = useMemo(
    () => cohortProgress(kpis?.programme_start_date ?? null, kpis?.programme_end_date ?? null),
    [kpis?.programme_end_date, kpis?.programme_start_date],
  );
  const visibleRoster = useMemo(() => {
    const filtered = roster.filter((row) => matchesFilter(row, filter));
    const direction = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((left, right) => {
      if (sortKey === "name") return direction * left.learner_display_name.localeCompare(right.learner_display_name);
      if (sortKey === "status") return direction * effectiveSponsorStatus(left).localeCompare(effectiveSponsorStatus(right));
      return direction * (moduleMetric(right, sortKey) - moduleMetric(left, sortKey));
    });
  }, [filter, roster, sortDir, sortKey]);

  const filterCounts = useMemo(() => ({
    all: roster.length,
    attention: roster.filter((row) => matchesFilter(row, "attention")).length,
    pace: roster.filter((row) => matchesFilter(row, "pace")).length,
    coaching: roster.filter((row) => matchesFilter(row, "coaching")).length,
    learning: roster.filter((row) => matchesFilter(row, "learning")).length,
  }), [roster]);

  if (loading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (error) {
    return (
      <SponsorDataErrorState
        title={t("dashboard.dataError.title")}
        description={t("dashboard.dataError.description")}
        retryLabel={t("dashboard.dataError.retry")}
        onRetry={retry}
      />
    );
  }

  const status = programmeStatus(kpis);
  const programmeLabel = kpis?.programme_label || t("cohortDetail.reference.programmeUnavailable");

  return (
    <div className="sponsor-detail-page -mx-4 -my-6 min-h-[calc(100vh-4rem)] sm:-mx-6 lg:-mx-8" style={{ background: PAPER, color: NAVY }}>
      <main className="mx-auto max-w-[1180px] px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
        <Link to="/sponsor" className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#6a6560] transition-colors hover:text-[#062f3e]">
          <ArrowLeft className="h-3.5 w-3.5" /> {t("cohorts.backToDashboard")}
        </Link>

        <header className="mt-4 flex flex-wrap items-start justify-between gap-[18px]">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[.28em] text-[#3db4d0]">{t("cohortDetail.header.eyebrow")}</div>
            <h1 className="mt-2 font-display text-[clamp(2rem,4vw,2.7rem)] font-light leading-[1.05] tracking-[-.03em]">
              {cohortLabel || t("cohorts.unnamedCohort")}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <span className={`rounded-full px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[.1em] ${statusClass(status)}`}>{t(`cohortDetail.programmeDetails.status.${status}`)}</span>
              <span className="text-[13.5px] font-medium text-[#062f3e]">{programmeLabel}</span>
              <span className="text-[13px] text-[#9a938a]">{formatDate(kpis?.programme_start_date)} — {formatDate(kpis?.programme_end_date)}</span>
            </div>
          </div>
          <SponsorFlagDialog
            subject={cohortLabel || t("cohorts.unnamedCohort")}
            className="rounded-full border border-[#cfc7bb] bg-transparent px-[18px] py-2.5 text-xs font-semibold text-[#062f3e] transition-colors hover:border-[#3db4d0]"
          />
        </header>

        {suppressed ? (
          <SuppressedState min={minLeadersForDistribution} />
        ) : (
          <>
            <ProgressStrip kpis={kpis} progress={progress} status={status} t={t} />

            <div className="mt-4 grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(198px,1fr))]">
              <ModuleCard label={t("cohortDetail.modules.coaching")} color={SKY} completed={kpis?.coaching_completed_units} due={kpis?.coaching_due_units} required={kpis?.coaching_required_units} completedLeaders={kpis?.coaching_completed_leaders} leaderCount={kpis?.enrollment_count} t={t} />
              <ModuleCard label={t("cohortDetail.modules.training")} color={NAVY} completed={kpis?.training_completed_units} due={kpis?.training_due_units} required={kpis?.training_required_units} completedLeaders={kpis?.training_completed_leaders} leaderCount={kpis?.enrollment_count} t={t} />
              <ModuleCard label={t("cohortDetail.modules.peer")} color={TEAL} completed={kpis?.peer_completed_units} due={kpis?.peer_due_units} required={kpis?.peer_required_units} completedLeaders={kpis?.peer_completed_leaders} leaderCount={kpis?.enrollment_count} t={t} />
              <ModuleCard label={t("cohortDetail.modules.mentoring")} color={GREEN} completed={kpis?.mentoring_completed_units} due={kpis?.mentoring_due_units} required={kpis?.mentoring_required_units} completedLeaders={kpis?.mentoring_completed_leaders} leaderCount={kpis?.enrollment_count} t={t} />
              <ModuleCard label={t("cohortDetail.modules.triads")} color={PLUM} completed={kpis?.triad_completed_units} due={kpis?.triad_due_units} required={kpis?.triad_required_units} completedLeaders={kpis?.triad_completed_leaders} leaderCount={kpis?.enrollment_count} t={t} />
            </div>

            <AttentionSection kpis={kpis} counts={filterCounts} filter={filter} onFilter={setFilter} t={t} />

            <ProgrammeJourney journey={kpis?.programme_journey} t={t} />

            <section className="mt-4 rounded-[14px] border p-[22px]" style={{ background: CARD, borderColor: LINE }}>
              <button
                type="button"
                onClick={() => setDetailsOpen((open) => !open)}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <span className="font-serif text-[17px] font-normal">{t("cohortDetail.programmeDetails.label")}</span>
                <span className="inline-flex items-center gap-2 text-[11.5px] font-semibold text-[#2c8fa8]">
                  {detailsOpen ? t("cohortDetail.reference.hide") : t("cohortDetail.reference.show")}
                  <ChevronDown className={`h-4 w-4 transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
                </span>
              </button>
               {detailsOpen && <ProgrammeDetails kpis={kpis} t={t} />}
            </section>

            <RosterSection
              rows={visibleRoster}
              allRows={roster}
              filter={filter}
              counts={filterCounts}
              sortKey={sortKey}
              sortDir={sortDir}
              onFilter={setFilter}
              onSort={(key) => {
                if (key === sortKey) setSortDir((direction) => direction === "asc" ? "desc" : "asc");
                else {
                  setSortKey(key);
                  setSortDir("asc");
                }
              }}
              onSelect={(row) => navigate(`/sponsor/cohorts/${cohortId}/leaders/${row.enrollment_id}`)}
              t={t}
            />
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

function ProgressStrip({ kpis, progress, status, t }: { kpis: SponsorCohortSummary | null; progress: ReturnType<typeof cohortProgress>; status: "upcoming" | "active" | "complete"; t: (key: string, options?: Record<string, unknown>) => string }) {
  return (
    <div className="mt-[18px] flex flex-wrap items-center gap-[26px] rounded-[14px] border px-[22px] py-[18px]" style={{ background: CARD, borderColor: LINE }}>
      <div className="flex flex-wrap gap-[26px]">
        <MiniMetric value={kpis?.enrollment_count ?? 0} label={t("cohortDetail.progressStrip.enrolled")} />
        <MiniMetric value={kpis?.active_count ?? 0} label={t("cohortDetail.progressStrip.active")} />
      </div>
      <div className="min-w-[220px] flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11.5px] font-semibold text-[#062f3e]">
            {status === "complete"
              ? t("cohortDetail.progressStrip.complete")
              : status === "upcoming"
                ? t("cohortDetail.programmeDetails.status.upcoming")
                : progress
                  ? t("cohortDetail.programmeDetails.dayOf", { elapsed: progress.elapsed, total: progress.total })
                  : t("cohortDetail.reference.programmeUnavailable")}
          </span>
          {status === "active" && progress && <span className="text-[11px] text-[#9a938a]">{t("cohortDetail.progressStrip.daysRemaining", { count: Math.max(0, progress.total - progress.elapsed) })}</span>}
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#eee8de]">
           <div className="h-full rounded-full bg-[#3db4d0]" style={{ width: `${progress?.pct ?? 0}%` }} />
        </div>
      </div>
    </div>
  );
}

function MiniMetric({ value, label }: { value: number; label: string }) {
  return <div><div className="font-display text-2xl font-light leading-none">{value}</div><div className="mt-1.5 text-[9.5px] font-bold uppercase tracking-[.14em] text-[#9a938a]">{label}</div></div>;
}

function ModuleCard({
  label,
  color,
  completed,
  due,
  required,
  completedLeaders,
  leaderCount,
  t,
}: {
  label: string;
  color: string;
  completed?: number | null;
  due?: number | null;
  required?: number | null;
  completedLeaders?: number | null;
  leaderCount?: number | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  // required === 0 means the module isn't part of this programme's
  // configuration at all (Admin left it disabled) — that's a different
  // condition from completed/required being null (sponsor-safe suppression
  // withheld the figures), and each needs its own explanation rather than
  // both collapsing into a misleading "0/0".
  const isMissing = completed == null || required == null;
  const isNotApplicable = !isMissing && required === 0;
  const hasData = !isMissing && required > 0;
  const percentage = hasData ? Math.min(100, Math.round((completed / required) * 100)) : 0;
  return (
    <div className="flex min-h-[190px] flex-col gap-3 rounded-[14px] border p-[18px]" style={{ background: CARD, borderColor: LINE }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9.5px] font-bold uppercase tracking-[.16em] text-[#6a6560]">{label}</span>
        <span className="h-2 w-2 rounded-[2px]" style={{ background: color }} />
      </div>
      <div className="flex-1">
        <div className="flex items-end gap-2">
           <span className="font-display text-[32px] font-light leading-[.9]">{hasData ? `${completed}/${required}` : "—"}</span>
          <span className="mb-0.5 text-[9.5px] font-bold uppercase tracking-[.08em] text-[#6a6560]">{t("cohortDetail.modules.completedOf")}</span>
        </div>
        <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-[#eee8de]">
          <div className="h-full rounded-full" style={{ width: `${percentage}%`, background: color }} />
        </div>
        <div className="mt-2 text-[11px] leading-[1.5] text-[#6a6560]">
          {hasData
            ? t("cohortDetail.modules.detail", {
              leaders: completedLeaders ?? 0,
              totalLeaders: leaderCount ?? 0,
               due: due ?? 0,
            })
            : isNotApplicable
              ? t("cohortDetail.modules.notApplicable")
              : t("cohortDetail.modules.aggregateOnly")}
        </div>
      </div>
      <div className="border-t border-[#eee8de] pt-2.5 text-[10.5px] text-[#9a938a]">
         {hasData
           ? t("cohortDetail.modules.percent", { value: percentage })
           : isNotApplicable
             ? t("cohortDetail.modules.notApplicable")
             : t("cohortDetail.modules.notAvailable")}
      </div>
    </div>
  );
}

function AttentionSection({ kpis, counts, filter, onFilter, t }: { kpis: SponsorCohortSummary | null; counts: Record<FilterKey, number>; filter: FilterKey; onFilter: (filter: FilterKey) => void; t: (key: string) => string }) {
  const cards: { key: FilterKey; count: number; label: string; sub: string; color: string; border: string }[] = [
    { key: "attention", count: kpis?.at_risk_count ?? counts.attention, label: t("cohortDetail.attention.leaders"), sub: t("cohortDetail.attention.flagged"), color: "#a8341c", border: "#f0d5cc" },
    { key: "pace", count: kpis?.behind_count ?? counts.pace, label: t("cohortDetail.attention.behind"), sub: t("cohortDetail.attention.pace"), color: "#a8341c", border: "#f0d5cc" },
    { key: "coaching", count: counts.coaching, label: t("cohortDetail.attention.coaching"), sub: t("cohortDetail.attention.coachingSub"), color: "#a8541c", border: "#eddcc9" },
    { key: "learning", count: counts.learning, label: t("cohortDetail.attention.learning"), sub: t("cohortDetail.attention.learningSub"), color: "#a8541c", border: "#eddcc9" },
  ];
  return (
    <section className="mt-4 rounded-[14px] border p-[22px]" style={{ background: CARD, borderColor: LINE }}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-serif text-[17px] font-normal">{t("cohortDetail.attention.label")}</h2>
        <span className="text-[10.5px] text-[#9a938a]">{t("cohortDetail.attention.hint")}</span>
      </div>
      <div className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
        {cards.map((card) => (
          <button key={card.key} type="button" onClick={() => onFilter(card.key)} className="rounded-xl border p-[15px] text-left transition-colors hover:border-[#062f3e]" style={{ borderColor: card.border, background: filter === card.key ? "#fdf6f2" : "#fff" }}>
            <div className="flex items-center gap-2.5">
              <span className="font-display text-[26px] font-light leading-none" style={{ color: card.color }}>{card.count}</span>
              <span className="text-xs font-medium leading-[1.35]">{card.label}</span>
            </div>
            <div className="mt-2 text-[10.5px] text-[#9a938a]">{card.sub}</div>
          </button>
        ))}
      </div>
      <p className="mt-4 border-t border-[#eee8de] pt-3.5 text-[11.5px] leading-relaxed text-[#9a938a]">{t("cohortDetail.attention.note")}</p>
    </section>
  );
}

type SponsorJourneyCheckpoint = {
  checkpoint_number: number;
  due_on: string;
  label: string | null;
  module_scope: string[] | null;
  required_units: number;
  completed_units: number;
  completed_leaders: number;
  total_leaders: number;
  state: "upcoming" | "current" | "completed" | "overdue";
};

function ProgrammeJourney({ journey, t }: { journey: unknown; t: (key: string, options?: Record<string, unknown>) => string }) {
  const rawCheckpoints = Array.isArray(journey)
    ? journey.filter((item): item is SponsorJourneyCheckpoint => Boolean(
      item
      && typeof item === "object"
      && "checkpoint_number" in item
      && "due_on" in item
      && "state" in item
      && "required_units" in item
      && "completed_units" in item,
    ))
    : [];
  // One canonical checkpoint per due date comes from the backend (grouped in
  // SQL); the UI only orders it, never merges or re-derives checkpoints.
  const checkpoints = [...rawCheckpoints].sort((left, right) => left.due_on.localeCompare(right.due_on));
  return (
    <section className="mt-4 overflow-hidden rounded-[14px] border p-[22px]" style={{ background: CARD, borderColor: LINE }}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-serif text-[17px] font-normal">{t("cohortDetail.journey.label")}</h2>
        <span className="text-[10.5px] text-[#9a938a]">{t("cohortDetail.journey.privacyNote")}</span>
      </div>
      {checkpoints.length ? (
        <div className="mt-5 overflow-x-auto pb-2 [scrollbar-color:#cfc7bb_transparent]">
          <div className="relative min-w-[760px]">
            <ol className="relative grid auto-cols-[minmax(210px,1fr)] grid-flow-col items-stretch">
              {checkpoints.map((checkpoint) => {
                const color = journeyStateColor(checkpoint.state);
                return (
                  <li key={`${checkpoint.due_on}-${checkpoint.checkpoint_number}`} className="relative flex min-w-0 flex-col px-1.5">
                    <div className={`relative z-10 flex min-h-[260px] flex-1 flex-col rounded-xl border p-4 transition-colors ${checkpoint.state === "current" ? "border-[#8bd3e3] bg-[#f1fbfd] shadow-[0_8px_24px_rgba(44,143,168,.1)]" : "border-[#eee8de] bg-[#f6f3ee]"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[9px] font-bold uppercase tracking-[.15em]" style={{ color }}>{t(`cohortDetail.journey.states.${checkpoint.state}`)}</span>
                        <span className="shrink-0 text-right text-[10px] text-[#9a938a]">{formatDate(checkpoint.due_on)}</span>
                      </div>
                      <div className="mt-3 min-h-[34px] break-words text-[12px] font-semibold leading-[1.35] text-[#062f3e]">
                        {t("leaderDrawer.reference.checkpoint", { number: checkpoint.checkpoint_number })}
                      </div>
                      <div className="mt-3 flex flex-wrap content-start gap-1.5">
                        {(checkpoint.module_scope ?? []).map((module) => (
                          <span key={module} className="max-w-full rounded-full border border-[#d8e9ed] bg-white px-2 py-1 text-[9px] font-semibold leading-[1.25] text-[#2c8fa8]">
                            {moduleScopeLabelFor(module, t)}
                          </span>
                        ))}
                      </div>
                      <div className="mt-auto border-t border-[#e7e0d6] pt-3">
                        <div className="text-[15px] font-semibold leading-none text-[#062f3e]">{checkpoint.completed_units} / {checkpoint.required_units}</div>
                        <div className="mt-1 text-[9.5px] text-[#6a6560]">{t("cohortDetail.journey.cumulative")}</div>
                        <div className="mt-1 text-[9.5px] text-[#9a938a]">{t("cohortDetail.journey.leaders", { completed: checkpoint.completed_leaders, total: checkpoint.total_leaders })}</div>
                      </div>
                    </div>
                    <div className="relative mt-4 h-[36px] shrink-0">
                      <span className="absolute left-0 right-1/2 top-1/2 h-px bg-[#dcd5ca]" aria-hidden="true" />
                      <span className="absolute left-1/2 right-0 top-1/2 h-px bg-[#dcd5ca]" aria-hidden="true" />
                      <span className="absolute left-1/2 top-1/2 z-20 grid h-4 w-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[3px] bg-white" style={{ borderColor: color }} aria-hidden="true">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                      </span>
                      {checkpoint.state === "current"
                        ? <span className="absolute left-1/2 top-[22px] -translate-x-1/2 whitespace-nowrap rounded-full bg-[#e4f6fa] px-2 py-1 text-[9px] font-bold uppercase tracking-[.12em] text-[#2c8fa8]">{t("cohortDetail.journey.youAreHere")}</span>
                        : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      ) : (
        <p className="mt-5 rounded-xl border border-dashed border-[#ddd6cc] bg-[#f6f3ee] px-4 py-5 text-center text-[11px] leading-relaxed text-[#6a6560]">
          {t("cohortDetail.journey.notAvailable")}
        </p>
      )}
      <p className="mt-[18px] border-t border-[#eee8de] pt-3.5 text-[11.5px] leading-relaxed text-[#6a6560]">
        {t("cohortDetail.journey.aggregateNote")}
      </p>
    </section>
  );
}

function journeyStateColor(state: SponsorJourneyCheckpoint["state"]) {
  if (state === "completed") return GREEN;
  if (state === "overdue") return "#c9543a";
  if (state === "current") return SKY;
  return "#cfc7bb";
}

function ProgrammeDetails({ kpis, t }: { kpis: SponsorCohortSummary | null; t: (key: string, options?: Record<string, unknown>) => string }) {
  const groups = [
    { title: t("cohortDetail.details.enrollment"), rows: [
      [t("cohortDetail.details.enrolled"), value(kpis?.enrollment_count)],
      [t("cohortDetail.details.active"), value(kpis?.active_count)],
      [t("cohortDetail.details.paused"), value(kpis?.paused_count)],
      [t("cohortDetail.details.completed"), value(kpis?.completed_count)],
      [t("cohortDetail.details.startEnd"), `${formatDate(kpis?.programme_start_date)} — ${formatDate(kpis?.programme_end_date)}`],
    ]},
    { title: t("cohortDetail.details.coaching"), rows: [
       [t("cohortDetail.modules.coaching"), moduleDetail(kpis?.coaching_completed_units, kpis?.coaching_due_units, kpis?.coaching_required_units)],
      [t("cohortDetail.details.satisfaction"), decimal(kpis?.satisfaction_avg)],
    ]},
    { title: t("cohortDetail.details.training"), rows: [
       [t("cohortDetail.modules.training"), moduleDetail(kpis?.training_completed_units, kpis?.training_due_units, kpis?.training_required_units)],
      [t("cohortDetail.details.completion"), percent(kpis?.full_completion_pct)],
    ]},
    { title: t("cohortDetail.details.peerMentoringTriads"), rows: [
       [t("cohortDetail.modules.peer"), moduleDetail(kpis?.peer_completed_units, kpis?.peer_due_units, kpis?.peer_required_units)],
       [t("cohortDetail.modules.mentoring"), moduleDetail(kpis?.mentoring_completed_units, kpis?.mentoring_due_units, kpis?.mentoring_required_units)],
       [t("cohortDetail.modules.triads"), moduleDetail(kpis?.triad_completed_units, kpis?.triad_due_units, kpis?.triad_required_units)],
    ]},
    { title: t("cohortDetail.details.programme"), rows: [
      [t("cohortDetail.details.requiredUnits"), value(kpis?.required_units)],
      [t("cohortDetail.details.completedUnits"), value(kpis?.completed_units)],
      [t("cohortDetail.details.dueUnits"), value(kpis?.due_units)],
      [t("cohortDetail.details.overdueUnits"), value(kpis?.overdue_units)],
      [t("cohortDetail.details.completion"), percent(kpis?.full_completion_pct)],
    ]},
  ];
  return (
    <>
      <div className="mt-5 grid gap-[22px] [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
        {groups.map((group) => (
          <div key={group.title}>
            <div className="text-[9.5px] font-bold uppercase tracking-[.16em] text-[#9a938a]">{group.title}</div>
            <div className="mt-3">
              {group.rows.map(([label, rowValue]) => <div key={label} className="flex items-baseline justify-between gap-3 border-t border-[#eee8de] py-2"><span className="text-[11.5px] text-[#6a6560]">{label}</span><span className="text-right text-xs font-semibold">{rowValue}</span></div>)}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-5 border-t border-[#eee8de] pt-3.5 text-[11.5px] leading-relaxed text-[#9a938a]">{t("cohortDetail.details.withheld")}</p>
    </>
  );
}

function RosterSection({ rows, allRows, filter, counts, sortKey, sortDir, onFilter, onSort, onSelect, t }: {
  rows: SponsorRosterRow[];
  allRows: SponsorRosterRow[];
  filter: FilterKey;
  counts: Record<FilterKey, number>;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onFilter: (filter: FilterKey) => void;
  onSort: (sort: SortKey) => void;
  onSelect: (row: SponsorRosterRow) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const filters: { key: FilterKey; label: string }[] = [
    { key: "all", label: t("cohortDetail.filters.all", { count: counts.all }) },
    { key: "attention", label: t("cohortDetail.filters.attention", { count: counts.attention }) },
    { key: "pace", label: t("cohortDetail.filters.pace", { count: counts.pace }) },
    { key: "coaching", label: t("cohortDetail.filters.coaching", { count: counts.coaching }) },
    { key: "learning", label: t("cohortDetail.filters.learning", { count: counts.learning }) },
  ];
  const columns: { key: SortKey; label: string }[] = [
    { key: "name", label: t("dashboard.roster.columns.leader") },
    { key: "coaching", label: t("cohortDetail.modules.coaching") },
    { key: "training", label: t("cohortDetail.modules.training") },
    { key: "peer", label: t("cohortDetail.modules.peer") },
    { key: "mentoring", label: t("cohortDetail.modules.mentoring") },
    { key: "triads", label: t("cohortDetail.modules.triads") },
    { key: "status", label: t("dashboard.roster.columns.status") },
  ];
  return (
    <section className="mt-4 rounded-[14px] border p-[22px]" style={{ background: CARD, borderColor: LINE }}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-serif text-[17px] font-normal">{t("cohortDetail.reference.roster")}</h2>
        <span className="text-[10.5px] text-[#9a938a]">{rows.length} {t("cohortDetail.reference.of")} {allRows.length} {t("cohortDetail.reference.leaders")}</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {filters.map((item) => <button key={item.key} type="button" onClick={() => onFilter(item.key)} className={`rounded-full border px-3.5 py-1.5 text-[11.5px] font-semibold transition-colors ${filter === item.key ? "border-[#062f3e] bg-[#062f3e] text-white" : "border-[#cfc7bb] bg-transparent text-[#062f3e] hover:border-[#062f3e]"}`}>{item.label}</button>)}
      </div>
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[860px]">
          <div className="grid grid-cols-[minmax(0,1.5fr)_repeat(5,minmax(0,1fr))_108px] gap-3 border-b border-[#e6e0d6] px-1.5 pb-2.5">
            {columns.map((column) => <button key={column.key} type="button" onClick={() => onSort(column.key)} className={`justify-self-start text-left text-[9.5px] font-bold uppercase tracking-[.14em] ${sortKey === column.key ? "text-[#062f3e]" : "text-[#9a938a]"}`}>{column.label}{sortKey === column.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button>)}
          </div>
          {rows.map((row) => {
            const values = moduleValues(row);
            return (
              <button key={row.enrollment_id} type="button" onClick={() => onSelect(row)} className={`grid w-full grid-cols-[minmax(0,1.5fr)_repeat(5,minmax(0,1fr))_108px] items-center gap-3 border-b border-[#eee8de] px-1.5 py-[11px] text-left transition-colors hover:bg-[#f2ede4] ${matchesFilter(row, "attention") ? "bg-[#fdf6f2]" : ""}`}>
                <span className="flex min-w-0 items-center gap-2.5"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e4f3f7] text-[10px] font-bold text-[#2c8fa8]">{initials(row.learner_display_name)}</span><span className="truncate text-[13px] font-medium">{row.learner_display_name}</span></span>
                {values.map((cell) => <RosterMetric key={cell.key} value={cell.value} text={cell.text} color={cell.color} />)}
                <Pill tone={STATUS_TONE[effectiveSponsorStatus(row)]} className="w-fit text-[9.5px] uppercase tracking-[.08em]">{t(`status.${STATUS_LABEL_KEY[effectiveSponsorStatus(row)]}`)}</Pill>
              </button>
            );
          })}
          {rows.length === 0 && <div className="py-10 text-center text-xs text-[#6a6560]">{t("cohortDetail.filters.empty")}</div>}
        </div>
      </div>
      <p className="mt-4 text-[11.5px] leading-relaxed text-[#9a938a]">{t("cohortDetail.rosterNote")}</p>
    </section>
  );
}

function RosterMetric({ value, text, color }: { value: number | null; text: string; color: string }) {
  return <span className="flex min-w-0 items-center gap-2"><span className="min-w-[26px] flex-1 overflow-hidden rounded-full bg-[#eee8de]"><span className="block h-[5px] rounded-full" style={{ width: `${value == null ? 0 : Math.max(8, Math.min(100, value))}%`, background: color }} /></span><span className="w-9 text-right text-[11px] text-[#6a6560]">{text}</span></span>;
}

function moduleValues(row: SponsorRosterRow) {
  return [
    { key: "coaching", value: modulePct(row.coaching_completed_units, row.coaching_required_units), text: moduleCount(row.coaching_completed_units, row.coaching_required_units), color: SKY },
    { key: "training", value: modulePct(row.training_completed_units, row.training_required_units), text: moduleCount(row.training_completed_units, row.training_required_units), color: NAVY },
    { key: "peer", value: modulePct(row.peer_completed_units, row.peer_required_units), text: moduleCount(row.peer_completed_units, row.peer_required_units), color: TEAL },
    { key: "mentoring", value: modulePct(row.mentoring_completed_units, row.mentoring_required_units), text: moduleCount(row.mentoring_completed_units, row.mentoring_required_units), color: GREEN },
    { key: "triads", value: modulePct(row.triad_completed_units, row.triad_required_units), text: moduleCount(row.triad_completed_units, row.triad_required_units), color: PLUM },
  ];
}

function moduleMetric(row: SponsorRosterRow, key: SortKey) {
  if (key === "training") return row.training_completed_units ?? 0;
  if (key === "coaching") return row.coaching_completed_units ?? 0;
  if (key === "peer") return row.peer_completed_units ?? 0;
  if (key === "mentoring") return row.mentoring_completed_units ?? 0;
  if (key === "triads") return row.triad_completed_units ?? 0;
  return 0;
}

function matchesFilter(row: SponsorRosterRow, filter: FilterKey) {
  if (filter === "all") return true;
  if (filter === "attention") return effectiveSponsorStatus(row) === "at_risk" || row.pace_status === "behind" || !moduleComplete(row.coaching_completed_units, row.coaching_required_units) || !moduleComplete(row.training_completed_units, row.training_required_units);
  if (filter === "pace") return row.pace_status === "behind";
  if (filter === "coaching") return !moduleComplete(row.coaching_completed_units, row.coaching_required_units);
  return !moduleComplete(row.training_completed_units, row.training_required_units);
}

function programmeStatus(kpis: SponsorCohortSummary | null) {
  return cohortLifecycleStatus(kpis?.programme_start_date ?? null, kpis?.programme_end_date ?? null);
}

function statusClass(status: string) {
  if (status === "complete") return "bg-[#eee8de] text-[#5a5550]";
  if (status === "upcoming") return "bg-[#e4f3f7] text-[#2c8fa8]";
  return "bg-[#e3f2e9] text-[#17663f]";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function value(value: number | null | undefined) {
  return value == null ? "—" : String(value);
}

function moduleCount(completed: number | null | undefined, required: number | null | undefined) {
  return completed == null || required == null || required === 0 ? "—" : `${completed}/${required}`;
}

function modulePct(completed: number | null | undefined, required: number | null | undefined) {
  return completed == null || required == null || required === 0 ? null : Math.round((completed / required) * 100);
}

function moduleComplete(completed: number | null | undefined, required: number | null | undefined) {
  return required == null || required === 0 || (completed ?? 0) >= required;
}

function moduleDetail(completed: number | null | undefined, due: number | null | undefined, required: number | null | undefined) {
  if (completed == null || due == null || required == null || required === 0) return "—";
  return `${completed}/${required} complete · ${due} due so far`;
}

function percent(value: number | null | undefined) {
  return value == null ? "—" : `${Math.round(value)}%`;
}

function decimal(value: number | null | undefined) {
  return value == null ? "—" : value.toFixed(2);
}

function SuppressedState({ min }: { min: number }) {
  const thresholdCopy = min > 0
    ? `This cohort has fewer than ${min} leaders. A detailed breakdown could identify individuals, so Clariva shows only privacy-safe rolled-up totals.`
    : "A detailed breakdown could identify individuals, so Clariva shows only privacy-safe rolled-up totals.";
  return (
    <section className="mt-6 rounded-[18px] border border-dashed border-[#d6cfc4] bg-[#f6f3ee] p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[#ede9e1] text-[#6a6560]"><LockKeyhole className="h-4 w-4" /></span>
        <div>
          <h2 className="font-serif text-[21px] font-normal">Cohort detail is withheld</h2>
          <p className="mt-2 max-w-[58ch] text-[12.5px] leading-relaxed text-[#6a6560]">{thresholdCopy}</p>
        </div>
      </div>
    </section>
  );
}