import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Pill } from "@/pages/admin/_shared";
import type { SponsorRosterRow } from "@/hooks/sponsor/useSponsorDashboardData";
import { STATUS_LABEL_KEY, STATUS_TONE, cohortLifecycleStatus, effectiveSponsorStatus, initials, storedSponsorStatus } from "./sponsorUtils";
import { SponsorFlagDialog } from "./SponsorFlagDialog";

const CARD = "#fffdf9";
const LINE = "#e6e0d6";
const NAVY = "#062f3e";
const SKY = "#3db4d0";
const TEAL = "#2c8fa8";
const GREEN = "#17663f";
const AMBER = "#a8541c";
const RED = "#a8341c";

const WITHHELD_KEYS = ["sessionNotes", "chatMessages", "reflections", "goalWording", "coachIdentity"] as const;

interface Props {
  leader: SponsorRosterRow | null;
  onClose: () => void;
}

export function SponsorLeaderDrawer({ leader, onClose }: Props) {
  const { t } = useTranslation("sponsor");
  if (!leader) return null;

  return (
    <Sheet open={!!leader} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto border-l border-[#e6dfd4] bg-[#f6f3ee] p-0">
        <SheetTitle className="sr-only">{leader.learner_display_name} — {t("leaderDrawer.srLabelSuffix")}</SheetTitle>
        <SheetDescription className="sr-only">{t("leaderDrawer.description")}</SheetDescription>
        <SponsorLeaderProfile leader={leader} onBack={onClose} />
      </SheetContent>
    </Sheet>
  );
}

export function SponsorLeaderProfile({ leader, onBack }: { leader: SponsorRosterRow; onBack: () => void }) {
  const { t } = useTranslation("sponsor");
  const completion = clamp(leader.full_completion_pct ?? 0);
  const adherence = clamp(leader.due_adherence_pct ?? 0);
  const attention = attentionItems(leader, t);
  const effectiveStatus = effectiveSponsorStatus(leader);
  const storedStatus = storedSponsorStatus(leader);
  const effectiveStatusKey = STATUS_LABEL_KEY[effectiveStatus];
  const storedStatusKey = STATUS_LABEL_KEY[storedStatus];
  const lifecycle = cohortLifecycleStatus(leader.programme_start_date, leader.programme_end_date);

  return (
    <div className="min-h-full overflow-hidden bg-[#f6f3ee]" style={{ color: NAVY }}>
      <div className="mx-auto max-w-[1180px] px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#6a6560] transition-colors hover:text-[#062f3e]">
          <ArrowLeft className="h-3.5 w-3.5" /> {t("leaderDrawer.backToRoster")}
        </button>

        <header className="mt-[14px] flex flex-wrap items-center justify-between gap-6 rounded-[16px] bg-[#062f3e] px-6 py-[26px] text-white sm:px-7">
          <div className="flex min-w-0 items-center gap-[18px]">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-[16px] bg-white/15 text-lg font-semibold">{initials(leader.learner_display_name)}</div>
            <div className="min-w-0">
              <div className="text-[9.5px] font-bold uppercase tracking-[.24em] text-[#3db4d0]">{t("leaderDrawer.reference.eyebrow")}</div>
              <h1 className="mt-1.5 truncate font-serif text-[27px] font-normal leading-tight tracking-[-.02em]">{leader.learner_display_name}</h1>
              <p className="mt-1.5 truncate text-xs text-white/60">{leader.programme_label} · {leader.cohort_label || "—"}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <HeaderMeta label={t("leaderDrawer.reference.sponsorStatus")} value={t(`status.${effectiveStatusKey}`)} />
            <HeaderMeta label={t("leaderDrawer.reference.recordedStatus")} value={t(`status.${storedStatusKey}`)} />
            <HeaderMeta label={t("leaderDrawer.reference.dates")} value={`${formatDate(leader.enrollment_start_date)} – ${formatDate(leader.enrollment_end_date)}`} />
            <Pill tone={STATUS_TONE[effectiveStatus]} className="text-[10px] uppercase tracking-[.1em]">{t(`status.${effectiveStatusKey}`)}</Pill>
          </div>
        </header>

        <h2 className="sr-only">{t("leaderDrawer.overview")}</h2>
        <div className="mt-4 grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
          <LeaderKpi label={t("leaderDrawer.reference.overallCompletion")} value={percent(completion)} color={NAVY} />
          <LeaderKpi label={t("leaderDrawer.reference.activitiesCompleted")} value={`${leader.completed_units} / ${leader.required_units}`} color={NAVY} />
          <LeaderKpi label={t("leaderDrawer.reference.coachingSessions")} value={countValue(leader.coaching_completed_units)} color={NAVY} />
          <LeaderKpi label={t("leaderDrawer.reference.goalProgress")} value={leader.goal_progress_pct == null ? "—" : percent(leader.goal_progress_pct)} color={TEAL} />
          <LeaderKpi label={t("leaderDrawer.reference.satisfaction")} value={leader.satisfaction_avg == null ? "—" : leader.satisfaction_avg.toFixed(1)} color={GREEN} />
          <LeaderKpi label={t("leaderDrawer.reference.overdue")} value={String(leader.overdue_units ?? 0)} color={RED} />
        </div>

        <JourneySection status={lifecycle} start={leader.programme_start_date} end={leader.programme_end_date} t={t} />

        <div className="mt-4 grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
          <ProgressParticipation leader={leader} completion={completion} adherence={adherence} t={t} />
          <ModuleParticipation leader={leader} t={t} />
        </div>

        <div className="mt-4 grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
          <GoalsActions leader={leader} t={t} />
          <RatingCard leader={leader} t={t} />
        </div>

        <AttentionSection leader={leader} items={attention} t={t} />

        <section className="mt-4 flex items-start gap-4 rounded-[14px] border border-dashed border-[#ddd6cc] px-[22px] py-[18px]">
          <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg bg-[#e4f3f7] text-xs font-bold text-[#2c8fa8]">◔</span>
          <div>
            <div className="text-xs font-semibold">{t("leaderDrawer.reference.confidentialityTitle")}</div>
            <p className="mt-1.5 max-w-[84ch] text-[11.5px] leading-[1.6] text-[#6a6560]">{t("leaderDrawer.reference.confidentialityBody")}</p>
          </div>
        </section>

        <section className="mt-4 rounded-[14px] border border-[#3db4d0]/25 bg-[#e4f5fa]/55 p-[22px]">
          <div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#2c8fa8]" /><p className="text-[11px] font-bold uppercase tracking-[.16em]">{t("leaderDrawer.canSeeTitle")}</p></div>
          <p className="mb-3 text-[11px] leading-relaxed text-[#6a6560]">{t("leaderDrawer.withheldIntro")}</p>
          <ul className="grid gap-2 sm:grid-cols-2">{WITHHELD_KEYS.map((key) => <li key={key} className="flex items-start gap-2 text-[10px] text-[#6a6560]"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#d6cfc4]" />{t(`leaderDrawer.withheld.${key}`)}</li>)}</ul>
          <p className="mt-4 text-[10px] italic text-[#6a6560]">{t("leaderDrawer.sameViewNote")}</p>
        </section>
      </div>
    </div>
  );
}

function HeaderMeta({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[9px] font-bold uppercase tracking-[.16em] text-white/40">{label}</div><div className="mt-1.5 text-[13px] font-medium">{value}</div></div>;
}

function LeaderKpi({ label, value, color }: { label: string; value: string; color: string }) {
  return <div className="rounded-[14px] border p-[18px]" style={{ background: CARD, borderColor: LINE }}><div className="font-display text-[32px] font-light leading-none" style={{ color }}>{value}</div><div className="mt-[11px] text-[9.5px] font-bold uppercase tracking-[.16em] text-[#6a6560]">{label}</div></div>;
}

function JourneySection({ status, start, end, t }: { status: "upcoming" | "active" | "complete"; start: string | null; end: string | null; t: (key: string, options?: Record<string, unknown>) => string }) {
  return (
    <section className="mt-4 rounded-[14px] border p-[22px]" style={{ background: CARD, borderColor: LINE }}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div><h2 className="font-serif text-[19px] font-normal">{t("leaderDrawer.reference.journeyTitle")}</h2><p className="mt-1.5 text-[11.5px] text-[#9a938a]">{t("leaderDrawer.reference.journeySubtitle")}</p></div>
        <span className="rounded-full bg-[#e4f3f7] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.1em] text-[#2c8fa8]">{t(`cohortDetail.programmeDetails.status.${status}`)}</span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <JourneyMeta label={t("cohortDetail.details.startEnd")} value={`${formatDate(start)} – ${formatDate(end)}`} />
        <JourneyMeta label={t("leaderDrawer.reference.journeySource")} value={t("leaderDrawer.reference.journeySourceValue")} />
      </div>
      <p className="mt-4 rounded-xl border border-dashed border-[#ddd6cc] bg-[#f6f3ee] px-4 py-4 text-[11px] leading-relaxed text-[#6a6560]">{t("leaderDrawer.reference.journeyWithheld")}</p>
    </section>
  );
}

function JourneyMeta({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-[#eee8de] bg-[#f6f3ee] px-3.5 py-3"><div className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[#9a938a]">{label}</div><div className="mt-1.5 text-[11.5px] font-semibold text-[#062f3e]">{value}</div></div>;
}

function ProgressParticipation({ leader, completion, adherence, t }: { leader: SponsorRosterRow; completion: number; adherence: number; t: (key: string) => string }) {
  return (
    <section className="rounded-[14px] border p-[22px]" style={{ background: CARD, borderColor: LINE }}>
      <span className="sr-only">{t("leaderDrawer.participation.title")}</span>
      <h2 className="font-serif text-[17px] font-normal">{t("leaderDrawer.reference.progressTitle")}</h2>
      <div className="mt-[18px] flex flex-col gap-3.5"><ProgressRow label={t("leaderDrawer.progress.completion")} value={percent(completion)} pct={completion} color={NAVY} /><ProgressRow label={t("leaderDrawer.progress.adherence")} value={leader.due_adherence_pct == null ? "—" : percent(adherence)} pct={adherence} color={TEAL} empty={leader.due_adherence_pct == null} /></div>
      <div className="mt-[18px] flex gap-7 border-t border-[#eee8de] pt-4"><SmallMetric value={`${leader.due_units} / ${leader.required_units}`} label={t("leaderDrawer.reference.activitiesDue")} /><SmallMetric value={String(leader.overdue_units)} label={t("leaderDrawer.reference.overdue")} color={RED} /></div>
      <div className="mt-[18px] border-t border-[#eee8de] pt-4"><div className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[#9a938a]">{t("leaderDrawer.reference.trendTitle")}</div><UnavailableTrend text={t("leaderDrawer.reference.trendWithheld")} /></div>
    </section>
  );
}

function ModuleParticipation({ leader, t }: { leader: SponsorRosterRow; t: (key: string, options?: Record<string, unknown>) => string }) {
  const modules = [
    { key: "coaching", label: t("cohortDetail.modules.coaching"), completed: leader.coaching_completed_units, required: leader.coaching_required_units, due: leader.coaching_due_units, color: SKY },
    { key: "training", label: t("cohortDetail.modules.training"), completed: leader.training_completed_units, required: leader.training_required_units, due: leader.training_due_units, color: NAVY },
    { key: "peer", label: t("cohortDetail.modules.peer"), completed: leader.peer_completed_units, required: leader.peer_required_units, due: leader.peer_due_units, color: TEAL },
    { key: "mentoring", label: t("cohortDetail.modules.mentoring"), completed: leader.mentoring_completed_units, required: leader.mentoring_required_units, due: leader.mentoring_due_units, color: GREEN },
    { key: "triads", label: t("cohortDetail.modules.triads"), completed: leader.triad_completed_units, required: leader.triad_required_units, due: leader.triad_due_units, color: AMBER },
  ];
  return (
    <section className="rounded-[14px] border p-[22px]" style={{ background: CARD, borderColor: LINE }}>
      <div className="flex items-baseline justify-between gap-2.5"><h2 className="font-serif text-[17px] font-normal">{t("leaderDrawer.reference.moduleProgress")}</h2><span className="text-[10.5px] text-[#9a938a]">{t("leaderDrawer.reference.aggregateOnly")}</span></div>
      <div className="mt-5 flex flex-col gap-4">
        {modules.map((module) => {
          const pct = modulePct(module.completed, module.required);
          return (
            <div key={module.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[11.5px] font-medium text-[#062f3e]">{module.label}</span>
                <span className="text-[10.5px] text-[#6a6560]">{moduleCount(module.completed, module.required)}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#eee8de]">
                <div className="h-full rounded-full" style={{ width: `${pct ?? 0}%`, background: module.color }} />
              </div>
              <div className="mt-1 text-[9.5px] text-[#9a938a]">
                {module.due == null ? t("leaderDrawer.reference.notAvailable") : t("leaderDrawer.reference.dueUnits", { count: module.due })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-[18px] rounded-[10px] bg-[#e4f3f7] px-[15px] py-[13px] text-[11px] leading-relaxed text-[#6a6560]">{t("leaderDrawer.reference.attendanceOnly")}</div>
    </section>
  );
}

function GoalsActions({ leader, t }: { leader: SponsorRosterRow; t: (key: string) => string }) {
  return <section className="rounded-[14px] border p-[22px]" style={{ background: CARD, borderColor: LINE }}><div className="flex items-baseline justify-between gap-2.5"><h2 className="font-serif text-[17px] font-normal">{t("leaderDrawer.reference.goalsTitle")}</h2><span className="text-[10.5px] text-[#9a938a]">{t("leaderDrawer.reference.progressOnly")}</span></div><div className="mt-5 flex flex-wrap gap-x-[34px] gap-y-5"><SmallMetric value={countValue(leader.goal_count)} label={t("leaderDrawer.reference.goalsSet")} /><SmallMetric value={leader.goal_progress_pct == null ? "—" : percent(leader.goal_progress_pct)} label={t("leaderDrawer.reference.averageGoalProgress")} color={TEAL} /><SmallMetric value={`${leader.completed_action_count} / ${leader.total_action_count}`} label={t("leaderDrawer.reference.actionsCompleted")} /></div><div className="mt-5 border-t border-[#eee8de] pt-4"><div className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[#9a938a]">{t("leaderDrawer.reference.goalTrend")}</div><UnavailableTrend text={t("leaderDrawer.reference.trendWithheld")} /></div><p className="mt-4 text-[11px] leading-relaxed text-[#9a938a]">{t("leaderDrawer.reference.goalPrivacy")}</p></section>;
}

function RatingCard({ leader, t }: { leader: SponsorRosterRow; t: (key: string, options?: Record<string, unknown>) => string }) {
  return <section className="flex flex-col rounded-[14px] border p-[22px]" style={{ background: CARD, borderColor: LINE }}><h2 className="font-serif text-[17px] font-normal">{t("leaderDrawer.reference.ratingTitle")}</h2><div className="mt-5 flex items-end gap-4"><div className="font-serif text-[52px] font-light leading-[.9]">{leader.satisfaction_avg == null ? "—" : leader.satisfaction_avg.toFixed(1)}</div><div className="pb-1.5"><div className="text-[13px] text-[#6a6560]">{t("leaderDrawer.reference.outOfFive")}</div><div className="mt-0.5 text-[11.5px] text-[#9a938a]">{t("leaderDrawer.reference.responses", { count: leader.satisfaction_rated_count })}</div></div></div><UnavailableTrend text={leader.satisfaction_avg == null ? t("leaderDrawer.satisfaction.none") : t("leaderDrawer.reference.ratingTrendWithheld")} /><p className="mt-auto pt-4 text-[11px] leading-relaxed text-[#9a938a]">{t("leaderDrawer.reference.ratingPrivacy")}</p></section>;
}

function AttentionSection({ leader, items, t }: { leader: SponsorRosterRow; items: string[]; t: (key: string, options?: Record<string, unknown>) => string }) {
  return <section className="mt-4 rounded-[14px] border p-[22px]" style={{ background: CARD, borderColor: LINE }}><span className="sr-only">{t("leaderDrawer.attention.title")}</span><div className="flex flex-wrap items-baseline justify-between gap-3"><h2 className="font-serif text-[17px] font-normal">{t("leaderDrawer.reference.attentionTitle")}</h2><span className="rounded-full bg-[#fbeade] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.1em] text-[#a8541c]">{t("leaderDrawer.reference.attentionCount", { count: items.length })}</span></div><div className="mt-4 flex flex-col gap-2.5">{items.length ? items.map((item) => <div key={item} className="flex items-center gap-3.5 rounded-[10px] border border-[#f0d5cc] bg-[#fdf6f2] px-4 py-3.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#a8341c]" /><div className="min-w-0 text-[13px] font-semibold">{item}</div><SponsorFlagDialog subject={leader.learner_display_name} className="ml-auto shrink-0 rounded-full border border-[#cfc7bb] bg-transparent px-[15px] py-2 text-[11.5px] font-semibold text-[#062f3e]" /></div>) : <p className="flex items-center gap-2 text-[11px] text-[#6a6560]"><CheckCircle2 className="h-3.5 w-3.5 text-[#17663f]" />{t("leaderDrawer.attention.none")}</p>}</div></section>;
}

function ProgressRow({ label, value, pct, color, empty = false }: { label: string; value: string; pct: number; color: string; empty?: boolean }) {
  return <div><div className="flex items-baseline justify-between gap-2.5"><span className="text-xs text-[#6a6560]">{label}</span><span className="font-serif text-xl font-light" style={{ color }}>{value}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#eee8de]"><div className="h-full rounded-full" style={{ width: `${empty ? 0 : clamp(pct)}%`, background: color }} /></div></div>;
}

function SmallMetric({ label, value, color = NAVY }: { label: string; value: string; color?: string }) {
  return <div><div className="font-serif text-[22px] font-light leading-none" style={{ color }}>{value}</div><div className="mt-1.5 text-[9.5px] font-bold uppercase tracking-[.14em] text-[#9a938a]">{label}</div></div>;
}

function UnavailableTrend({ text }: { text: string }) {
  return <div className="mt-3 flex min-h-[56px] items-center justify-center rounded-lg border border-dashed border-[#ddd6cc] bg-[#f6f3ee] px-3 text-center text-[10.5px] leading-relaxed text-[#9a938a]"><LockKeyhole className="mr-2 h-3.5 w-3.5 shrink-0" />{text}</div>;
}

function attentionItems(leader: SponsorRosterRow, t: (key: string, options?: Record<string, unknown>) => string) {
  return [
    effectiveSponsorStatus(leader) === "at_risk" ? t("leaderDrawer.attention.atRisk") : null,
    leader.overdue_units > 0 ? t("leaderDrawer.attention.overdue", { count: leader.overdue_units }) : null,
    leader.open_action_count > 0 ? t("leaderDrawer.attention.actions", { count: leader.open_action_count }) : null,
    leader.due_adherence_pct != null && leader.due_adherence_pct < 70 && leader.due_units > 0 ? t("leaderDrawer.attention.adherence") : null,
  ].filter((item): item is string => Boolean(item));
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function percent(value: number | null | undefined) {
  return value == null ? "—" : `${Math.round(value)}%`;
}

function countValue(value: number | null | undefined) {
  return value == null ? "—" : String(value);
}

function moduleCount(completed: number | null | undefined, required: number | null | undefined) {
  return completed == null || required == null ? "—" : `${completed}/${required}`;
}

function modulePct(completed: number | null | undefined, required: number | null | undefined) {
  return completed == null || required == null || required === 0 ? null : clamp((completed / required) * 100);
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}