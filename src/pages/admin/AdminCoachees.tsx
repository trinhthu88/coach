import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Loader2, Search, FileDown, FileUp, Eye, Users, Pencil, Save, Download, Target, Calendar, Layers,
} from "lucide-react";
import { format } from "date-fns";
import * as XLSX from "xlsx";
import { AdminPageHeader, Kpi, Pill, Avatar } from "./_shared";
import PendingAccessRequests from "@/components/PendingAccessRequests";

type Status = "pending_approval" | "active" | "rejected" | "suspended" | "reach_limit";
const STATUS_LABEL: Record<Status, string> = {
  pending_approval: "Awaiting approval",
  active: "Active",
  rejected: "Rejected",
  suspended: "Suspended",
  reach_limit: "Reached limit",
};
const STATUS_TONE: Record<Status, "muted"|"success"|"warning"|"destructive"> = {
  pending_approval: "warning",
  active: "success",
  rejected: "destructive",
  suspended: "destructive",
  reach_limit: "warning",
};

function programmeCompletionPct(startDate: string | null, durationMonths: number | null): number | null {
  if (!startDate || !durationMonths) return null;
  const start = new Date(startDate).getTime();
  const end = start + durationMonths * 30.4375 * 24 * 3600 * 1000;
  const now = Date.now();
  if (now <= start) return 0;
  if (now >= end) return 100;
  return Math.round(((now - start) / (end - start)) * 100);
}

interface Row {
  id: string;
  full_name: string;
  email: string;
  status: Status;
  created_at: string;
  booked: number;
  done: number;
  programme_id: string | null;
  programme_name: string | null;
  programme_default_limit: number | null;
  programme_duration_months: number | null;
  cohort_id: string | null;
  cohort_name: string | null;
  enrollment_id: string | null;
  enrollment_start_date: string | null;
  selected_coaches: { id: string; name: string }[];
  session_limit: number;
  limit_row_id: string | null;
  access_request_id: string | null;
}

