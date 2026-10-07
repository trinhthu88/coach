import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import {
  Check,
  Loader2,
  X,
  Search,
  FileDown,
  FileUp,
  Users,
  ShieldCheck,
  Pencil,
} from "lucide-react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { useAdminRegistrations } from "@/hooks/admin/useAdminRegistrations";
import { useAdminRegistrationApprovals } from "@/hooks/admin/useAdminRegistrationApprovals";
import { AdminImportDialog } from "@/components/admin/AdminImportDialog";
import { CoachReferrals } from "@/pages/admin/registrations/CoachReferrals";
import { CoachListRow, CoacheeRow, Status } from "@/hooks/admin/types";
import { formatModuleUnits } from "@/lib/adminCanonicalProgress";
import { PageHeader } from "@/components/ui/page-header";
import { useConfirm } from "@/hooks/use-confirm";

const STATUS_TONE: Record<Status, "default" | "secondary" | "destructive" | "outline"> = {
  pending_approval: "secondary",
  active: "default",
  rejected: "destructive",
  suspended: "outline",
  reach_limit: "outline",
};

export default function AdminRegistrations() {
  const { t } = useTranslation("admin");
  const {
    loading,
    coachees,
    coaches,
    reload: load,
  } = useAdminRegistrations();
  const { busyId, setCoacheeStatusValue, setCoachStatusValue } = useAdminRegistrationApprovals(load);
  const { confirm, ConfirmDialog } = useConfirm();

  const rejectCoachee = async (c: CoacheeRow) => {
    const ok = await confirm({
      title: t("registrations.rejectConfirmTitle", { name: c.full_name }),
      description: t("registrations.rejectConfirmDescription"),
      confirmLabel: t("registrations.reject"),
      destructive: true,
    });
    if (ok) setCoacheeStatusValue(c.id, "rejected");
  };

  const rejectCoach = async (c: CoachListRow) => {
    const ok = await confirm({
      title: t("registrations.rejectConfirmTitle", { name: c.full_name }),
      description: t("registrations.rejectConfirmDescription"),
      confirmLabel: t("registrations.reject"),
      destructive: true,
    });
    if (ok) setCoachStatusValue(c.id, "rejected");
  };
  const [coacheeQuery, setCoacheeQuery] = useState("");
  const [coachQuery, setCoachQuery] = useState("");
  const [coacheeStatus, setCoacheeStatus] = useState<"all" | Status>("all");
  const [coachStatus, setCoachStatus] = useState<"all" | Status>("all");
  const [editingCoach, setEditingCoach] = useState<CoachListRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const filteredCoachees = useMemo(() => {
    return coachees.filter((c) => {
      const q = coacheeQuery.toLowerCase().trim();
      const mq =
        !q ||
        c.full_name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q);
      const ms = coacheeStatus === "all" || c.status === coacheeStatus;
      return mq && ms;
    });
  }, [coachees, coacheeQuery, coacheeStatus]);

  const filteredCoaches = useMemo(() => {
    return coaches.filter((c) => {
      const q = coachQuery.toLowerCase().trim();
      const mq =
        !q ||
        c.full_name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q);
      const ms = coachStatus === "all" || c.status === coachStatus;
      return mq && ms;
    });
  }, [coaches, coachQuery, coachStatus]);

  // Export coachees to Excel
  const exportCoachees = async () => {
    const XLSX = await import("xlsx");
    const data = filteredCoachees.map((c) => ({
      [t("registrations.export.name")]: c.full_name,
      [t("registrations.export.email")]: c.email,
      [t("registrations.export.registered")]: format(new Date(c.created_at), "yyyy-MM-dd"),
      [t("registrations.export.status")]: t(`registrations.statusLabels.${c.status}`),
      [t("registrations.export.bookedSessions")]: c.coaching_booked_units ?? "",
      [t("registrations.export.sessionsDone")]: c.coaching_units ? formatModuleUnits(c.coaching_units) : "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, t("registrations.export.coacheesSheetName"));
    XLSX.writeFile(wb, `coachees-${format(new Date(), "yyyyMMdd")}.xlsx`);
    toast({ title: t("registrations.exported") });
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("registrations.eyebrow")}
        title={t("registrations.titleAll")}
        emphasis={t("registrations.titleEmphasis")}
        subtitle={t("registrations.subtitle")}
      />

      <Tabs defaultValue="coachees">
        <TabsList>
          <TabsTrigger value="coachees" className="gap-2">
            <Users className="h-4 w-4" /> {t("registrations.coacheesTab", { count: coachees.length })}
          </TabsTrigger>
          <TabsTrigger value="coaches" className="gap-2">
            <ShieldCheck className="h-4 w-4" /> {t("registrations.coachesTab", { count: coaches.length })}
          </TabsTrigger>
        </TabsList>

        {/* COACHEES */}
        <TabsContent value="coachees" className="space-y-4 pt-4">
          {/* A Coach's referrals: who referred them, the suggested programme, and
              "New coaching engagement" from one (Prompt 14). */}
          <CoachReferrals onChanged={load} />
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={coacheeQuery}
                onChange={(e) => setCoacheeQuery(e.target.value)}
                placeholder={t("registrations.searchPlaceholder")}
                className="pl-9"
              />
            </div>
            <Select value={coacheeStatus} onValueChange={(v) => setCoacheeStatus(v as "all" | Status)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("registrations.allStatuses")}</SelectItem>
                <SelectItem value="pending_approval">{t("registrations.statusLabels.pending_approval")}</SelectItem>
                <SelectItem value="active">{t("registrations.statusLabels.active")}</SelectItem>
                <SelectItem value="reach_limit">{t("registrations.statusLabels.reach_limit")}</SelectItem>
                <SelectItem value="rejected">{t("registrations.statusLabels.rejected")}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={exportCoachees}>
              <FileDown className="h-4 w-4" /> {t("registrations.export.exportButton")}
            </Button>
            <Button onClick={() => setImportOpen(true)}>
              <FileUp className="h-4 w-4" /> {t("registrations.importExcel")}
            </Button>
          </div>

          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">{t("registrations.coacheeTableHeaders.name")}</th>
                  <th className="px-4 py-3 text-left">{t("registrations.coacheeTableHeaders.email")}</th>
                  <th className="px-4 py-3 text-left">{t("registrations.coacheeTableHeaders.registered")}</th>
                  <th className="px-4 py-3 text-left">{t("registrations.coacheeTableHeaders.status")}</th>
                  <th className="px-4 py-3 text-right">{t("registrations.coacheeTableHeaders.booked")}</th>
                  <th className="px-4 py-3 text-right">{t("registrations.coacheeTableHeaders.done")}</th>
                  <th className="px-4 py-3 text-right">{t("registrations.coacheeTableHeaders.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredCoachees.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                      {t("registrations.noCoacheesMatch")}
                    </td>
                  </tr>
                ) : (
                  filteredCoachees.map((c) => (
                    <tr key={c.id} className="border-t hover:bg-muted/20">
                      <td className="px-4 py-3 font-semibold">{c.full_name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{c.email}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {format(new Date(c.created_at), "PP")}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_TONE[c.status]}>{t(`registrations.statusLabels.${c.status}`)}</Badge>
                      </td>
                      {/* Canonical Coaching units of the current enrollment, never raw session rows. */}
                      <td className="px-4 py-3 text-right">{c.coaching_booked_units ?? "—"}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatModuleUnits(c.coaching_units)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          {/* One editing surface: the person's enrollment-first admin record. */}
                          <Button size="sm" variant="outline" asChild>
                            <Link to={`/admin/coachees/${c.id}`}>
                              <Pencil className="h-3.5 w-3.5" /> {t("registrations.edit")}
                            </Link>
                          </Button>
                          {c.status === "pending_approval" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busyId === c.id}
                                onClick={() => rejectCoachee(c)}
                                aria-label={t("registrations.reject")}
                                title={t("registrations.reject")}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                disabled={busyId === c.id}
                                onClick={() => setCoacheeStatusValue(c.id, "active")}
                                aria-label={t("registrations.approve")}
                                title={t("registrations.approve")}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        {/* COACHES */}
        <TabsContent value="coaches" className="space-y-4 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={coachQuery}
                onChange={(e) => setCoachQuery(e.target.value)}
                placeholder={t("registrations.searchPlaceholder")}
                className="pl-9"
              />
            </div>
            <Select value={coachStatus} onValueChange={(v) => setCoachStatus(v as "all" | Status)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("registrations.allStatuses")}</SelectItem>
                <SelectItem value="pending_approval">{t("registrations.statusLabels.pending_approval")}</SelectItem>
                <SelectItem value="active">{t("registrations.statusLabels.active")}</SelectItem>
                <SelectItem value="suspended">{t("registrations.statusLabels.suspended")}</SelectItem>
                <SelectItem value="rejected">{t("registrations.statusLabels.rejected")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">{t("registrations.coachTableHeaders.name")}</th>
                  <th className="px-4 py-3 text-left">{t("registrations.coachTableHeaders.email")}</th>
                  <th className="px-4 py-3 text-left">{t("registrations.coachTableHeaders.statusGetCoached")}</th>
                  <th className="px-4 py-3 text-right">{t("registrations.coachTableHeaders.coachingUnits")}</th>
                  <th className="px-4 py-3 text-right">{t("registrations.coachTableHeaders.peerUnits")}</th>
                  <th className="px-4 py-3 text-right">{t("registrations.coachTableHeaders.given")}</th>
                  <th className="px-4 py-3 text-right">{t("registrations.coachTableHeaders.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredCoaches.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                      {t("registrations.noCoachesMatch")}
                    </td>
                  </tr>
                ) : (
                  filteredCoaches.map((c) => (
                    <tr key={c.id} className="border-t hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <div className="font-semibold">{c.full_name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {c.country_based || "—"} · {t("registrations.regPrefix")} {format(new Date(c.created_at), "PP")}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{c.email}</td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_TONE[c.status]}>{t(`registrations.statusLabels.${c.status}`)}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono">{formatModuleUnits(c.coaching_units)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono">{formatModuleUnits(c.peer_units)}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                        {c.sessions_completed} · {c.coachees_count} · ★ {c.rating_avg == null ? "—" : c.rating_avg.toFixed(1)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingCoach(c)}
                          >
                            <Pencil className="h-3.5 w-3.5" /> {t("registrations.edit")}
                          </Button>
                          {c.status === "pending_approval" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busyId === c.id}
                                onClick={() => rejectCoach(c)}
                                aria-label={t("registrations.reject")}
                                title={t("registrations.reject")}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                disabled={busyId === c.id}
                                onClick={() => setCoachStatusValue(c.id, "active")}
                                aria-label={t("registrations.approve")}
                                title={t("registrations.approve")}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                          {c.status === "active" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyId === c.id}
                              onClick={() => setCoachStatusValue(c.id, "suspended")}
                            >
                              {t("registrations.suspend")}
                            </Button>
                          )}
                          {c.status === "suspended" && (
                            <Button
                              size="sm"
                              disabled={busyId === c.id}
                              onClick={() => setCoachStatusValue(c.id, "active")}
                            >
                              {t("registrations.reactivate")}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
        </TabsContent>
      </Tabs>


      <EditCoachDialog
        coach={editingCoach}
        onClose={() => setEditingCoach(null)}
      />

      {/* The one admin import path (admin-provision-user): preview first, then create. */}
      <AdminImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        defaultRole="coachee"
        onDone={load}
      />
      {ConfirmDialog}
    </div>
  );
}


/**
 * A Coach's own programme as a learner. Who coaches them is their cohort's
 * Coach pool (Admin -> Cohorts -> Coaching); the retired
 * coach_as_coachee_allowlist is neither shown nor written here.
 */
function EditCoachDialog({
  coach,
  onClose,
}: {
  coach: CoachListRow | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("admin");

  if (!coach) return null;

  return (
    <Dialog open={!!coach} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("registrations.editDialogTitle", { name: coach.full_name })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("registrations.ownProgramme")}</p>
              <Button asChild variant="link" size="sm" className="h-auto p-0 text-[11px]">
                <Link to="/admin/coach-programmes">{t("registrations.changeCoachProgramme")} →</Link>
              </Button>
            </div>
            <p className="mb-2 text-sm font-medium">
              {coach.coach_programme_name || <span className="italic text-muted-foreground">{t("registrations.notEnrolled")}</span>}
            </p>
            <div className="grid grid-cols-2 gap-3 text-[11px]">
              <div>
                <p className="text-muted-foreground">{t("registrations.coachingReceived")}</p>
                <p className="font-mono">{formatModuleUnits(coach.coaching_units)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("registrations.peerReceived")}</p>
                <p className="font-mono">{formatModuleUnits(coach.peer_units)}</p>
              </div>
            </div>
          </div>

        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("registrations.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
