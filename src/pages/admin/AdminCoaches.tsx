import { useEffect, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
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
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Loader2, Search, FileDown, Eye, Star, Users, Pencil, Save,
} from "lucide-react";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { upsertCoacheeEnrollment } from "@/lib/enrollmentTransition";

function programmeCompletionPct(startDate: string | null, durationMonths: number | null): number | null {
  if (!startDate || !durationMonths) return null;
  const start = new Date(startDate).getTime();
  const end = start + durationMonths * 30.4375 * 24 * 3600 * 1000;
  const now = Date.now();
  if (now <= start) return 0;
  if (now >= end) return 100;
  return Math.round(((now - start) / (end - start)) * 100);
}
import { format } from "date-fns";
import { AdminPageHeader, Kpi, Pill, Avatar, TablePager } from "./_shared";
import PendingAccessRequests from "@/components/PendingAccessRequests";
import type { Tables } from "@/integrations/supabase/types";

type Status = "pending_approval" | "active" | "rejected" | "suspended" | "reach_limit";
const STATUS_KEYS: Status[] = ["pending_approval", "active", "rejected", "suspended", "reach_limit"];
const PAGE_SIZE = 25;
const STATUS_TONE: Record<Status, "muted"|"success"|"warning"|"destructive"> = {
  pending_approval: "warning",
  active: "success",
  rejected: "destructive",
  suspended: "destructive",
  reach_limit: "warning",
};

// null = unlimited (coach_programmes limit column); a coach with no coach programme
// enrollment falls back to 4, matching the DB-side fallback in enforce_coach_as_coachee_limit().
function fmtLimit(n: number | null): string {
  return n === null ? "∞" : String(n);
}

interface CoachRow {
  id: string;
  full_name: string;
  email: string;
  status: Status;
  created_at: string;
  approval_status: string;
  rating_avg: number;
  // Coach as receiver — sourced from coach_programme_enrollments -> coach_programmes
  coach_session_limit: number | null;
  coach_used: number;
  peer_session_limit: number | null;
  peer_used: number;
  peer_given_limit: number | null;
  peer_given_used: number;
  coach_programme_name: string | null;
  assigned_coaches: { id: string; name: string }[];
  // Coach as deliverer
  coachees_count: number;
  booked_sessions: number;
  completed_sessions: number;
  // Cohort/programme (coachee-side programme this coach is enrolled in for their own
  // coaching journey — unrelated to their coach-programme session limits above)
  cohort_id: string | null;
  cohort_name: string | null;
  programme_id: string | null;
  programme_name: string | null;
  programme_duration_months: number | null;
  enrollment_start_date: string | null;
  enrollment_id: string | null;
}

