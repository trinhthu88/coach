import { ShieldCheck, Calendar, TrendingUp, X } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Pill } from "@/pages/admin/_shared";
import type { SponsorRosterRow } from "@/hooks/sponsor/useSponsorDashboardData";

const STATUS_TONE: Record<SponsorRosterRow["enrollment_status"], "success" | "warning" | "destructive" | "muted"> = {
  active: "success",
  completed: "muted",
  paused: "warning",
  at_risk: "destructive",
};
const STATUS_LABEL: Record<SponsorRosterRow["enrollment_status"], string> = {
  active: "Active",
  completed: "Completed",
  paused: "Paused",
  at_risk: "At risk",
};

function initials(name: string) {
  return name.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2);
}

const WITHHELD = [
  "Session notes and coaching summaries",
  "Chat messages between leader and coach",
  "Personal reflections and journal entries",
  "Goal titles, descriptions, and wording",
  "Coach identity and coaching approach details",
];

interface Props {
  leader: SponsorRosterRow | null;
  onClose: () => void;
}

export function SponsorLeaderDrawer({ leader, onClose }: Props) {
  if (!leader) return null;

  const sessionPct = leader.sessions_entitled > 0
    ? Math.round((leader.sessions_completed / leader.sessions_entitled) * 100)
    : 0;

  return (
    <Sheet open={!!leader} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto p-0">
        <SheetTitle className="sr-only">{leader.full_name} — leader detail</SheetTitle>

        {/* Header */}
        <div className="bg-gradient-to-br from-secondary to-secondary/80 p-6 text-white">
          <button
            onClick={onClose}
            className="mb-4 flex items-center gap-1.5 text-xs text-white/60 hover:text-white transition-colors"
          >
            <X className="h-3.5 w-3.5" /> Back to roster
          </button>
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/15 text-xl font-semibold text-white">
              {initials(leader.full_name)}
            </div>
            <div>
              <p className="text-lg font-semibold leading-tight">{leader.full_name}</p>
              <p className="mt-0.5 text-sm text-white/60">{leader.cohort_name || "—"}</p>
              <div className="mt-2">
                <Pill tone={STATUS_TONE[leader.enrollment_status]}>
                  {STATUS_LABEL[leader.enrollment_status]}
                </Pill>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-5">
          {/* Participation stats */}
          <section>
            <p className="mb-3 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Participation</p>
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                icon={Calendar}
                label="Sessions used"
                value={`${leader.sessions_completed} / ${leader.sessions_entitled}`}
                sub={`${sessionPct}% of allocation`}
              />
              <StatCard
                icon={TrendingUp}
                label="Self-rated growth"
                value={leader.goal_growth != null ? `+${Math.round(leader.goal_growth)} pts` : "—"}
                sub={leader.goal_growth != null ? "since baseline" : "no ratings yet"}
              />
            </div>

            {/* Progress bar */}
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>Programme progress</span>
                <span className="font-medium">{Math.round(leader.progress_pct)}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(leader.progress_pct, 100)}%` }}
                />
              </div>
            </div>
          </section>

          {/* Privacy boundary */}
          <section className="rounded-xl border border-border bg-muted/30 p-4">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <p className="text-[11px] font-semibold text-foreground">This is everything you can see</p>
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground">
              The following exist in Clariva and are withheld from this profile:
            </p>
            <ul className="space-y-1.5">
              {WITHHELD.map(item => (
                <li key={item} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[10px] italic text-muted-foreground">
              Every leader can see the same view of themselves that you see.
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
