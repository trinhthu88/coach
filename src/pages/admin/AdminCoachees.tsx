import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Search, FileDown, FileUp, Eye, Users, Pencil } from "lucide-react";
import { format } from "date-fns";
import { AdminPageHeader, Kpi, Pill, Avatar, TablePager } from "./_shared";
import PendingAccessRequests from "@/components/PendingAccessRequests";
import { useAdminCoacheesData } from "@/hooks/admin/useAdminCoacheesData";
import { CoacheeProfileSheet } from "./coachees/CoacheeProfileSheet";
import { CoacheeEditSheet } from "./coachees/CoacheeEditSheet";
import { ImportDialog } from "./coachees/ImportDialog";
import { STATUS_KEYS, STATUS_TONE, programmeCompletionPct, exportCoacheesXlsx, type Row, type Status } from "./coachees/coacheeDisplay";

const PAGE_SIZE = 25;

export default function AdminCoachees() {
  const { t } = useTranslation("admin");
  const { loading, rows, coachOpts, programmes, cohorts, organizations, defaultLimit, load } = useAdminCoacheesData();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");
  const [editing, setEditing] = useState<Row | null>(null);
  const [viewing, setViewing] = useState<Row | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => rows.filter(r => {
    const query = q.trim().toLowerCase();
    const okQ = !query || r.full_name.toLowerCase().includes(query) || r.email.toLowerCase().includes(query);
    const okS = statusFilter === "all" || r.status === statusFilter;
    return okQ && okS;
  }), [rows, q, statusFilter]);

  useEffect(() => { setPage(1); }, [q, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const paged = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const exportXlsx = async () => {
    await exportCoacheesXlsx(filtered, t);
    toast.success(t("coachees.exported"));
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const active = rows.filter(r => r.status === "active").length;
  const pending = rows.filter(r => r.status === "pending_approval").length;
  const reachLimit = rows.filter(r => r.status === "reach_limit").length;

  return (
    <div>
      <AdminPageHeader
        eyebrow={t("coachees.eyebrow")}
        title={t("coachees.title")}
        trailing=""
        subtitle={t("coachees.subtitle", { total: rows.length })}
        right={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><FileUp className="h-4 w-4" /> {t("coachees.importExcel")}</Button>
            <Button variant="outline" size="sm" onClick={exportXlsx}><FileDown className="h-4 w-4" /> {t("coachees.exportExcel")}</Button>
          </div>
        }
      />

      <PendingAccessRequests variant="coachee" onApproved={load} />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Kpi label={t("coachees.kpiTotal")} value={rows.length} icon={Users} tone="primary" />
        <Kpi label={t("coachees.kpiActive")} value={active} icon={Users} tone="success" />
        <Kpi label={t("coachees.kpiAwaitingApproval")} value={pending} icon={Users} tone="warning" />
        <Kpi label={t("coachees.kpiReachedLimit")} value={reachLimit} icon={Users} tone="destructive" />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-64 flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("coachees.searchPlaceholder")} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | Status)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("coachees.allStatuses")}</SelectItem>
            {STATUS_KEYS.map(s => <SelectItem key={s} value={s}>{t(`coachees.statusLabels.${s}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coachees.tableHeaders.coachee")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coachees.tableHeaders.status")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coachees.tableHeaders.registered")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coachees.tableHeaders.limit")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coachees.tableHeaders.booked")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coachees.tableHeaders.done")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coachees.tableHeaders.programme")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coachees.tableHeaders.percentComplete")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coachees.tableHeaders.selectedCoaches")}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{t("coachees.tableHeaders.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {paged.map(r => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Avatar name={r.full_name} />
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-medium text-foreground">{r.full_name}</p>
                        <p className="truncate text-[10px] text-muted-foreground">{r.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5"><Pill tone={STATUS_TONE[r.status]}>{t(`coachees.statusLabels.${r.status}`)}</Pill></td>
                  <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{format(new Date(r.created_at), "MMM d, yyyy")}</td>
                  <td className="px-3 py-2.5"><span className="font-mono text-[11px]">{r.done}/{r.session_limit}</span></td>
                  <td className="px-3 py-2.5 text-[11px]">{r.booked}</td>
                  <td className="px-3 py-2.5 text-[11px]">{r.done}</td>
                  <td className="px-3 py-2.5 text-[11px]">
                    {r.programme_name ? (
                      <Link to="/admin/programmes" className="text-primary hover:underline">{r.programme_name}</Link>
                    ) : (
                      <span className="italic text-muted-foreground">—</span>
                    )}
                    {r.cohort_name && (
                      <p className="text-[10px]">
                        <Link to="/admin/cohorts" className="text-muted-foreground hover:text-primary hover:underline">{r.cohort_name}</Link>
                      </p>
                    )}
                    {r.organization_name && (
                      <p className="text-[10px]">
                        <Link to="/admin/organizations" className="text-primary hover:underline">{r.organization_name}</Link>
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[11px]">
                    {(() => {
                      const pct = programmeCompletionPct(r.enrollment_start_date, r.programme_duration_months);
                      if (pct === null) return <span className="italic text-muted-foreground">—</span>;
                      return (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="font-mono text-[10px] text-muted-foreground">{pct}%</span>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2.5 text-[11px]">{r.selected_coaches.length === 0 ? <span className="italic text-muted-foreground">—</span> : t("coachees.selectedCoachesCount", { count: r.selected_coaches.length })}</td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex gap-1">
                      <Button variant="ghost" size="icon" title={t("coachees.viewProfile")} onClick={() => setViewing(r)}><Eye className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" title={t("coachees.edit")} onClick={() => setEditing(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="p-12 text-center text-sm text-muted-foreground">{t("coachees.noMatch")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePager page={pageSafe} totalPages={totalPages} onChange={setPage} />
      </Card>

      <CoacheeProfileSheet row={viewing} onClose={() => setViewing(null)} />

      <CoacheeEditSheet
        row={editing}
        original={editing ? rows.find(r => r.id === editing.id) : undefined}
        onClose={() => setEditing(null)}
        onSaved={load}
        programmes={programmes}
        cohorts={cohorts}
        organizations={organizations}
        coachOpts={coachOpts}
        defaultLimit={defaultLimit}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        programmes={programmes}
        rows={rows}
        onImported={load}
      />
    </div>
  );
}
