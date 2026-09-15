import {
  Activity,
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  CircleGauge,
  Flag,
  Goal,
  Heart,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Pill } from "@/pages/admin/_shared";
import type { SponsorRosterRow } from "@/hooks/sponsor/useSponsorDashboardData";
import { STATUS_LABEL_KEY, STATUS_TONE, initials } from "./sponsorUtils";
import { cn } from "@/lib/utils";

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

  const completionPct = clamp(leader.full_completion_pct ?? 0);
  const adherencePct = clamp(leader.due_adherence_pct ?? 0);
  const coveragePct = clamp(leader.schedule_coverage_pct ?? 0);
  const timelinePct = timelineProgress(leader.enrollment_start_date, leader.enrollment_end_date);
  const attentionItems = [
    leader.enrollment_status === "at_risk" ? t("leaderDrawer.attention.atRisk") : null,
    (leader.overdue_units ?? 0) > 0 ? t("leaderDrawer.attention.overdue", { count: leader.overdue_units }) : null,
    (leader.open_action_count ?? 0) > 0 ? t("leaderDrawer.attention.actions", { count: leader.open_action_count }) : null,
    adherencePct < 70 && leader.due_units > 0 ? t("leaderDrawer.attention.adherence") : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <Sheet open={!!leader} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto border-l border-[#e6dfd4] bg-[#fcfaf7] p-0">
        <SheetTitle className="sr-only">{leader.learner_display_name} — {t("leaderDrawer.srLabelSuffix")}</SheetTitle>
        <SheetDescription className="sr-only">{t("leaderDrawer.description")}</SheetDescription>

        <header className="relative overflow-hidden bg-secondary px-6 pb-7 pt-5 text-white sm:px-8">
          <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full border-[26px] border-white/5" />
          <button onClick={onClose} className="relative mb-7 inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/60 transition-colors hover:text-white">
            <X className="h-3.5 w-3.5" /> {t("leaderDrawer.backToRoster")}
          </button>
          <div className="relative flex items-start justify-between gap-5">
            <div className="flex min-w-0 items-center gap-4">
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-[20px] bg-white/15 font-display text-2xl font-light text-white">
                {initials(leader.learner_display_name)}
              </div>
              <div className="min-w-0">
                <p className="truncate font-display text-[1.65rem] font-light leading-tight">{leader.learner_display_name}</p>
                <p className="mt-1 truncate text-[11px] text-white/60">{leader.cohort_label || "—"} · {leader.programme_label}</p>
                <p className="mt-1 text-[10px] text-white/45">
                  {formatDate(leader.enrollment_start_date)} — {leader.enrollment_end_date ? formatDate(leader.enrollment_end_date) : t("leaderDrawer.ongoing")}
                </p>
              </div>
            </div>
            <Pill tone={STATUS_TONE[leader.enrollment_status]}>
              {t(`status.${STATUS_LABEL_KEY[leader.enrollment_status]}`)}
            </Pill>
          </div>
        </header>

        <div className="space-y-6 px-5 py-6 sm:px-8">
          <section>
            <SectionEyebrow icon={Sparkles} label={t("leaderDrawer.overview")} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <KpiCard icon={Target} label={t("leaderDrawer.kpis.completion")} value={`${Math.round(completionPct)}%`} sub={`${leader.completed_units} / ${leader.required_units}`} />
              <KpiCard icon={CalendarCheck} label={t("leaderDrawer.kpis.adherence")} value={leader.due_adherence_pct == null ? "—" : `${Math.round(adherencePct)}%`} sub={paceLabel(leader.pace_status)} />
              <KpiCard icon={Activity} label={t("leaderDrawer.kpis.sessions")} value={`${leader.completed_units}`} sub={t("leaderDrawer.kpis.sessionsSub", { total: leader.required_units })} />
              <KpiCard icon={CircleGauge} label={t("leaderDrawer.kpis.booked")} value={`${leader.booked_units}`} sub={t("leaderDrawer.kpis.bookedSub")} />
              <KpiCard icon={Goal} label={t("leaderDrawer.kpis.goals")} value={leader.goal_progress_pct == null ? "—" : `${Math.round(leader.goal_progress_pct)}%`} sub={t("leaderDrawer.kpis.goalsSub", { count: leader.goal_count })} />
              <KpiCard icon={Heart} label={t("leaderDrawer.kpis.satisfaction")} value={leader.satisfaction_avg == null ? "—" : leader.satisfaction_avg.toFixed(1)} sub={t("leaderDrawer.kpis.ratings", { count: leader.satisfaction_rated_count })} />
            </div>
          </section>

          <section className="rounded-[20px] border border-[#e6dfd4] bg-white p-5">
            <SectionEyebrow icon={TrendingUp} label={t("leaderDrawer.journey.title")} />
            <div className="relative mt-5">
              <div className="absolute left-2 top-2 h-1.5 w-[calc(100%-16px)] rounded-full bg-muted" />
              <div className="absolute left-2 top-2 h-1.5 rounded-full bg-primary" style={{ width: `calc(${timelinePct}% - 8px)` }} />
              <div className="relative flex justify-between">
                {[
                  [t("leaderDrawer.journey.started"), timelinePct > 0],
                  [t("leaderDrawer.journey.inProgress"), timelinePct > 15 && leader.completed_units > 0],
                  [t("leaderDrawer.journey.current"), timelinePct >= 50],
                  [t("leaderDrawer.journey.complete"), leader.enrollment_status === "completed"],
                ].map(([label, active]) => (
                  <div key={label} className="flex max-w-[72px] flex-col items-center gap-2 text-center">
                    <span className={cn("h-5 w-5 rounded-full border-4 border-white shadow-sm", active ? "bg-primary" : "bg-[#ddd7cf")} />
                    <span className={cn("text-[9px] font-bold uppercase tracking-[0.1em]", active ? "text-foreground" : "text-muted-foreground")}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <ProgressLine label={t("leaderDrawer.progress.completion")} pct={completionPct} tone="primary" />
              <ProgressLine label={t("leaderDrawer.progress.adherence")} pct={adherencePct} tone="success" />
              <ProgressLine label={t("leaderDrawer.progress.coverage")} pct={coveragePct} tone="secondary" />
              <ProgressLine label={t("leaderDrawer.progress.goal")} pct={leader.goal_progress_pct ?? 0} tone="warning" empty={leader.goal_progress_pct == null} />
            </div>
          </section>

          <section>
            <SectionEyebrow icon={Activity} label={t("leaderDrawer.participation.title")} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ActivityStat label={t("leaderDrawer.participation.coaching")} value={leader.coaching_completed_count} />
              <ActivityStat label={t("leaderDrawer.participation.mentoring")} value={leader.mentoring_completed_count} />
              <ActivityStat label={t("leaderDrawer.participation.peer")} value={leader.peer_completed_count} />
              <ActivityStat label={t("leaderDrawer.participation.triads")} value={leader.triad_completed_count} />
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">{t("leaderDrawer.participation.note")}</p>
          </section>

          <section className="grid gap-4 sm:grid-cols-3">
            <InfoPanel icon={CircleGauge} title={t("leaderDrawer.coaching.title")}>
              <div className="flex items-end gap-2">
                <span className="font-display text-3xl leading-none">{leader.coaching_completed_count}</span>
                <span className="pb-0.5 text-[11px] text-muted-foreground">{t("leaderDrawer.coaching.completed")}</span>
              </div>
              <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">{t("leaderDrawer.coaching.note")}</p>
            </InfoPanel>
            <InfoPanel icon={Goal} title={t("leaderDrawer.goal.title")}>
              <ProgressLine label={t("leaderDrawer.goal.current")} pct={leader.goal_progress_pct ?? 0} tone="warning" empty={leader.goal_progress_pct == null} />
              <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">{t("leaderDrawer.goal.note")}</p>
            </InfoPanel>
            <InfoPanel icon={Heart} title={t("leaderDrawer.satisfaction.title")}>
              <div className="flex items-end gap-2">
                <span className="font-display text-3xl leading-none">{leader.satisfaction_avg == null ? "—" : leader.satisfaction_avg.toFixed(1)}</span>
                <span className="pb-0.5 text-[11px] text-muted-foreground">/ 5</span>
              </div>
              <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
                {leader.satisfaction_rated_count > 0 ? t("leaderDrawer.satisfaction.rated", { count: leader.satisfaction_rated_count }) : t("leaderDrawer.satisfaction.none")}
              </p>
            </InfoPanel>
          </section>

          <section className="rounded-[20px] border border-warning/20 bg-warning/5 p-5">
            <SectionEyebrow icon={Flag} label={t("leaderDrawer.attention.title")} />
            {attentionItems.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {attentionItems.map((item) => <li key={item} className="flex items-start gap-2 text-[11px] text-foreground"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />{item}</li>)}
              </ul>
            ) : (
              <p className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-success" />{t("leaderDrawer.attention.none")}</p>
            )}
          </section>

          <section className="rounded-[20px] border border-primary/15 bg-primary-soft/40 p-5">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-foreground">{t("leaderDrawer.canSeeTitle")}</p>
            </div>
            <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">{t("leaderDrawer.withheldIntro")}</p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {WITHHELD_KEYS.map((key) => <li key={key} className="flex items-start gap-2 text-[10px] text-muted-foreground"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />{t(`leaderDrawer.withheld.${key}`)}</li>)}
            </ul>
            <p className="mt-4 text-[10px] italic text-muted-foreground">{t("leaderDrawer.sameViewNote")}</p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SectionEyebrow({ icon: Icon, label }: { icon: typeof Activity; label: string }) {
  return <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-primary"><Icon className="h-3.5 w-3.5" />{label}</div>;
}

function KpiCard({ icon: Icon, label, value, sub }: { icon: typeof Activity; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-[#e6dfd4] bg-white p-4">
      <Icon className="h-4 w-4 text-primary" />
      <p className="mt-3 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl leading-none">{value}</p>
      <p className="mt-1.5 truncate text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function ProgressLine({ label, pct, tone, empty = false }: { label: string; pct: number; tone: "primary" | "success" | "secondary" | "warning"; empty?: boolean }) {
  const clamped = clamp(pct);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[10px]">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="font-semibold">{empty ? "—" : `${Math.round(clamped)}%`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", tone === "primary" && "bg-primary", tone === "success" && "bg-success", tone === "secondary" && "bg-secondary", tone === "warning" && "bg-warning")} style={{ width: `${empty ? 0 : clamped}%` }} /></div>
    </div>
  );
}

function ActivityStat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl border border-[#e6dfd4] bg-white p-4"><p className="font-display text-2xl leading-none">{value}</p><p className="mt-2 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</p></div>;
}

function InfoPanel({ icon: Icon, title, children }: { icon: typeof Goal; title: string; children: React.ReactNode }) {
  return <div className="rounded-[20px] border border-[#e6dfd4] bg-white p-5"><div className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-primary"><Icon className="h-3.5 w-3.5" />{title}</div>{children}</div>;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function timelineProgress(start: string | null, end: string | null) {
  if (!start || !end) return 50;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 50;
  return clamp(((Date.now() - startMs) / (endMs - startMs)) * 100);
}

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function paceLabel(value: string | null) {
  return value ? value.replaceAll("_", " ") : "not yet assessed";
}