export default function AdminCoaches() {
  const { t } = useTranslation("admin");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CoachRow[]>([]);
  const [coachOpts, setCoachOpts] = useState<{ id: string; name: string }[]>([]);
  const [cohorts, setCohorts] = useState<{ id: string; name: string }[]>([]);
  const [programmes, setProgrammes] = useState<{ id: string; name: string; coachee_session_limit: number; peer_session_limit: number; peer_given_limit: number; duration_months: number }[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");
  const [editing, setEditing] = useState<CoachRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    const [
      { data: roles },
      { data: profiles },
      { data: cps },
      { data: sess },
      { data: peerSess },
      { data: coachEnrollments },
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
      supabase.from("coach_programme_enrollments").select("coach_id, coach_programme:coach_programmes(name, mentee_sessions_limit, peer_received_limit, peer_given_limit)"),
      supabase.from("coach_as_coachee_allowlist").select("coach_user_id, selectable_coach_id"),
      supabase.from("cohorts").select("id, name"),
      supabase.from("programmes").select("id, name, coachee_session_limit, peer_session_limit, peer_given_limit, duration_months"),
      supabase.from("programme_enrollments").select("id, user_id, programme_id, cohort_id, start_date"),
    ]);

    const coachIds = (roles || []).filter(r => r.role === "coach").map(r => r.user_id);
    const profileById = new Map((profiles || []).map((p) => [p.id, p]));
    const cpById = new Map((cps || []).map((c) => [c.id, c]));
    const coachNameById = new Map<string, string>();
    coachIds.forEach(id => {
      const p = profileById.get(id);
      if (p) coachNameById.set(id, p.full_name);
    });

    const enrollmentByCoach = new Map((coachEnrollments || []).map((e) => [e.coach_id, e]));

    // sessions delivered
    const completedDelivered = new Map<string, number>();
    const bookedDelivered = new Map<string, number>();
    const uniqueCoachees = new Map<string, Set<string>>();
    // sessions received as coachee
    const receivedDone = new Map<string, number>();
    (sess || []).forEach((s) => {
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
    const peerGiven = new Map<string, number>();
    (peerSess || []).forEach((s) => {
      if (s.status === "completed") {
        peerReceived.set(s.peer_coachee_id, (peerReceived.get(s.peer_coachee_id) || 0) + 1);
        peerGiven.set(s.peer_coach_id, (peerGiven.get(s.peer_coach_id) || 0) + 1);
      }
    });

    const assignedByCoach = new Map<string, { id: string; name: string }[]>();
    (assigned || []).forEach((a) => {
      const arr = assignedByCoach.get(a.coach_user_id) || [];
      arr.push({ id: a.selectable_coach_id, name: coachNameById.get(a.selectable_coach_id) || "—" });
      assignedByCoach.set(a.coach_user_id, arr);
    });

    const enrollByUser = new Map<string, Pick<Tables<"programme_enrollments">, "id" | "user_id" | "programme_id" | "cohort_id" | "start_date">>();
    (enrolls || []).forEach((e) => enrollByUser.set(e.user_id, e));
    const cohortById = new Map((cohortsData || []).map((c) => [c.id, c.name]));
    const progById = new Map((progsData || []).map((p) => [p.id, p]));

    const out: CoachRow[] = coachIds.map(id => {
      const p = profileById.get(id);
      const cp = cpById.get(id);
      if (!p) return null;
      const coachEnr = enrollmentByCoach.get(id);
      const coachProg = coachEnr?.coach_programme;
      const enr = enrollByUser.get(id);
      const prog = enr?.programme_id ? progById.get(enr.programme_id) : null;
      return {
        id,
        full_name: p.full_name,
        email: p.email,
        status: p.status as Status,
        created_at: p.created_at,
        approval_status: cp?.approval_status || "pending_approval",
        rating_avg: Number(cp?.rating_avg || 0),
        coach_session_limit: coachEnr ? coachProg?.mentee_sessions_limit ?? null : 4,
        coach_used: receivedDone.get(id) || 0,
        peer_session_limit: coachEnr ? coachProg?.peer_received_limit ?? null : 4,
        peer_used: peerReceived.get(id) || 0,
        peer_given_limit: coachEnr ? coachProg?.peer_given_limit ?? null : 4,
        peer_given_used: peerGiven.get(id) || 0,
        coach_programme_name: coachProg?.name ?? null,
        assigned_coaches: assignedByCoach.get(id) || [],
        coachees_count: (uniqueCoachees.get(id) || new Set()).size,
        booked_sessions: bookedDelivered.get(id) || 0,
        completed_sessions: completedDelivered.get(id) || 0,
        cohort_id: enr?.cohort_id || null,
        cohort_name: enr?.cohort_id ? (cohortById.get(enr.cohort_id) as string) || null : null,
        programme_id: enr?.programme_id || null,
        programme_name: prog?.name || null,
        programme_duration_months: prog?.duration_months ?? null,
        enrollment_start_date: enr?.start_date || null,
        enrollment_id: enr?.id ?? null,
      } as CoachRow;
    }).filter(Boolean) as CoachRow[];

    setRows(out.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)));
    setCoachOpts(coachIds.map(id => ({ id, name: coachNameById.get(id) || "—" })).filter(c => c.name !== "—").sort((a, b) => a.name.localeCompare(b.name)));
    setCohorts(cohortsData || []);
    setProgrammes(progsData || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => rows.filter(r => {
    const text = q.trim().toLowerCase();
    const okQ = !text || r.full_name.toLowerCase().includes(text) || r.email.toLowerCase().includes(text);
    const okS = statusFilter === "all" || r.status === statusFilter;
    return okQ && okS;
  }), [rows, q, statusFilter]);

  useEffect(() => { setPage(1); }, [q, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const paged = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const exportXlsx = async () => {
    const XLSX = await import("xlsx");
    const data = filtered.map(c => ({
      [t("coaches.export.name")]: c.full_name,
      [t("coaches.export.email")]: c.email,
      [t("coaches.export.registered")]: format(new Date(c.created_at), "yyyy-MM-dd"),
      [t("coaches.export.status")]: t(`coaches.statusLabels.${c.status}`),
      [t("coaches.export.coachProgramme")]: c.coach_programme_name || "",
      [t("coaches.export.coachSessionLimit")]: fmtLimit(c.coach_session_limit),
      [t("coaches.export.coachSessionsUsed")]: c.coach_used,
      [t("coaches.export.assignedCoaches")]: c.assigned_coaches.map(x => x.name).join("; "),
      [t("coaches.export.peerReceivedLimit")]: fmtLimit(c.peer_session_limit),
      [t("coaches.export.peerReceivedUsed")]: c.peer_used,
      [t("coaches.export.peerGivenLimit")]: fmtLimit(c.peer_given_limit),
      [t("coaches.export.peerGivenUsed")]: c.peer_given_used,
      [t("coaches.export.coacheesCount")]: c.coachees_count,
      [t("coaches.export.avgRating")]: c.rating_avg.toFixed(2),
      [t("coaches.export.bookedSessions")]: c.booked_sessions,
      [t("coaches.export.completedSessions")]: c.completed_sessions,
      [t("coaches.export.cohort")]: c.cohort_name || "",
      [t("coaches.export.programme")]: c.programme_name || "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, t("coaches.export.sheetName"));
    XLSX.writeFile(wb, `coaches-${format(new Date(), "yyyyMMdd")}.xlsx`);
    toast.success(t("coaches.exported"));
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!editing.programme_id) {
      toast.error(t("coaches.programmeRequired"));
      return;
    }
    setSaving(true);
    try {
      // 1. Profile + coach_profiles status
      await supabase.from("profiles").update({
        full_name: editing.full_name,
        status: editing.status,
      }).eq("id", editing.id);
      await supabase.from("coach_profiles").update({
        approval_status: editing.status as Tables<"coach_profiles">["approval_status"],
        ...(editing.status === "active" ? { last_approved_at: new Date().toISOString() } : {}),
      }).eq("id", editing.id);

      // Session limits are managed on the Coach Programmes admin page now (coach's
      // coach_programme_enrollments row), not here.

      // 2. Assigned coaches diff
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

      // 3. Programme enrollment (mandatory). Coach is treated as coachee here.
      // A programme change transitions (closes the old active row, keeping
      // it as history) rather than overwriting programme_id in place —
      // ux_programme_enrollments_one_active only allows one active row per
      // person, and a bare update-in-place would silently lose history.
      if (editing.programme_id) {
        const existing = editing.enrollment_id
          ? { id: editing.enrollment_id, programme_id: original?.programme_id ?? null }
          : null;
        const { error } = await upsertCoacheeEnrollment(editing.id, existing, {
          programme_id: editing.programme_id,
          cohort_id: editing.cohort_id,
        });
        if (error) throw error;
      }

      toast.success(t("coaches.coachUpdated"));
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(getFriendlyErrorMessage(e, t, { fallback: t("coaches.saveFailed") }));
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
        eyebrow={t("coaches.eyebrow")}
        title={t("coaches.title")}
        emphasize={t("coaches.titleEmphasis")}
        trailing=""
        subtitle={t("coaches.subtitle", { count: rows.length })}
        right={
          <Button variant="outline" size="sm" onClick={exportXlsx}>
            <FileDown className="h-4 w-4" /> {t("coaches.exportExcel")}
          </Button>
        }
      />

      <PendingAccessRequests variant="coach" onApproved={load} />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Kpi label={t("coaches.kpiTotal")} value={rows.length} icon={Users} tone="primary" />
        <Kpi label={t("coaches.kpiActive")} value={active} icon={Users} tone="success" />
        <Kpi label={t("coaches.kpiAwaitingApproval")} value={pending} icon={Users} tone="warning" />
        <Kpi label={t("coaches.kpiReachedLimit")} value={reachLimit} icon={Users} tone="destructive" />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-64 flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("coaches.searchPlaceholder")} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | Status)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("coaches.allStatuses")}</SelectItem>
            {STATUS_KEYS.map(s => (
              <SelectItem key={s} value={s}>{t(`coaches.statusLabels.${s}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coaches.tableHeaders.coach")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coaches.tableHeaders.status")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coaches.tableHeaders.registered")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coaches.tableHeaders.coachingReceived")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coaches.tableHeaders.peerReceived")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coaches.tableHeaders.peerGiven")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coaches.tableHeaders.programme")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coaches.tableHeaders.percentComplete")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coaches.tableHeaders.assigned")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coaches.tableHeaders.coacheesCount")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coaches.tableHeaders.rating")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coaches.tableHeaders.booked")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coaches.tableHeaders.done")}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{t("coaches.tableHeaders.actions")}</th>
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
                  <td className="px-3 py-2.5"><Pill tone={STATUS_TONE[r.status]}>{t(`coaches.statusLabels.${r.status}`)}</Pill></td>
                  <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{format(new Date(r.created_at), "MMM d, yyyy")}</td>
                  <td className="px-3 py-2.5"><span className="font-mono text-[11px]">{r.coach_used}/{fmtLimit(r.coach_session_limit)}</span></td>
                  <td className="px-3 py-2.5"><span className="font-mono text-[11px]">{r.peer_used}/{fmtLimit(r.peer_session_limit)}</span></td>
                  <td className="px-3 py-2.5"><span className="font-mono text-[11px]">{r.peer_given_used}/{fmtLimit(r.peer_given_limit)}</span></td>
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
                  </td>
                  <td className="px-3 py-2.5 text-[11px]">
                    {(() => {
                      const pct = programmeCompletionPct(r.enrollment_start_date, r.programme_duration_months);
                      if (pct === null) return <span className="italic text-muted-foreground">—</span>;
                      return (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="font-mono text-[10px] text-muted-foreground">{pct}%</span>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2.5 text-[11px]">{r.assigned_coaches.length === 0 ? <span className="italic text-muted-foreground">—</span> : t("coaches.assignedCoachesCount", { count: r.assigned_coaches.length })}</td>
                  <td className="px-3 py-2.5 text-[11px]">{r.coachees_count}</td>
                  <td className="px-3 py-2.5 text-[11px]">
                    <span className="inline-flex items-center gap-1"><Star className="h-3 w-3 fill-warning text-warning" /> {r.rating_avg.toFixed(1)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-[11px]">{r.booked_sessions}</td>
                  <td className="px-3 py-2.5 text-[11px]">{r.completed_sessions}</td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex gap-1">
                      <Button asChild variant="ghost" size="icon" title={t("coaches.viewProfile")}><Link to={`/coaches/${r.id}`}><Eye className="h-3.5 w-3.5" /></Link></Button>
                      <Button variant="ghost" size="icon" title={t("coaches.edit")} aria-label={t("coaches.edit")} onClick={() => setEditing({ ...r, assigned_coaches: [...r.assigned_coaches] })}><Pencil className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={14} className="p-12 text-center text-sm text-muted-foreground">{t("coaches.noMatch")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePager page={pageSafe} totalPages={totalPages} onChange={setPage} />
      </Card>

      {/* Edit drawer */}
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("coaches.editCoach")}</SheetTitle>
            <SheetDescription>{editing?.email}</SheetDescription>
          </SheetHeader>
          {editing && (
            <div className="mt-4 space-y-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><Label>{t("coaches.fullName")}</Label><Input value={editing.full_name} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} /></div>
                <div>
                  <Label>{t("coaches.status")}</Label>
                  <Select value={editing.status} onValueChange={(v) => setEditing({ ...editing, status: v as Status })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_KEYS.map(s => <SelectItem key={s} value={s}>{t(`coaches.statusLabels.${s}`)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>{t("coaches.programme")} <span className="text-destructive">*</span></Label>
                  <Select
                    value={editing.programme_id || ""}
                    onValueChange={(v) => {
                      const prog = programmes.find((p) => p.id === v);
                      setEditing({
                        ...editing,
                        programme_id: v,
                        programme_name: prog?.name || null,
                        programme_duration_months: prog?.duration_months ?? null,
                      });
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder={t("coaches.selectProgrammePlaceholder")} /></SelectTrigger>
                    <SelectContent>
                      {programmes.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[10px] text-muted-foreground">{t("coaches.programmeHint")}</p>
                </div>
                <div>
                  <Label>{t("coaches.cohort")}</Label>
                  <Select value={editing.cohort_id || "none"} onValueChange={(v) => setEditing({ ...editing, cohort_id: v === "none" ? null : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("coaches.noneOption")}</SelectItem>
                      {cohorts.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("coaches.sessionLimits")}</p>
                  <Button asChild variant="link" size="sm" className="h-auto p-0 text-[11px]">
                    <Link to="/admin/coach-programmes">{t("coaches.changeCoachProgramme")} →</Link>
                  </Button>
                </div>
                <p className="mb-2 text-[12px] font-medium">{editing.coach_programme_name || <span className="italic text-muted-foreground">{t("coaches.notEnrolled")}</span>}</p>
                <div className="grid grid-cols-1 gap-3 text-[11px] sm:grid-cols-3">
                  <div>
                    <p className="text-muted-foreground">{t("coaches.coachingReceived")}</p>
                    <p className="font-mono">{editing.coach_used}/{fmtLimit(editing.coach_session_limit)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("coaches.peerReceived")}</p>
                    <p className="font-mono">{editing.peer_used}/{fmtLimit(editing.peer_session_limit)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("coaches.peerGiven")}</p>
                    <p className="font-mono">{editing.peer_given_used}/{fmtLimit(editing.peer_given_limit)}</p>
                  </div>
                </div>
              </div>

              {(() => {
                const pct = programmeCompletionPct(editing.enrollment_start_date, editing.programme_duration_months);
                if (pct === null) return null;
                return (
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      <span>{t("coaches.programmeProgress")}</span>
                      <span className="font-mono text-foreground">{pct}%</span>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })()}

              <div className="rounded-lg border p-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("coaches.assignedCoachesLabel")}</p>
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

              <div className="rounded-lg bg-muted/40 p-3 text-[11px] text-muted-foreground">
                <p>{t("coaches.sessionsDeliveredPrefix")} <strong>{editing.completed_sessions}</strong> {t("coaches.completedLabel")} · <strong>{editing.booked_sessions}</strong> {t("coaches.bookedLabel")}</p>
                <p>{t("coaches.coacheesServedPrefix")} <strong>{editing.coachees_count}</strong></p>
                <p>{t("coaches.avgRatingPrefix")} <strong>{editing.rating_avg.toFixed(2)}</strong></p>
              </div>
            </div>
          )}
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setEditing(null)}>{t("coaches.cancel")}</Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t("coaches.save")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
