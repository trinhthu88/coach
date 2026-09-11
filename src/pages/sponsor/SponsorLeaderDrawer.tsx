import { ShieldCheck, Calendar, TrendingUp, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Pill } from "@/pages/admin/_shared";
import type { SponsorRosterRow } from "@/hooks/sponsor/useSponsorDashboardData";

const STATUS_TONE: Record<SponsorRosterRow["enrollment_status"], "success" | "warning" | "destructive" | "muted"> = {
  active: "success",
  completed: "muted",
  paused: "warning",
  at_risk: "destructive",
};
const STATUS_LABEL_KEY: Record<SponsorRosterRow["enrollment_status"], string> = {
  active: "active",
  completed: "completed",
  paused: "paused",
  at_risk: "atRisk",
};

function initials(name: string) {
  return name.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2);
}

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

  const completionPct = leader.full_completion_pct ?? 0;

  return (
    <Sheet open={!!leader} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto p-0">
        <SheetTitle className="sr-only">{leader.learner_display_name} — {t("leaderDrawer.srLabelSuffix")}</SheetTitle>

        {/* Header */}
        <div className="bg-gradient-to-br from-secondary to-secondary/80 p-6 text-white">
          <button
            onClick={onClose}
            className="mb-4 flex items-center gap-1.5 text-xs text-white/60 hover:text-white transition-colors"
          >
            <X className="h-3.5 w-3.5" /> {t("leaderDrawer.backToRoster")}
          </button>
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/15 text-xl font-semibold text-white">
              {initials(leader.learner_display_name)}
            </div>
            <div>
              <p className="text-lg font-semibold leading-tight">{leader.learner_display_name}</p>
              <p className="mt-0.5 text-sm text-white/60">{leader.cohort_label || "—"}</p>
              <p className="mt-0.5 text-[11px] text-white/50">{leader.programme_label} · {leader.enrollment_start_date} — {leader.enrollment_end_date ?? "ongoing"}</p>
              <div className="mt-2">
                <Pill tone={STATUS_TONE[leader.enrollment_status]}>
                  {t(`status.${STATUS_LABEL_KEY[leader.enrollment_status]}`)}
                </Pill>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-5">
          {/* Participation stats */}
          <section>
            <p className="mb-3 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{t("leaderDrawer.participationLabel")}</p>
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                icon={Calendar}
                 label="Completed units"
                 value={`${leader.completed_units} / ${leader.required_units}`}
                 sub={`${completionPct}% full completion`}
              />
              <StatCard
                icon={TrendingUp}
                 label="Due-to-date adherence"
                 value={leader.due_adherence_pct != null ? `${Math.round(leader.due_adherence_pct)}%` : "—"}
                 sub={`Pace: ${leader.pace_status ?? "not_yet_due"}`}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
              <span>Booked / due / overdue: <b>{leader.booked_units} / {leader.due_units} / {leader.overdue_units}</b></span>
              <span>Coverage: <b>{leader.schedule_coverage_pct == null ? "—" : `${Math.round(leader.schedule_coverage_pct)}%`}</b></span>
              <span>Goals setup / total: <b>{leader.goal_setup ? "Yes" : "No"} / {leader.goal_count}</b></span>
              <span>Goal progress: <b>{leader.goal_progress_pct == null ? "—" : `${Math.round(leader.goal_progress_pct)}%`}</b></span>
              <span>Actions complete: <b>{leader.completed_action_count} / {leader.total_action_count}</b></span>
              <span>Action completion: <b>{leader.action_completion_pct == null ? "—" : `${Math.round(leader.action_completion_pct)}%`}</b></span>
              <span>Satisfaction: <b>{leader.satisfaction_avg == null ? "—" : leader.satisfaction_avg.toFixed(2)}</b></span>
              <span>Rated sessions: <b>{leader.satisfaction_rated_count}</b></span>
            </div>

            {/* Progress bar */}
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                 <span>Full completion</span>
                 <span className="font-medium">{completionPct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                   style={{ width: `${Math.min(completionPct, 100)}%` }}
                />
              </div>
            </div>
          </section>

          {/* Privacy boundary */}
          <section className="rounded-xl border border-border bg-muted/30 p-4">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <p className="text-[11px] font-semibold text-foreground">{t("leaderDrawer.canSeeTitle")}</p>
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground">
              {t("leaderDrawer.withheldIntro")}
            </p>
            <ul className="space-y-1.5">
              {WITHHELD_KEYS.map(key => (
                <li key={key} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
                  {t(`leaderDrawer.withheld.${key}`)}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[10px] italic text-muted-foreground">
              {t("leaderDrawer.sameViewNote")}
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StatCard({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft">
        <Icon className="h-3.5 w-3.5 text-primary" />
      </div>
      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-xl font-normal leading-none">{value}</p>
      <p className="mt-1 text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}
