import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Loader2, Search, FileDown, Eye, Star, Users, Pencil, Save,
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

interface CoachRow {
  id: string;
  full_name: string;
  email: string;
  status: Status;
  created_at: string;
  approval_status: string;
  rating_avg: number;
  // Coach as receiver
  coach_session_limit: number;
  coach_used: number;
  peer_session_limit: number;
  peer_used: number;
  assigned_coaches: { id: string; name: string }[];
  // Coach as deliverer
  coachees_count: number;
  booked_sessions: number;
  completed_sessions: number;
  // Cohort/programme
  cohort_id: string | null;
  cohort_name: string | null;
  programme_id: string | null;
  programme_name: string | null;
  limit_row_id: string | null;
  enrollment_id: string | null;
}

export default function AdminCoaches() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CoachRow[]>([]);
  const [coachOpts, setCoachOpts] = useState<{ id: string; name: string }[]>([]);
  const [cohorts, setCohorts] = useState<{ id: string; name: string }[]>([]);
  const [programmes, setProgrammes] = useState<{ id: string; name: string; coach_session_limit: number; peer_session_limit: number }[]>([]);
  const [defaultCoachLimit, setDefaultCoachLimit] = useState(4);
  const [defaultPeerLimit, setDefaultPeerLimit] = useState(4);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");
  const [editing, setEditing] = useState<CoachRow | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [
      { data: roles },
      { data: profiles },
      { data: cps },
      { data: sess },
      { data: peerSess },
      { data: limits },
      { data: assigned },
      { data: cohortsData },
      { data: progsData },
      { data: enrolls },
    ] = await Promise.all([
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("profiles").select("id, full_name, email, status, created_at"),
      supabase.from("coach_profiles").select("id, approval_status, rating_avg"),
      supabase.from("sessions").select("coach_id, coachee_id, status"),
      supabase.from("peer_sessions").select("peer_coach_id, peer_coachee_id, status"),
      supabase.from("coach_session_limits").select("id, coach_user_id, monthly_limit, peer_monthly_limit"),
      supabase.from("coach_as_coachee_allowlist").select("coach_user_id, selectable_coach_id"),
      supabase.from("cohorts").select("id, name"),
      supabase.from("programmes").select("id, name, coach_session_limit, peer_session_limit"),
      supabase.from("programme_enrollments").select("id, coachee_id, programme_id, cohort_id"),
    ]);

    const coachIds = (roles || []).filter(r => r.role === "coach").map(r => r.user_id);
    const profileById = new Map((profiles || []).map((p: any) => [p.id, p]));
    const cpById = new Map((cps || []).map((c: any) => [c.id, c]));
    const coachNameById = new Map<string, string>();
    coachIds.forEach(id => {
      const p: any = profileById.get(id);
      if (p) coachNameById.set(id, p.full_name);
    });

    const def = (limits || []).find((l: any) => l.coach_user_id === null);
    const defCoach = def?.monthly_limit ?? 4;
    const defPeer = def?.peer_monthly_limit ?? 4;
    setDefaultCoachLimit(defCoach);
    setDefaultPeerLimit(defPeer);
    const limitByCoach = new Map<string, any>();
    (limits || []).filter((l: any) => l.coach_user_id).forEach((l: any) => limitByCoach.set(l.coach_user_id, l));

    // sessions delivered
    const completedDelivered = new Map<string, number>();
    const bookedDelivered = new Map<string, number>();
    const uniqueCoachees = new Map<string, Set<string>>();
    // sessions received as coachee
    const receivedDone = new Map<string, number>();
    (sess || []).forEach((s: any) => {
      if (s.status === "completed") {
        completedDelivered.set(s.coach_id, (completedDelivered.get(s.coach_id) || 0) + 1);
        if (coachIds.includes(s.coachee_id)) {
          receivedDone.set(s.coachee_id, (receivedDone.get(s.coachee_id) || 0) + 1);
        }
      }
      if (["pending_coach_approval", "confirmed"].includes(s.status)) {
        bookedDelivered.set(s.coach_id, (bookedDelivered.get(s.coach_id) || 0) + 1);
      }
      if (["confirmed", "completed"].includes(s.status)) {
        const set = uniqueCoachees.get(s.coach_id) || new Set();
        set.add(s.coachee_id);
        uniqueCoachees.set(s.coach_id, set);
      }
    });
    const peerReceived = new Map<string, number>();
    (peerSess || []).forEach((s: any) => {
      if (s.status === "completed") {
        peerReceived.set(s.peer_coachee_id, (peerReceived.get(s.peer_coachee_id) || 0) + 1);
      }
    });

    const assignedByCoach = new Map<string, { id: string; name: string }[]>();
    (assigned || []).forEach((a: any) => {
      const arr = assignedByCoach.get(a.coach_user_id) || [];
      arr.push({ id: a.selectable_coach_id, name: coachNameById.get(a.selectable_coach_id) || "—" });
      assignedByCoach.set(a.coach_user_id, arr);
    });

    const enrollByUser = new Map<string, any>();
    (enrolls || []).forEach((e: any) => enrollByUser.set(e.coachee_id, e));
    const cohortById = new Map((cohortsData || []).map((c: any) => [c.id, c.name]));
    const progById = new Map((progsData || []).map((p: any) => [p.id, p.name]));

    const out: CoachRow[] = coachIds.map(id => {
      const p: any = profileById.get(id);
      const cp: any = cpById.get(id);
      if (!p) return null;
      const lim = limitByCoach.get(id);
      const enr = enrollByUser.get(id);
      return {
        id,
        full_name: p.full_name,
        email: p.email,
        status: p.status as Status,
        created_at: p.created_at,
        approval_status: cp?.approval_status || "pending_approval",
        rating_avg: Number(cp?.rating_avg || 0),
        coach_session_limit: lim?.monthly_limit ?? defCoach,
        coach_used: receivedDone.get(id) || 0,
        peer_session_limit: lim?.peer_monthly_limit ?? defPeer,
        peer_used: peerReceived.get(id) || 0,
        assigned_coaches: assignedByCoach.get(id) || [],
        coachees_count: (uniqueCoachees.get(id) || new Set()).size,
        booked_sessions: bookedDelivered.get(id) || 0,
        completed_sessions: completedDelivered.get(id) || 0,
        cohort_id: enr?.cohort_id || null,
        cohort_name: enr?.cohort_id ? (cohortById.get(enr.cohort_id) as string) || null : null,
        programme_id: enr?.programme_id || null,
        programme_name: enr?.programme_id ? (progById.get(enr.programme_id) as string) || null : null,
        limit_row_id: lim?.id ?? null,
        enrollment_id: enr?.id ?? null,
      } as CoachRow;
    }).filter(Boolean) as CoachRow[];

    setRows(out.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)));
    setCoachOpts(coachIds.map(id => ({ id, name: coachNameById.get(id) || "—" })).filter(c => c.name !== "—").sort((a, b) => a.name.localeCompare(b.name)));
    setCohorts((cohortsData || []) as any);
    setProgrammes((progsData || []) as any);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => rows.filter(r => {
    const text = q.trim().toLowerCase();
    const okQ = !text || r.full_name.toLowerCase().includes(text) || r.email.toLowerCase().includes(text);
    const okS = statusFilter === "all" || r.status === statusFilter;
    return okQ && okS;
  }), [rows, q, statusFilter]);

  const exportXlsx = () => {
    const data = filtered.map(c => ({
      Name: c.full_name,
      Email: c.email,
      Registered: format(new Date(c.created_at), "yyyy-MM-dd"),
      Status: STATUS_LABEL[c.status],
      "Coach session limit": c.coach_session_limit,
      "Coach sessions used": c.coach_used,
      "Assigned coaches": c.assigned_coaches.map(x => x.name).join("; "),
      "Peer session limit": c.peer_session_limit,
      "Peer sessions used": c.peer_used,
      "# Coachees": c.coachees_count,
      "Avg rating": c.rating_avg.toFixed(2),
      "Booked coaching sessions": c.booked_sessions,
      "Completed coaching sessions": c.completed_sessions,
      Cohort: c.cohort_name || "",
      Programme: c.programme_name || "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Coaches");
    XLSX.writeFile(wb, `coaches-${format(new Date(), "yyyyMMdd")}.xlsx`);
    toast.success("Exported");
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      // 1. Profile + coach_profiles status
      await supabase.from("profiles").update({
        full_name: editing.full_name,
        status: editing.status,
      }).eq("id", editing.id);
      await supabase.from("coach_profiles").update({
        approval_status: editing.status as any,
        ...(editing.status === "active" ? { last_approved_at: new Date().toISOString() } : {}),
      }).eq("id", editing.id);

      // 2. Limits
      if (editing.limit_row_id) {
        await supabase.from("coach_session_limits").update({
          monthly_limit: editing.coach_session_limit,
          peer_monthly_limit: editing.peer_session_limit,
        }).eq("id", editing.limit_row_id);
      } else {
        await supabase.from("coach_session_limits").insert({
          coach_user_id: editing.id,
          monthly_limit: editing.coach_session_limit,
          peer_monthly_limit: editing.peer_session_limit,
        });
      }

      // 3. Assigned coaches diff
      const original = rows.find(r => r.id === editing.id);
      const oldIds = new Set((original?.assigned_coaches || []).map(c => c.id));
      const newIds = new Set(editing.assigned_coaches.map(c => c.id));
      const toAdd = [...newIds].filter(i => !oldIds.has(i));
      const toRemove = [...oldIds].filter(i => !newIds.has(i));
      if (toAdd.length) {
        await supabase.from("coach_as_coachee_allowlist").insert(
          toAdd.map(sid => ({ coach_user_id: editing.id, selectable_coach_id: sid }))
        );
      }
      for (const sid of toRemove) {
        await supabase.from("coach_as_coachee_allowlist").delete()
          .eq("coach_user_id", editing.id).eq("selectable_coach_id", sid);
      }

      // 4. Cohort enrollment (a coach can be in a cohort only via programme_enrollments — we use it loosely)
      if (editing.cohort_id || editing.programme_id) {
        if (editing.enrollment_id) {
          await supabase.from("programme_enrollments").update({
            cohort_id: editing.cohort_id,
            programme_id: editing.programme_id || original?.programme_id || (programmes[0]?.id ?? null),
          }).eq("id", editing.enrollment_id);
        } else if (editing.programme_id) {
          await supabase.from("programme_enrollments").insert({
            coachee_id: editing.id,
            programme_id: editing.programme_id,
            cohort_id: editing.cohort_id,
          });
        }
      } else if (editing.enrollment_id) {
        await supabase.from("programme_enrollments").delete().eq("id", editing.enrollment_id);
      }

      toast.success("Coach updated");
      setEditing(null);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const active = rows.filter(r => r.status === "active").length;
  const pending = rows.filter(r => r.status === "pending_approval").length;
  const reachLimit = rows.filter(r => r.status === "reach_limit").length;

  return (
    <div>
      <AdminPageHeader
        title="Coaches"
        subtitle={`${rows.length} total coaches · click any row to edit`}
        right={
          <Button variant="outline" size="sm" onClick={exportXlsx}>
            <FileDown className="h-4 w-4" /> Export Excel
          </Button>
        }
      />

      <PendingAccessRequests variant="coach" onApproved={load} />

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
            {(Object.keys(STATUS_LABEL) as Status[]).map(s => (
              <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold">Coach</th>
                <th className="px-3 py-2.5 text-left font-semibold">Status</th>
                <th className="px-3 py-2.5 text-left font-semibold">Registered</th>
                <th className="px-3 py-2.5 text-left font-semibold">Coach limit</th>
                <th className="px-3 py-2.5 text-left font-semibold">Assigned</th>
                <th className="px-3 py-2.5 text-left font-semibold">Peer limit</th>
                <th className="px-3 py-2.5 text-left font-semibold"># Coachees</th>
                <th className="px-3 py-2.5 text-left font-semibold">Rating</th>
                <th className="px-3 py-2.5 text-left font-semibold">Booked</th>
                <th className="px-3 py-2.5 text-left font-semibold">Done</th>
                <th className="px-3 py-2.5 text-left font-semibold">Cohort</th>
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
                  <td className="px-3 py-2.5"><span className="font-mono text-[11px]">{r.coach_used}/{r.coach_session_limit}</span></td>
                  <td className="px-3 py-2.5 text-[11px]">{r.assigned_coaches.length === 0 ? <span className="italic text-muted-foreground">—</span> : `${r.assigned_coaches.length} coach${r.assigned_coaches.length === 1 ? "" : "es"}`}</td>
                  <td className="px-3 py-2.5"><span className="font-mono text-[11px]">{r.peer_used}/{r.peer_session_limit}</span></td>
                  <td className="px-3 py-2.5 text-[11px]">{r.coachees_count}</td>
                  <td className="px-3 py-2.5 text-[11px]">
                    <span className="inline-flex items-center gap-1"><Star className="h-3 w-3 fill-warning text-warning" /> {r.rating_avg.toFixed(1)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-[11px]">{r.booked_sessions}</td>
                  <td className="px-3 py-2.5 text-[11px]">{r.completed_sessions}</td>
                  <td className="px-3 py-2.5 text-[11px]">{r.cohort_name || <span className="italic text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex gap-1">
                      <Button asChild variant="ghost" size="sm" title="View profile"><Link to={`/coaches/${r.id}`}><Eye className="h-3.5 w-3.5" /></Link></Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditing({ ...r, assigned_coaches: [...r.assigned_coaches] })}><Pencil className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={12} className="p-12 text-center text-sm text-muted-foreground">No coaches match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Edit drawer */}
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit coach</SheetTitle>
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

              <div className="rounded-lg border p-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">As coachee — limits</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Coach session limit</Label>
                    <Input type="number" min={0} value={editing.coach_session_limit} onChange={(e) => setEditing({ ...editing, coach_session_limit: Number(e.target.value) })} />
                    <p className="mt-1 text-[10px] text-muted-foreground">Used {editing.coach_used} · default {defaultCoachLimit}</p>
                  </div>
                  <div>
                    <Label>Peer session limit</Label>
                    <Input type="number" min={0} value={editing.peer_session_limit} onChange={(e) => setEditing({ ...editing, peer_session_limit: Number(e.target.value) })} />
                    <p className="mt-1 text-[10px] text-muted-foreground">Used {editing.peer_used} · default {defaultPeerLimit}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Assigned coaches (when this coach is being coached)</p>
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {coachOpts.filter(c => c.id !== editing.id).map(c => {
                    const checked = editing.assigned_coaches.some(a => a.id === c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-muted/50 cursor-pointer">
                        <Checkbox checked={checked} onCheckedChange={(v) => {
                          const next = v
                            ? [...editing.assigned_coaches, { id: c.id, name: c.name }]
                            : editing.assigned_coaches.filter(a => a.id !== c.id);
                          setEditing({ ...editing, assigned_coaches: next });
                        }} />
                        <span className="text-[12px]">{c.name}</span>
                      </label>
                    );
                  })}
                </div>
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

              <div className="rounded-lg bg-muted/40 p-3 text-[11px] text-muted-foreground">
                <p>Sessions delivered: <strong>{editing.completed_sessions}</strong> completed · <strong>{editing.booked_sessions}</strong> booked</p>
                <p>Coachees served: <strong>{editing.coachees_count}</strong></p>
                <p>Avg rating: <strong>{editing.rating_avg.toFixed(2)}</strong></p>
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
    </div>
  );
}
