import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Loader2, Users, Calendar, Eye } from "lucide-react";
import { format } from "date-fns";
import { AdminPageHeader, Kpi, Pill, Avatar, MiniBar } from "./_shared";

interface Row {
  id: string;
  name: string;
  email: string;
  status: string;
  created_at: string;
  done: number;
  booked: number;
  programme: string | null;
  cohort: string | null;
  progress: number;
  coaches: { id: string; name: string }[];
}

export default function AdminCoachees() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [
        { data: roles },
        { data: profiles },
        { data: sess },
        { data: enr },
        { data: progs },
        { data: cohs },
        { data: allow },
      ] = await Promise.all([
        supabase.from("user_roles").select("user_id, role").eq("role", "coachee"),
        supabase.from("profiles").select("id, full_name, email, status, created_at"),
        supabase.from("sessions").select("coach_id, coachee_id, status"),
        supabase.from("programme_enrollments").select("coachee_id, programme_id, cohort_id, progress_pct, status"),
        supabase.from("programmes").select("id, name"),
        supabase.from("cohorts").select("id, name"),
        supabase.from("coachee_coach_allowlist").select("coachee_id, coach_id"),
      ]);
      const profById = new Map((profiles || []).map((p: any) => [p.id, p]));
      const progById = new Map((progs || []).map((p: any) => [p.id, p.name]));
      const cohById = new Map((cohs || []).map((c: any) => [c.id, c.name]));
      const enrByCoachee = new Map((enr || []).map((e: any) => [e.coachee_id, e]));
      const done = new Map<string, number>();
      const booked = new Map<string, number>();
      (sess || []).forEach((s: any) => {
        if (s.status === "completed") done.set(s.coachee_id, (done.get(s.coachee_id) || 0) + 1);
        if (["confirmed", "pending_coach_approval"].includes(s.status))
          booked.set(s.coachee_id, (booked.get(s.coachee_id) || 0) + 1);
      });
      const allowByCoachee = new Map<string, { id: string; name: string }[]>();
      (allow || []).forEach((a: any) => {
        const arr = allowByCoachee.get(a.coachee_id) || [];
        const p: any = profById.get(a.coach_id);
        arr.push({ id: a.coach_id, name: p?.full_name || "—" });
        allowByCoachee.set(a.coachee_id, arr);
      });

      const list: Row[] = (roles || []).map((r: any) => {
        const p: any = profById.get(r.user_id) || {};
        const e: any = enrByCoachee.get(r.user_id);
        return {
          id: r.user_id,
          name: p.full_name || "—",
          email: p.email || "—",
          status: p.status || "pending_approval",
          created_at: p.created_at,
          done: done.get(r.user_id) || 0,
          booked: booked.get(r.user_id) || 0,
          programme: e ? progById.get(e.programme_id) || null : null,
          cohort: e?.cohort_id ? cohById.get(e.cohort_id) || null : null,
          progress: e?.progress_pct || 0,
          coaches: allowByCoachee.get(r.user_id) || [],
        };
      });
      setRows(list.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)));
      setLoading(false);
    })();
  }, []);

  const filtered = rows.filter(
    (r) => !q.trim() || r.name.toLowerCase().includes(q.toLowerCase()) || r.email.toLowerCase().includes(q.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const active = rows.filter((r) => r.status === "active").length;
  const pending = rows.filter((r) => r.status === "pending_approval").length;
  const reachLimit = rows.filter((r) => r.status === "reach_limit").length;

  return (
    <div>
      <AdminPageHeader title="Coachees" subtitle={`${rows.length} total · click any row to manage`} />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Kpi label="Total" value={rows.length} icon={Users} tone="primary" />
        <Kpi label="Active" value={active} icon={Users} tone="success" />
        <Kpi label="Pending approval" value={pending} icon={Users} tone="warning" />
        <Kpi label="Reached limit" value={reachLimit} icon={Users} tone="destructive" />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" className="pl-9" />
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/registrations">Manage in registrations</Link>
        </Button>
      </div>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <p className="p-12 text-center text-sm text-muted-foreground">No coachees match your filters.</p>
        ) : (
          <div className="divide-y">
            {filtered.map((r) => (
              <div key={r.id} className="grid grid-cols-12 items-center gap-3 px-4 py-3 hover:bg-muted/30">
                <div className="col-span-3 flex items-center gap-2 min-w-0">
                  <Avatar name={r.name} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{r.email}</p>
                  </div>
                </div>
                <div className="col-span-2">
                  <Pill tone={r.status === "active" ? "success" : r.status === "pending_approval" ? "warning" : r.status === "reach_limit" ? "warning" : "muted"}>
                    {r.status.replace(/_/g, " ")}
                  </Pill>
                </div>
                <div className="col-span-2 text-[11px] text-muted-foreground">
                  {r.programme ? <span className="font-medium text-foreground">{r.programme}</span> : <span className="italic">No programme</span>}
                  {r.cohort && <p className="mt-0.5">Cohort: {r.cohort}</p>}
                </div>
                <div className="col-span-2">
                  <MiniBar pct={r.progress} tone={r.progress >= 75 ? "success" : r.progress >= 40 ? "primary" : "warning"} />
                </div>
                <div className="col-span-2 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />{r.done} done · {r.booked} booked</span>
                  <p className="mt-0.5">{r.coaches.length} coach{r.coaches.length === 1 ? "" : "es"}</p>
                </div>
                <div className="col-span-1 text-right">
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/admin/registrations"><Eye className="h-4 w-4" /></Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
