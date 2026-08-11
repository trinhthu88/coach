import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Users, Loader2, Calendar, AlertCircle, Search, TrendingUp } from "lucide-react";
import { format } from "date-fns";
import { PageHeader, StatCard } from "@/components/ui/page-header";
import { useCoachClients } from "@/hooks/coach/useCoachClients";
import { ClientRow } from "./coach/ClientRow";
import { ClientDetailDialog } from "./coach/ClientDetailDialog";

export default function CoachClients() {
  const { user } = useAuth();
  const { clients, loading, reload, metrics } = useCoachClients(user?.id);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = clients.filter((c) => {
    const q = search.toLowerCase();
    return !q || c.full_name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <PageHeader
          className="mb-0"
          eyebrow="Practice"
          title="My"
          emphasis="clients"
          subtitle="All active coachees at a glance — progress, engagement, and private notes."
        />

      {/* METRICS */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          icon={Users}
          label="Active clients"
          value={metrics.active}
          hint={`${clients.filter((c) => c.upcomingCount === 0 && c.completed > 0).length} no upcoming`}
        />
        <StatCard
          icon={Calendar}
          label="Sessions this week"
          value={metrics.sessionsThisWeek}
          hint={metrics.nextOverall ? `next: ${format(new Date(metrics.nextOverall), "MMM d, p")}` : "none scheduled"}
        />
        <StatCard
          icon={AlertCircle}
          label="Overdue actions"
          value={metrics.overdue}
          hint={metrics.overdue ? `across ${metrics.overdueClients} coachee${metrics.overdueClients === 1 ? "" : "s"}` : "all on time"}
          tone={metrics.overdue ? "warning" : "success"}
        />
        <StatCard
          icon={TrendingUp}
          label="Milestones hit"
          value={metrics.milestonesHit}
          hint="completed total"
          tone="success"
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <p className="text-xs text-muted-foreground">Click a card to open the coachee profile</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <h3 className="text-lg font-semibold">No clients yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Coachees appear here once you have a confirmed or completed session.
          </p>
        </Card>
      ) : (
        <div className="surface-card overflow-hidden p-0">
          <div className="grid grid-cols-[1.6fr_0.9fr_1.3fr_0.9fr] gap-4 border-b border-border px-5 py-3 text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            <span>Client</span>
            <span>Programme</span>
            <span>Progress</span>
            <span>Next session</span>
          </div>
          <div className="divide-y divide-border">
            {filtered.map((c) => (
              <ClientRow key={c.id} client={c} onOpen={() => setOpenId(c.id)} />
            ))}
          </div>
        </div>
      )}

      {openId && (
        <ClientDetailDialog
          coacheeId={openId}
          coachId={user!.id}
          onClose={() => setOpenId(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}