export default function AdminCoachees() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [coachOpts, setCoachOpts] = useState<{ id: string; name: string }[]>([]);
  const [programmes, setProgrammes] = useState<{ id: string; name: string; coachee_session_limit: number; duration_months: number }[]>([]);
  const [cohorts, setCohorts] = useState<{ id: string; name: string }[]>([]);
  const [defaultLimit, setDefaultLimit] = useState(4);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");
  const [editing, setEditing] = useState<Row | null>(null);
  const [viewing, setViewing] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetCredential, setResetCredential] = useState<{ email: string; password: string; full_name: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [
      { data: roles },
      { data: profiles },
      { data: sess },
      { data: enrolls },
      { data: progs },
      { data: cohortsData },
      { data: allow },
      { data: limits },
      { data: requests },
    ] = await Promise.all([
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("profiles").select("id, full_name, email, status, created_at"),
      supabase.from("sessions").select("coachee_id, status"),
      supabase.from("programme_enrollments").select("id, coachee_id, programme_id, cohort_id, start_date"),
      supabase.from("programmes").select("id, name, coachee_session_limit, duration_months").eq("is_active", true),
      supabase.from("cohorts").select("id, name"),
      supabase.from("coachee_coach_allowlist").select("coachee_id, coach_id"),
      supabase.from("session_limits").select("id, coachee_id, monthly_limit"),
      supabase.from("access_requests").select("id, email, status").eq("status", "approved"),
    ]);

    const coacheeIds = (roles || []).filter(r => r.role === "coachee").map(r => r.user_id);
    const coachIds = (roles || []).filter(r => r.role === "coach").map(r => r.user_id);
    const profById = new Map((profiles || []).map((p: any) => [p.id, p]));
    const coachNameById = new Map<string, string>();
    coachIds.forEach(id => {
      const p: any = profById.get(id);
      if (p) coachNameById.set(id, p.full_name);
    });
    const enrByUser = new Map<string, any>();
    (enrolls || []).forEach((e: any) => enrByUser.set(e.coachee_id, e));
    const progById = new Map((progs || []).map((p: any) => [p.id, p]));
    const cohortById = new Map((cohortsData || []).map((c: any) => [c.id, c.name]));
    const allowByCoachee = new Map<string, { id: string; name: string }[]>();
    (allow || []).forEach((a: any) => {
      const arr = allowByCoachee.get(a.coachee_id) || [];
      arr.push({ id: a.coach_id, name: coachNameById.get(a.coach_id) || "—" });
      allowByCoachee.set(a.coachee_id, arr);
    });
    const done = new Map<string, number>();
    const booked = new Map<string, number>();
    (sess || []).forEach((s: any) => {
      if (s.status === "completed") done.set(s.coachee_id, (done.get(s.coachee_id) || 0) + 1);
      if (["pending_coach_approval", "confirmed"].includes(s.status)) booked.set(s.coachee_id, (booked.get(s.coachee_id) || 0) + 1);
    });
    const defLimit = (limits || []).find((l: any) => l.coachee_id === null)?.monthly_limit ?? 4;
    setDefaultLimit(defLimit);
    const limByCoachee = new Map<string, any>();
    (limits || []).filter((l: any) => l.coachee_id).forEach((l: any) => limByCoachee.set(l.coachee_id, l));
    const requestIdByEmail = new Map<string, string>();
    (requests || []).forEach((r: any) => {
      if (!requestIdByEmail.has(String(r.email).toLowerCase())) {
        requestIdByEmail.set(String(r.email).toLowerCase(), r.id);
      }
    });

    const out: Row[] = coacheeIds.map(id => {
      const p: any = profById.get(id);
      if (!p) return null;
      const enr = enrByUser.get(id);
      const lim = limByCoachee.get(id);
      const prog: any = enr?.programme_id ? progById.get(enr.programme_id) : null;
      return {
        id,
        full_name: p.full_name,
        email: p.email,
        status: p.status as Status,
        created_at: p.created_at,
        booked: booked.get(id) || 0,
        done: done.get(id) || 0,
        programme_id: enr?.programme_id || null,
        programme_name: prog?.name || null,
        programme_default_limit: prog?.coachee_session_limit ?? null,
        programme_duration_months: prog?.duration_months ?? null,
        cohort_id: enr?.cohort_id || null,
        cohort_name: enr?.cohort_id ? (cohortById.get(enr.cohort_id) as string) || null : null,
        enrollment_id: enr?.id || null,
        enrollment_start_date: enr?.start_date || null,
        selected_coaches: allowByCoachee.get(id) || [],
        session_limit: lim?.monthly_limit ?? defLimit,
        limit_row_id: lim?.id || null,
        access_request_id: requestIdByEmail.get(String(p.email).toLowerCase()) ?? null,
      } as Row;
    }).filter(Boolean) as Row[];

    setRows(out.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)));
    setCoachOpts(coachIds.map(id => ({ id, name: coachNameById.get(id) || "—" })).filter(c => c.name !== "—").sort((a, b) => a.name.localeCompare(b.name)));
    setProgrammes((progs || []) as any);
    setCohorts((cohortsData || []) as any);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => rows.filter(r => {
    const t = q.trim().toLowerCase();
    const okQ = !t || r.full_name.toLowerCase().includes(t) || r.email.toLowerCase().includes(t);
    const okS = statusFilter === "all" || r.status === statusFilter;
    return okQ && okS;
  }), [rows, q, statusFilter]);

  const exportXlsx = () => {
    const data = filtered.map(c => ({
      Name: c.full_name,
      Email: c.email,
      Registered: format(new Date(c.created_at), "yyyy-MM-dd"),
      Status: STATUS_LABEL[c.status],
      "Booked sessions": c.booked,
      "Completed sessions": c.done,
      "Session limit": c.session_limit,
      Programme: c.programme_name || "",
      Cohort: c.cohort_name || "",
      "Selected coaches": c.selected_coaches.map(s => s.name).join("; "),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Coachees");
    XLSX.writeFile(wb, `coachees-${format(new Date(), "yyyyMMdd")}.xlsx`);
    toast.success("Exported");
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      { Name: "Jane Doe", Email: "jane@example.com", Programme: programmes[0]?.name || "Foundations" },
      { Name: "John Smith", Email: "john@example.com", Programme: programmes[0]?.name || "Foundations" },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Coachees");
    XLSX.writeFile(wb, "coachees-import-template.xlsx");
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
      const progByName = new Map(programmes.map(p => [p.name.toLowerCase(), p]));
      const existingEmails = new Set(rows.map(r => r.email.toLowerCase()));

      let enrolledExisting = 0;
      let stagedNew = 0;
      let skipped = 0;
      const stagedPayload: any[] = [];
      const enrollPayload: any[] = [];

      for (const r of data) {
        const email = String(r.Email || r.email || "").trim().toLowerCase();
        const name = String(r.Name || r.name || "").trim() || email.split("@")[0];
        const progName = String(r.Programme || r.programme || "").trim().toLowerCase();
        if (!email || !progName) { skipped++; continue; }
        const prog = progByName.get(progName);
        if (!prog) { skipped++; continue; }

        if (existingEmails.has(email)) {
          // enroll existing coachee
          const existing = rows.find(x => x.email.toLowerCase() === email);
          if (existing) {
            if (existing.enrollment_id) {
              await supabase.from("programme_enrollments").update({ programme_id: prog.id }).eq("id", existing.enrollment_id);
            } else {
              enrollPayload.push({ coachee_id: existing.id, programme_id: prog.id });
            }
            enrolledExisting++;
          }
        } else {
          stagedPayload.push({ email, full_name: name, programme_id: prog.id });
          stagedNew++;
        }
      }
      if (enrollPayload.length) await supabase.from("programme_enrollments").insert(enrollPayload);
      if (stagedPayload.length) await supabase.from("staged_enrollments").upsert(stagedPayload, { onConflict: "email" });

      toast.success(`Import done: ${enrolledExisting} enrolled, ${stagedNew} staged for signup, ${skipped} skipped`);
      setImportOpen(false);
      if (fileRef.current) fileRef.current.value = "";
      load();
    } catch (err: any) {
      toast.error(err.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!editing.programme_id) {
      toast.error("Programme is required");
      return;
    }
    setSaving(true);
    try {
      await supabase.from("profiles").update({
        full_name: editing.full_name, status: editing.status,
      }).eq("id", editing.id);

      // session limit override
      if (editing.limit_row_id) {
        await supabase.from("session_limits").update({ monthly_limit: editing.session_limit }).eq("id", editing.limit_row_id);
      } else {
        await supabase.from("session_limits").insert({ coachee_id: editing.id, monthly_limit: editing.session_limit });
      }

      // Selected coaches diff
      const original = rows.find(r => r.id === editing.id);
      const oldIds = new Set((original?.selected_coaches || []).map(c => c.id));
      const newIds = new Set(editing.selected_coaches.map(c => c.id));
      const toAdd = [...newIds].filter(i => !oldIds.has(i));
      const toRemove = [...oldIds].filter(i => !newIds.has(i));
      if (toAdd.length) {
        await supabase.from("coachee_coach_allowlist").insert(toAdd.map(cid => ({ coachee_id: editing.id, coach_id: cid })));
      }
      for (const cid of toRemove) {
        await supabase.from("coachee_coach_allowlist").delete().eq("coachee_id", editing.id).eq("coach_id", cid);
      }

      // Programme/cohort
      if (editing.programme_id) {
        if (editing.enrollment_id) {
          await supabase.from("programme_enrollments").update({
            programme_id: editing.programme_id,
            cohort_id: editing.cohort_id,
          }).eq("id", editing.enrollment_id);
        } else {
          await supabase.from("programme_enrollments").insert({
            coachee_id: editing.id, programme_id: editing.programme_id, cohort_id: editing.cohort_id,
          });
        }
      } else if (editing.enrollment_id) {
        await supabase.from("programme_enrollments").delete().eq("id", editing.enrollment_id);
      }

      toast.success("Coachee updated");
      setEditing(null);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const resetTempPassword = async () => {
    if (!editing?.access_request_id) return;
    setResettingPassword(true);
    try {
      const { data, error } = await supabase.functions.invoke("approve-access-request", {
        body: { request_id: editing.access_request_id, force_reset_password: true },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      const payload = data as { temp_password: string; email: string };
      setResetCredential({
        email: payload.email ?? editing.email,
        password: payload.temp_password,
        full_name: editing.full_name,
      });
      toast.success("Temporary password generated");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Could not reset password");
    } finally {
      setResettingPassword(false);
    }
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const active = rows.filter(r => r.status === "active").length;
  const pending = rows.filter(r => r.status === "pending_approval").length;
  const reachLimit = rows.filter(r => r.status === "reach_limit").length;

  return (
    <div>
      <AdminPageHeader
        title="Coachees"
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
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
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
                  <td className="px-3 py-2.5 text-[11px]">{r.programme_name || <span className="italic text-muted-foreground">—</span>}{r.cohort_name && <p className="text-[10px] text-muted-foreground">{r.cohort_name}</p>}</td>
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
                      <Button variant="ghost" size="sm" title="Edit" onClick={() => setEditing({ ...r, selected_coaches: [...r.selected_coaches] })}><Pencil className="h-3.5 w-3.5" /></Button>
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

      {/* Read-only profile drawer */}
      <CoacheeProfileSheet row={viewing} onClose={() => setViewing(null)} />

      {/* Edit drawer */}
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit coachee</SheetTitle>
            <SheetDescription>{editing?.email}</SheetDescription>
          </SheetHeader>
          {editing && (
            <div className="mt-4 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Full name</Label><Input value={editing.full_name} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} /></div>
                <div>
                  <Label>Status</Label>
                  <Select value={editing.status} onValueChange={(v) => setEditing({ ...editing, status: v as Status })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(STATUS_LABEL) as Status[]).map(s => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Programme <span className="text-destructive">*</span></Label>
                  <Select
                    value={editing.programme_id || ""}
                    onValueChange={(v) => {
                      const prog = programmes.find((p) => p.id === v);
                      setEditing({
                        ...editing,
                        programme_id: v,
                        programme_name: prog?.name || null,
                        programme_default_limit: prog?.coachee_session_limit ?? null,
                        programme_duration_months: prog?.duration_months ?? null,
                        // Auto-default the limit when programme changes (admin can still override below)
                        session_limit: prog?.coachee_session_limit ?? editing.session_limit,
                      });
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select a programme…" /></SelectTrigger>
                    <SelectContent>
                      {programmes.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[10px] text-muted-foreground">Required. Defaults the session limit below.</p>
                </div>
                <div>
                  <Label>Session limit (received)</Label>
                  <Input type="number" min={0} value={editing.session_limit} onChange={(e) => setEditing({ ...editing, session_limit: Number(e.target.value) })} />
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Used {editing.done} · programme default {editing.programme_default_limit ?? defaultLimit} (override allowed)
                  </p>
                </div>
              </div>

              <div>
                <Label>Cohort</Label>
                <Select value={editing.cohort_id || "none"} onValueChange={(v) => setEditing({ ...editing, cohort_id: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {cohorts.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-lg border p-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Selected coaches (whom they can book)</p>
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {coachOpts.map(c => {
                    const checked = editing.selected_coaches.some(a => a.id === c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-muted/50 cursor-pointer">
                        <Checkbox checked={checked} onCheckedChange={(v) => {
                          const next = v
                            ? [...editing.selected_coaches, { id: c.id, name: c.name }]
                            : editing.selected_coaches.filter(a => a.id !== c.id);
                          setEditing({ ...editing, selected_coaches: next });
                        }} />
                        <span className="text-[12px]">{c.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-lg bg-muted/40 p-3 text-[11px] text-muted-foreground">
                <p>Sessions: <strong>{editing.done}</strong> completed · <strong>{editing.booked}</strong> booked</p>
              </div>

              <div className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Temporary password</p>
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      For security, temporary passwords are never stored. Click <strong>Reset password</strong> to generate a new one — it will be shown once so you can share it with the user.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetTempPassword}
                    disabled={!editing.access_request_id || resettingPassword}
                  >
                    {resettingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Reset password
                  </Button>
                </div>
              </div>
            </div>
          )}
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* One-time temporary password dialog */}
      <Dialog open={!!resetCredential} onOpenChange={(o) => !o && setResetCredential(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New temporary password for {resetCredential?.full_name}</DialogTitle>
            <DialogDescription>
              Copy and share this password privately. It is shown only once and is not stored anywhere — generate a new one if you lose it.
            </DialogDescription>
          </DialogHeader>
          {resetCredential && (
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Email</p>
                <div className="mt-1 flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                  <code className="flex-1 text-[13px]">{resetCredential.email}</code>
                  <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(resetCredential.email); toast.success("Copied"); }}>Copy</Button>
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Temporary password</p>
                <div className="mt-1 flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                  <code className="flex-1 font-mono text-[13px]">{resetCredential.password}</code>
                  <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(resetCredential.password); toast.success("Copied"); }}>Copy</Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setResetCredential(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import coachees from Excel</DialogTitle>
            <DialogDescription>
              Required columns: <strong>Name, Email, Programme</strong>. Existing accounts will be enrolled.
              New emails will be staged — when they sign up, the programme is auto-applied.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Button variant="outline" size="sm" onClick={downloadTemplate}><Download className="h-4 w-4" /> Download template</Button>
            <div className="rounded-lg border-2 border-dashed border-border p-8 text-center">
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onImportFile} className="hidden" id="import-file" />
              <label htmlFor="import-file" className="cursor-pointer">
                {importing ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /> : <FileUp className="mx-auto h-6 w-6 text-muted-foreground" />}
                <p className="mt-2 text-sm font-medium">{importing ? "Importing…" : "Click to upload .xlsx / .csv"}</p>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importing}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Read-only profile drawer ----------

interface ProfileSheetProps {
  row: Row | null;
  onClose: () => void;
}

interface ProfileGoal {
  id: string;
  title: string;
  start_rating: number;
  current_rating: number;
  target_rating: number;
}

interface ProfileSession {
  id: string;
  topic: string;
  start_time: string;
  status: string;
}

function CoacheeProfileSheet({ row, onClose }: ProfileSheetProps) {
  const [loading, setLoading] = useState(false);
  const [goals, setGoals] = useState<ProfileGoal[]>([]);
  const [sessions, setSessions] = useState<ProfileSession[]>([]);
  const [profileData, setProfileData] = useState<{
    bio: string | null;
    job_title: string | null;
    industry: string | null;
    location: string | null;
    phone: string | null;
    timezone: string | null;
    goals: string | null;
  } | null>(null);

  useEffect(() => {
    if (!row) return;
    (async () => {
      setLoading(true);
      const [{ data: gs }, { data: rs }, { data: ss }, { data: prof }, { data: cprof }] = await Promise.all([
        supabase.from("coachee_goals").select("id, title").eq("coachee_id", row.id).eq("status", "active").order("sort_order"),
        supabase.from("coachee_goal_ratings").select("goal_id, start_rating, current_rating, target_rating").eq("coachee_id", row.id),
        supabase.from("sessions").select("id, topic, start_time, status").eq("coachee_id", row.id).order("start_time", { ascending: false }).limit(10),
        supabase.from("profiles").select("bio").eq("id", row.id).maybeSingle(),
        supabase.from("coachee_profiles").select("job_title, industry, location, phone, timezone, goals").eq("id", row.id).maybeSingle(),
      ]);
      const ratingByGoal = new Map((rs || []).map((r: any) => [r.goal_id, r]));
      setGoals((gs || []).map((g: any) => {
        const r: any = ratingByGoal.get(g.id) || {};
        return {
          id: g.id,
          title: g.title,
          start_rating: r.start_rating ?? 30,
          current_rating: r.current_rating ?? 30,
          target_rating: r.target_rating ?? 80,
        };
      }));
      setSessions((ss || []) as any);
      setProfileData({
        bio: (prof as any)?.bio ?? null,
        job_title: (cprof as any)?.job_title ?? null,
        industry: (cprof as any)?.industry ?? null,
        location: (cprof as any)?.location ?? null,
        phone: (cprof as any)?.phone ?? null,
        timezone: (cprof as any)?.timezone ?? null,
        goals: (cprof as any)?.goals ?? null,
      });
      setLoading(false);
    })();
  }, [row]);

  if (!row) return null;
  const pct = programmeCompletionPct(row.enrollment_start_date, row.programme_duration_months);

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" /> {row.full_name}
          </SheetTitle>
          <SheetDescription>{row.email} · read-only</SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-5 text-sm">
          {/* Profile information (from coachee's own profile editor) */}
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Profile information
            </p>
            <div className="grid grid-cols-2 gap-2">
              <ProfileField label="Job title" value={profileData?.job_title} />
              <ProfileField label="Industry" value={profileData?.industry} />
              <ProfileField label="Location" value={profileData?.location} />
              <ProfileField label="Timezone" value={profileData?.timezone} />
              <ProfileField label="Phone" value={profileData?.phone} />
              <ProfileField label="Registered" value={format(new Date(row.created_at), "MMM d, yyyy")} />
            </div>
            {profileData?.bio && (
              <div className="mt-2 rounded-lg border bg-muted/20 p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Bio</p>
                <p className="mt-1 whitespace-pre-wrap text-[12px]">{profileData.bio}</p>
              </div>
            )}
            {profileData?.goals && (
              <div className="mt-2 rounded-lg border bg-muted/20 p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Goals (free text)</p>
                <p className="mt-1 whitespace-pre-wrap text-[12px]">{profileData.goals}</p>
              </div>
            )}
          </div>

          {/* Status + programme */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Status</p>
              <p className="mt-1"><Pill tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Pill></p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Sessions</p>
              <p className="mt-1 font-mono text-[13px]">{row.done}/{row.session_limit} <span className="text-muted-foreground">· booked {row.booked}</span></p>
            </div>
            <div className="col-span-2 rounded-lg border bg-muted/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5"><Layers className="h-3 w-3" /> Programme</p>
              <p className="mt-1 text-[13px] font-semibold">{row.programme_name || "—"}</p>
              {row.cohort_name && <p className="text-[11px] text-muted-foreground">Cohort · {row.cohort_name}</p>}
              {pct !== null && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Programme progress</span><span className="font-mono">{pct}%</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Goals + ratings */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <Target className="h-3 w-3" /> Goals & ratings
            </p>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            {!loading && goals.length === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-center text-[12px] text-muted-foreground">No active goals.</p>
            )}
            <div className="space-y-2">
              {goals.map((g) => (
                <div key={g.id} className="rounded-lg border p-2.5">
                  <p className="text-[12px] font-semibold">{g.title}</p>
                  <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>Start <strong className="text-foreground">{g.start_rating}</strong></span>
                    <span>Current <strong className="text-foreground">{g.current_rating}</strong></span>
                    <span>Target <strong className="text-foreground">{g.target_rating}</strong></span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${Math.min(100, g.current_rating)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Selected coaches */}
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Selected coaches</p>
            <div className="flex flex-wrap gap-1.5">
              {row.selected_coaches.length === 0 && <span className="text-[11px] italic text-muted-foreground">None</span>}
              {row.selected_coaches.map((c) => (
                <span key={c.id} className="rounded-full border bg-muted/40 px-2 py-0.5 text-[11px]">{c.name}</span>
              ))}
            </div>
          </div>

          {/* Sessions */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <Calendar className="h-3 w-3" /> Recent sessions
            </p>
            <div className="space-y-1">
              {sessions.length === 0 && (
                <p className="rounded-lg border border-dashed p-3 text-center text-[12px] text-muted-foreground">No sessions yet.</p>
              )}
              {sessions.map((s) => (
                <Link
                  key={s.id}
                  to={`/sessions/${s.id}`}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 text-[12px] hover:bg-muted/30"
                >
                  <span className="truncate pr-2">{s.topic}</span>
                  <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{format(new Date(s.start_time), "MMM d")}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5">{s.status}</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <SheetFooter className="mt-6">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ProfileField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-lg border bg-muted/10 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-[12px]">{value || <span className="italic text-muted-foreground">—</span>}</p>
    </div>
  );
}
