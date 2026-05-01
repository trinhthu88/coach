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
  Loader2, Search, FileDown, FileUp, Eye, Users, Pencil, Save, Download,
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
  cohort_id: string | null;
  cohort_name: string | null;
  enrollment_id: string | null;
  selected_coaches: { id: string; name: string }[];
  session_limit: number;
  limit_row_id: string | null;
  access_request_id: string | null;
}

export default function AdminCoachees() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [coachOpts, setCoachOpts] = useState<{ id: string; name: string }[]>([]);
  const [programmes, setProgrammes] = useState<{ id: string; name: string; coachee_session_limit: number }[]>([]);
  const [cohorts, setCohorts] = useState<{ id: string; name: string }[]>([]);
  const [defaultLimit, setDefaultLimit] = useState(4);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");
  const [editing, setEditing] = useState<Row | null>(null);
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
      supabase.from("programme_enrollments").select("id, coachee_id, programme_id, cohort_id"),
      supabase.from("programmes").select("id, name, coachee_session_limit").eq("is_active", true),
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
    const progById = new Map((progs || []).map((p: any) => [p.id, p.name]));
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
    const credentialByUser = new Map<string, any>();
    (credentials || []).forEach((c: any) => credentialByUser.set(c.user_id, c));
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
      const cred = credentialByUser.get(id);
      return {
        id,
        full_name: p.full_name,
        email: p.email,
        status: p.status as Status,
        created_at: p.created_at,
        booked: booked.get(id) || 0,
        done: done.get(id) || 0,
        programme_id: enr?.programme_id || null,
        programme_name: enr?.programme_id ? (progById.get(enr.programme_id) as string) || null : null,
        cohort_id: enr?.cohort_id || null,
        cohort_name: enr?.cohort_id ? (cohortById.get(enr.cohort_id) as string) || null : null,
        enrollment_id: enr?.id || null,
        selected_coaches: allowByCoachee.get(id) || [],
        session_limit: lim?.monthly_limit ?? defLimit,
        limit_row_id: lim?.id || null,
        temp_password: cred?.temporary_password ?? null,
        temp_password_issued_at: cred?.issued_at ?? null,
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

      const payload = data as { temp_password: string };
      setEditing({
        ...editing,
        temp_password: payload.temp_password,
        temp_password_issued_at: new Date().toISOString(),
      });
      toast.success("Temporary password reset");
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
                  <td className="px-3 py-2.5 text-[11px]">{r.selected_coaches.length === 0 ? <span className="italic text-muted-foreground">—</span> : `${r.selected_coaches.length} coach${r.selected_coaches.length === 1 ? "" : "es"}`}</td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex gap-1">
                      <Button variant="ghost" size="sm" title="Edit" onClick={() => setEditing({ ...r, selected_coaches: [...r.selected_coaches] })}><Pencil className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="p-12 text-center text-sm text-muted-foreground">No coachees match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

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

              <div>
                <Label>Session limit (received)</Label>
                <Input type="number" min={0} value={editing.session_limit} onChange={(e) => setEditing({ ...editing, session_limit: Number(e.target.value) })} />
                <p className="mt-1 text-[10px] text-muted-foreground">Used {editing.done} · default {defaultLimit}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Programme</Label>
                  <Select value={editing.programme_id || "none"} onValueChange={(v) => setEditing({ ...editing, programme_id: v === "none" ? null : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— None —</SelectItem>
                      {programmes.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
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
                    <p className="mt-2 font-mono text-sm text-foreground">
                      {editing.temp_password || "No temporary password stored yet"}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {editing.temp_password_issued_at
                        ? `Issued ${format(new Date(editing.temp_password_issued_at), "MMM d, yyyy · HH:mm")}`
                        : "Visible to admins only"}
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
