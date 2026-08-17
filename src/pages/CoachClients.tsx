import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Users, Calendar, AlertCircle, Search, TrendingUp, UserPlus, Info } from "lucide-react";
import { format } from "date-fns";
import { PageHeader, StatCard } from "@/components/ui/page-header";
import { useCoachClients } from "@/hooks/coach/useCoachClients";
import { useCoachInviteSlots } from "@/hooks/coach/useCoachInviteSlots";
import { ClientRow } from "./coach/ClientRow";
import { ClientDetailDialog } from "./coach/ClientDetailDialog";
import { InviteClientDialog } from "./coach/InviteClientDialog";

const CONTACT_EMAIL = "contact@clariva.club";

export default function CoachClients() {
  const { t } = useTranslation("dashboard");
  const { user } = useAuth();
  const { clients, loading, reload, metrics } = useCoachClients(user?.id);
  const inviteSlots = useCoachInviteSlots(user?.id);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const refreshAll = () => {
    reload();
    inviteSlots.reload();
  };
  const atCap = !inviteSlots.loading && inviteSlots.used >= inviteSlots.limit;

  const filtered = clients.filter((c) => {
    const q = search.toLowerCase();
    return !q || c.full_name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <PageHeader
          className="mb-0"
          eyebrow={t("clients.eyebrow")}
          title={t("clients.titleLead")}
          emphasis={t("clients.titleEmphasis")}
          subtitle={t("clients.subtitle")}
          actions={
            atCap ? (
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {t("clients.atCapNotice", { used: inviteSlots.used, limit: inviteSlots.limit })}{" "}
                  <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold underline">
                    {t("clients.contactUs")}
                  </a>{" "}
                  {t("clients.forMore")}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                {!inviteSlots.loading && (
                  <span className="text-xs text-muted-foreground">
                    {t("clients.usedOfLimit", { used: inviteSlots.used, limit: inviteSlots.limit })}
                  </span>
                )}
                <Button onClick={() => setInviteOpen(true)}>
                  <UserPlus className="h-4 w-4" /> {t("clients.inviteAClient")}
                </Button>
              </div>
            )
          }
        />

      {/* METRICS */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          icon={Users}
          label={t("clients.stats.activeClients")}
          value={metrics.active}
          hint={t("clients.stats.activeClientsHint", { count: clients.filter((c) => c.upcomingCount === 0 && c.completed > 0).length })}
        />
        <StatCard
          icon={Calendar}
          label={t("clients.stats.sessionsThisWeek")}
          value={metrics.sessionsThisWeek}
          hint={metrics.nextOverall ? t("clients.stats.sessionsThisWeekHintNext", { date: format(new Date(metrics.nextOverall), "MMM d, p") }) : t("clients.stats.sessionsThisWeekHintNone")}
        />
        <StatCard
          icon={AlertCircle}
          label={t("clients.stats.overdueActions")}
          value={metrics.overdue}
          hint={metrics.overdue ? t("clients.stats.overdueActionsHint", { count: metrics.overdueClients }) : t("clients.stats.overdueActionsHintNone")}
          tone={metrics.overdue ? "warning" : "success"}
        />
        <StatCard
          icon={TrendingUp}
          label={t("clients.stats.milestonesHit")}
          value={metrics.milestonesHit}
          hint={t("clients.stats.milestonesHitHint")}
          tone="success"
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("clients.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <p className="text-xs text-muted-foreground">{t("clients.clickToOpen")}</p>
      </div>

      {loading ? (
        <div className="surface-card overflow-hidden p-0">
          <div className="hidden grid-cols-[1.6fr_0.9fr_1.3fr_0.9fr] gap-4 border-b border-border px-5 py-3 text-micro font-bold uppercase tracking-[0.2em] text-muted-foreground md:grid">
            <span>{t("clients.tableHeaders.client")}</span>
            <span>{t("clients.tableHeaders.programme")}</span>
            <span>{t("clients.tableHeaders.progress")}</span>
            <span>{t("clients.tableHeaders.nextSession")}</span>
          </div>
          <div className="divide-y divide-border">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-[1.6fr_0.9fr_1.3fr_0.9fr] md:gap-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                  <Skeleton className="h-4 w-32" />
                </div>
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <h3 className="text-lg font-semibold">{t("clients.empty.title")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("clients.empty.body")}
          </p>
        </Card>
      ) : (
        <div className="surface-card overflow-hidden p-0">
          <div className="hidden grid-cols-[1.6fr_0.9fr_1.3fr_0.9fr] gap-4 border-b border-border px-5 py-3 text-micro font-bold uppercase tracking-[0.2em] text-muted-foreground md:grid">
            <span>{t("clients.tableHeaders.client")}</span>
            <span>{t("clients.tableHeaders.programme")}</span>
            <span>{t("clients.tableHeaders.progress")}</span>
            <span>{t("clients.tableHeaders.nextSession")}</span>
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
          onChanged={refreshAll}
          onRemoved={() => {
            setOpenId(null);
            refreshAll();
          }}
          removeClient={inviteSlots.removeClient}
        />
      )}

      <InviteClientDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        invite={inviteSlots.invite}
        onInvited={refreshAll}
      />
    </div>
  );
}
