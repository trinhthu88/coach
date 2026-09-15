import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Flag,
  LockKeyhole,
  ShieldCheck,
  Target,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Pill } from "@/pages/admin/_shared";
import type { SponsorRosterRow } from "@/hooks/sponsor/useSponsorDashboardData";
import { STATUS_LABEL_KEY, STATUS_TONE, initials } from "./sponsorUtils";
import { SponsorFlagDialog } from "./SponsorFlagDialog";

const CARD = "#fffdf9";
const LINE = "#e6e0d6";
const NAVY = "#062f3e";

const WITHHELD_KEYS = [
  "sessionNotes",
  "chatMessages",
  "reflections",
  "goalWording",
  "coachIdentity",
] as const;

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
  const coverage = clamp(leader.schedule_coverage_pct ?? 0);
  const attentionItems = [
    leader.enrollment_status === "at_risk" ? t("leaderDrawer.attention.atRisk") : null,
    leader.overdue_units > 0 ? t("leaderDrawer.attention.overdue", { count: leader.overdue_units }) : null,
    leader.open_action_count > 0 ? t("leaderDrawer.attention.actions", { count: leader.open_action_count }) : null,
    adherence < 70 && leader.due_units > 0 ? t("leaderDrawer.attention.adherence") : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <div className="sponsor-detail-page min-h-full overflow-hidden bg-[#f6f3ee]" style={{ color: NAVY }}>
      <div className="mx-auto max-w-[1180px] px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#6a6560] transition-colors hover:text-[#062f3e]">
          <ArrowLeft className="h-3.5 w-3.5" /> {t("leaderDrawer.backToRoster")}
        </button>

        <header className="mt-4 flex flex-wrap items-center justify-between gap-5 rounded-[16px] bg-[#062f3e] px-6 py-[26px] text-white sm:px-7">
          <div className="flex min-w-0 items-center gap-[18px]">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-[16px] bg-white/15 text-lg font-semibold">{initials(leader.learner_display_name)}</div>
            <div className="min-w-0">
              <h1 className="truncate font-serif text-[26px] font-normal leading-tight tracking-[-.02em]">{leader.learner_display_name}</h1>
              <p className="mt-1.5 truncate text-xs text-white/60">{leader.cohort_label || "—"} · {leader.programme_label} · {formatDate(leader.enrollment_start_date)} — {leader.enrollment_end_date ? formatDate(leader.enrollment_end_date) : t("leaderDrawer.ongoing")}</p>
              <Pill tone={STATUS_TONE[leader.enrollment_status]} className="mt-2.5 text-[9.5px] uppercase tracking-[.1em]">
                {t(`status.${STATUS_LABEL_KEY[leader.enrollment_status]}`)}
              </Pill>
            </div>
          </div>
          <SponsorFlagDialog
            subject={leader.learner_display_name}
            className="rounded-full border-0 bg-[#3db4d0] px-5 py-[11px] text-xs font-semibold text-[#062f3e] transition-transform hover:-translate-y-0.5"
          />
        </header>

        <section className="mt-4">
          <SectionHeading label="At a glance" icon={Target} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <LeaderKpi label={t("leaderDrawer.kpis.completion")} value={`${Math.round(completion)}%`} sub={`${leader.completed_units} / ${leader.required_units}`} />
            <LeaderKpi label={t("leaderDrawer.kpis.adherence")} value={leader.due_adherence_pct == null ? "—" : `${Math.round(adherence)}%`} sub={paceLabel(leader.pace_status)} />
            <LeaderKpi label={t("leaderDrawer.kpis.sessions")} value={`${leader.completed_units}`} sub={t("leaderDrawer.kpis.sessionsSub", { total: leader.required_units })} />
            <LeaderKpi label={t("leaderDrawer.kpis.satisfaction")} value={leader.satisfaction_avg == null ? "—" : leader.satisfaction_avg.toFixed(1)} sub={t("leaderDrawer.kpis.ratings", { count: leader.satisfaction_rated_count })} />
          </div>
        </section>

        <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)]">
          <section className="rounded-[14px] border p-[22px]" style={{ background: CARD, borderColor: LINE }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2.5">
              <h2 className="font-serif text-[17px] font-normal">Pace vs. plan</h2>
              <div className="flex gap-3.5 text-[10.5px] text-[#6a6560]"><Legend color="#cfc7bb" label="Planned" /><Legend color={NAVY} label="Actual" /></div>
            </div>
            <PaceBars completed={leader.completed_units} due={leader.due_units} required={leader.required_units} />
            <p className="mt-4 border-t border-[#eee8de] pt-3.5 text-[11px] leading-relaxed text-[#6a6560]">
              The pace view uses completed and due units from the sponsor-safe enrollment summary. Private session content is never included.
            </p>
          </section>

          <section className="rounded-[14px] border p-[22px]" style={{ background: CARD, borderColor: LINE }}>
            <SectionHeading label="Programme journey" icon={Activity} />
            <Journey start={leader.enrollment_start_date} end={leader.enrollment_end_date} completed={leader.completed_units} status={leader.enrollment_status} />
            <div className="mt-5 space-y-3.5">
              <ProgressLine label={t("leaderDrawer.progress.completion")} pct={completion} />
              <ProgressLine label={t("leaderDrawer.progress.adherence")} pct={adherence} tone="green" empty={leader.due_adherence_pct == null} />
              <ProgressLine label={t("leaderDrawer.progress.coverage")} pct={coverage} tone="navy" />
              <ProgressLine label={t("leaderDrawer.progress.goal")} pct={leader.goal_progress_pct ?? 0} tone="amber" empty={leader.goal_progress_pct == null} />
            </div>
          </section>
        </div>

        <section className="mt-4 rounded-[14px] border p-[22px]" style={{ background: CARD, borderColor: LINE }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2.5">
            <h2 className="font-serif text-[17px] font-normal">Week by week</h2>
            <span className="text-[10.5px] text-[#9a938a]">Aggregate detail only</span>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-[#9a938a]">
            Weekly module completion and reflection content are withheld from sponsor accounts. The safe summary above reports the current aggregate signal.
          </p>
          <div className="mt-4 flex items-center gap-3 rounded-[10px] border border-dashed border-[#d6cfc4] bg-[#f6f3ee] p-4 text-[11px] text-[#6a6560]">
            <LockKeyhole className="h-4 w-4 shrink-0 text-[#9a938a]" /> {t("leaderDrawer.reference.weeklyWithheld")}
          </div>
        </section>

        <section className="mt-4 rounded-[14px] border p-[22px]" style={{ background: CARD, borderColor: LINE }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2.5">
            <h2 className="font-serif text-[17px] font-normal">Session attendance</h2>
            <span className="text-[10.5px] text-[#9a938a]">{leader.completed_units} of {leader.required_units} units used</span>
          </div>
          <div className="mt-4 divide-y divide-[#eee8de]">
            <AttendanceRow label="Completed units" value={leader.completed_units} />
            <AttendanceRow label="Due units" value={leader.due_units} />
            <AttendanceRow label="Overdue units" value={leader.overdue_units} tone={leader.overdue_units > 0 ? "warning" : "muted"} />
          </div>
        </section>

        <section className="mt-4 rounded-[14px] border p-[22px]" style={{ background: CARD, borderColor: LINE }}>
          <SectionHeading label={t("leaderDrawer.participation.title")} icon={Activity} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ActivityStat label={t("leaderDrawer.participation.coaching")} value={leader.coaching_completed_count} />
            <ActivityStat label={t("leaderDrawer.participation.mentoring")} value={leader.mentoring_completed_count} />
            <ActivityStat label={t("leaderDrawer.participation.peer")} value={leader.peer_completed_count} />
            <ActivityStat label={t("leaderDrawer.participation.triads")} value={leader.triad_completed_count} />
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-[#6a6560]">{t("leaderDrawer.participation.note")}</p>
        </section>

        <section className="mt-4 rounded-[14px] border border-[#e8874a]/25 bg-[#e8874a]/[.06] p-[22px]">
          <SectionHeading label={t("leaderDrawer.attention.title")} icon={Flag} />
          {attentionItems.length > 0 ? (
            <ul className="mt-3 space-y-2">{attentionItems.map((item) => <li key={item} className="flex items-start gap-2 text-[11px]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#a8541c]" />{item}</li>)}</ul>
          ) : (
            <p className="mt-3 flex items-center gap-2 text-[11px] text-[#6a6560]"><CheckCircle2 className="h-3.5 w-3.5 text-[#17663f]" />{t("leaderDrawer.attention.none")}</p>
          )}
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

function SectionHeading({ label, icon: Icon }: { label: string; icon: typeof Activity }) {
  return <div className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-[#2c8fa8]"><Icon className="h-3.5 w-3.5" />{label}</div>;
}

function LeaderKpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="rounded-[14px] border p-[18px]" style={{ background: CARD, borderColor: LINE }}><div className="font-display text-[28px] font-light leading-none">{value}</div><div className="mt-2 text-[9.5px] font-bold uppercase tracking-[.16em] text-[#6a6560]">{label}</div><div className="mt-1.5 text-[10.5px] text-[#9a938a]">{sub}</div></div>;
}

function PaceBars({ completed, due, required }: { completed: number; due: number; required: number }) {
  const actual = required ? (completed / required) * 100 : 0;
  const duePct = required ? ((completed + due) / required) * 100 : 0;
  return <div className="mt-5 grid grid-cols-6 items-end gap-2">{Array.from({ length: 6 }, (_, index) => {
    const factor = (index + 1) / 6;
    return <div key={index} className="flex flex-col items-center gap-2"><div className="flex h-[150px] items-end gap-1"><span className="w-2 rounded-t-[2px] bg-[#cfc7bb]" style={{ height: `${Math.max(7, duePct * factor)}%` }} /><span className="w-2 rounded-t-[2px] bg-[#062f3e]" style={{ height: `${Math.max(5, actual * factor)}%` }} /></div><span className="text-[9.5px] font-bold text-[#9a938a]">W{index + 1}</span></div>;
  })}</div>;
}

function Journey({ start, end, completed, status }: { start: string; end: string; completed: number; status: SponsorRosterRow["enrollment_status"] }) {
  const progress = timelineProgress(start, end);
  const steps: Array<[string, boolean]> = [
    ["Started", progress > 0],
    ["In progress", progress > 12 && completed > 0],
    ["Current", progress >= 50],
    ["Complete", status === "completed"],
  ];
  return <div className="relative mt-5"><div className="absolute left-2 top-2 h-1.5 w-[calc(100%-16px)] rounded-full bg-[#eee8de]" /><div className="absolute left-2 top-2 h-1.5 rounded-full bg-[#3db4d0]" style={{ width: `calc(${progress}% - 8px)` }} /><div className="relative flex justify-between">{steps.map(([label, active]) => <div key={label} className="flex max-w-[70px] flex-col items-center gap-2 text-center"><span className={`h-5 w-5 rounded-full border-4 border-[#fffdf9] shadow-sm ${active ? "bg-[#3db4d0]" : "bg-[#d6cfc4]"}`} /><span className={`text-[9px] font-bold uppercase tracking-[.1em] ${active ? "text-[#062f3e]" : "text-[#9a938a]"}`}>{label}</span></div>)}</div></div>;
}

function ProgressLine({ label, pct, tone = "sky", empty = false }: { label: string; pct: number; tone?: "sky" | "green" | "navy" | "amber"; empty?: boolean }) {
  const colors = { sky: "#3db4d0", green: "#17663f", navy: "#062f3e", amber: "#e8874a" };
  const value = clamp(pct);
  return <div><div className="mb-1.5 flex justify-between text-[10px]"><span className="font-medium text-[#6a6560]">{label}</span><span className="font-semibold">{empty ? "—" : `${Math.round(value)}%`}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#eee8de]"><div className="h-full rounded-full" style={{ width: `${empty ? 0 : value}%`, background: colors[tone] }} /></div></div>;
}

function ActivityStat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-[12px] border border-[#e6e0d6] bg-white p-4"><div className="font-display text-2xl font-light leading-none">{value}</div><div className="mt-2 text-[9px] font-bold uppercase tracking-[.12em] text-[#6a6560]">{label}</div></div>;
}

function AttendanceRow({ label, value, tone = "muted" }: { label: string; value: number; tone?: "muted" | "warning" }) {
  return <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-3 text-xs"><span className="font-medium">{label}</span><span className={tone === "warning" ? "font-semibold text-[#a8541c]" : "text-[#6a6560]"}>{value}</span></div>;
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className="h-[9px] w-[9px] rounded-[2px]" style={{ background: color }} />{label}</span>;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function timelineProgress(start: string, end: string) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 50;
  return clamp(((Date.now() - startMs) / (endMs - startMs)) * 100);
}

function paceLabel(value: string | null) {
  return value ? value.replace(/_/g, " ") : "not yet assessed";
}