import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Search, FileDown, FileUp, Eye, Users, Pencil } from "lucide-react";
import { format } from "date-fns";
import { AdminPageHeader, Kpi, Pill, Avatar } from "./_shared";
import PendingAccessRequests from "@/components/PendingAccessRequests";
import { useAdminCoacheesData } from "@/hooks/admin/useAdminCoacheesData";
import { CoacheeProfileSheet } from "./coachees/CoacheeProfileSheet";
import { CoacheeEditSheet } from "./coachees/CoacheeEditSheet";
import { ImportDialog } from "./coachees/ImportDialog";
import { STATUS_LABEL, STATUS_TONE, programmeCompletionPct, exportCoacheesXlsx, type Row, type Status } from "./coachees/coacheeDisplay";

export default function AdminCoachees() {
  const { loading, rows, coachOpts, programmes, cohorts, organizations, defaultLimit, load } = useAdminCoacheesData();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");
  const [editing, setEditing] = useState<Row | null>(null);
  const [viewing, setViewing] = useState<Row | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const filtered = useMemo(() => rows.filter(r => {
    const t = q.trim().toLowerCase();
    const okQ = !t || r.full_name.toLowerCase().includes(t) || r.email.toLowerCase().includes(t);
    const okS = statusFilter === "all" || r.status === statusFilter;
    return okQ && okS;
  }), [rows, q, statusFilter]);

  const exportXlsx = async () => {
    await exportCoacheesXlsx(filtered);
    toast.success("Exported");
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const active = rows.filter(r => r.status === "active").length;
  const pending = rows.filter(r => r.status === "pending_approval").length;
  const reachLimit = rows.filter(r => r.status === "reach_limit").length;

  return (
    <div>
      <AdminPageHeader
        eyebrow="Organisation"
        title="Coachees"
        trailing=""
        subtitle={`${rows.length} total · click any row to edit`}
        right={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><FileUp className="h-4 w-4" /> Import Excel</Button>
            <Button variant="outline" size="sm" onClick={exportXlsx}><FileDown className="h-4 w-4" /> Export Excel</Button>
          </div>
        }
      />

      <PendingAccessRequests variant="coachee" onApproved={load} />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Kpi label="Total" value={rows.length} icon={Users} tone="primary" />
        <Kpi label="Active" value={active} icon={Users} tone="success" />
        <Kpi label="Awaiting approval" value={pending} icon={Users} tone="warning" />
        <Kpi label="Reached limit" value={reachLimit} icon={Users} tone="destructive" />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-64 flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | Status)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(STATUS_LABEL) as Status[]).map(s => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold">Coachee</th>
                <th className="px-3 py-2.5 text-left font-semibold">Status</th>
                <th className="px-3 py-2.5 text-left font-semibold">Registered</th>
                <th className="px-3 py-2.5 text-left font-semibold">Limit</th>
                <th className="px-3 py-2.5 text-left font-semibold">Booked</th>
                <th className="px-3 py-2.5 text-left font-semibold">Done</th>
                <th className="px-3 py-2.5 text-left font-semibold">Programme</th>
                <th className="px-3 py-2.5 text-left font-semibold">% Complete</th>
                <th className="px-3 py-2.5 text-left font-semibold">Selected coaches</th>
                <th className="px-3 py-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(r => (
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
                  <td className="px-3 py-2.5"><Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill></td>
                  <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{format(new Date(r.created_at), "MMM d, yyyy")}</td>
                  <td className="px-3 py-2.5"><span className="font-mono text-[11px]">{r.done}/{r.session_limit}</span></td>
                  <td className="px-3 py-2.5 text-[11px]">{r.booked}</td>
                  <td className="px-3 py-2.5 text-[11px]">{r.done}</td>
                  <td className="px-3 py-2.5 text-[11px]">
                    {r.programme_name || <span className="italic text-muted-foreground">—</span>}
                    {r.cohort_name && <p className="text-[10px] text-muted-foreground">{r.cohort_name}</p>}
                    {r.organization_name && <p className="text-[10px] text-primary">{r.organization_name}</p>}
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
                  <td className="px-3 py-2.5 text-[11px]">{r.selected_coaches.length === 0 ? <span className="italic text-muted-foreground">—</span> : `${r.selected_coaches.length} coach${r.selected_coaches.length === 1 ? "" : "es"}`}</td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex gap-1">
                      <Button variant="ghost" size="sm" title="View profile" onClick={() => setViewing(r)}><Eye className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="sm" title="Edit" onClick={() => setEditing(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="p-12 text-center text-sm text-muted-foreground">No coachees match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
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
