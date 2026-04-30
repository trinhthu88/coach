import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Pencil } from "lucide-react";
import { AdminPageHeader, Pill, MiniBar, Avatar } from "./_shared";
import { toast } from "sonner";

interface Enrollment {
  id: string;
  coachee_id: string;
  programme_id: string;
  cohort_id: string | null;
  status: "active" | "completed" | "paused" | "at_risk";
  progress_pct: number;
  start_date: string;
  end_date: string | null;
}

export default function AdminAssignments() {
  const [rows, setRows] = useState<Enrollment[]>([]);
  const [coachees, setCoachees] = useState<{ id: string; name: string }[]>([]);
  const [progs, setProgs] = useState<{ id: string; name: string }[]>([]);
  const [cohs, setCohs] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Enrollment> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: e }, { data: r }, { data: profs }, { data: p }, { data: c }] = await Promise.all([
      supabase.from("programme_enrollments").select("*").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id, role").eq("role", "coachee"),
      supabase.from("profiles").select("id, full_name"),
      supabase.from("programmes").select("id, name").eq("is_active", true),
      supabase.from("cohorts").select("id, name"),
    ]);
    const profById = new Map((profs || []).map((p: any) => [p.id, p.full_name]));
    setRows((e || []) as Enrollment[]);
    setCoachees((r || []).map((x: any) => ({ id: x.user_id, name: profById.get(x.user_id) || "—" })).sort((a, b) => a.name.localeCompare(b.name)));
    setProgs((p || []) as any);
    setCohs((c || []) as any);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!editing?.coachee_id || !editing?.programme_id) { toast.error("Coachee & programme required"); return; }
    setSaving(true);
    try {
      const payload: any = {
        coachee_id: editing.coachee_id,
        programme_id: editing.programme_id,
        cohort_id: editing.cohort_id || null,
        status: editing.status || "active",
        progress_pct: Number(editing.progress_pct) || 0,
        start_date: editing.start_date || new Date().toISOString().slice(0, 10),
        end_date: editing.end_date || null,
      };
      if (editing.id) {
        const { error } = await supabase.from("programme_enrollments").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("programme_enrollments").insert(payload);
        if (error) throw error;
      }
      toast.success("Saved");
      setEditing(null);
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this enrollment?")) return;
    const { error } = await supabase.from("programme_enrollments").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Removed"); load(); }
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const coacheeName = (id: string) => coachees.find((c) => c.id === id)?.name || "—";
  const progName = (id: string) => progs.find((p) => p.id === id)?.name || "—";
  const cohName = (id: string | null) => (id ? cohs.find((c) => c.id === id)?.name || "—" : "—");

  return (
    <div>
      <AdminPageHeader
        title="Coach"
        emphasize="assignments"
        subtitle="Enroll coachees into programmes & cohorts and track their progress."
        right={<Button onClick={() => setEditing({ status: "active", progress_pct: 0 })}><Plus className="h-4 w-4" /> New enrollment</Button>}
      />

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-12 text-center text-sm text-muted-foreground">No enrollments yet.</p>
        ) : (
          <div className="divide-y">
            {rows.map((e) => (
              <div key={e.id} className="grid grid-cols-12 items-center gap-3 px-4 py-3 hover:bg-muted/30">
                <div className="col-span-3 flex items-center gap-2 min-w-0">
                  <Avatar name={coacheeName(e.coachee_id)} />
                  <p className="truncate text-sm font-medium">{coacheeName(e.coachee_id)}</p>
                </div>
                <div className="col-span-2 text-[12px]"><span className="font-medium">{progName(e.programme_id)}</span></div>
                <div className="col-span-2 text-[12px] text-muted-foreground">{cohName(e.cohort_id)}</div>
                <div className="col-span-2">
                  <Pill tone={e.status === "active" ? "success" : e.status === "at_risk" ? "destructive" : e.status === "paused" ? "warning" : "muted"}>
                    {e.status.replace("_", " ")}
                  </Pill>
                </div>
                <div className="col-span-2"><MiniBar pct={e.progress_pct} tone={e.progress_pct >= 75 ? "success" : "primary"} /></div>
                <div className="col-span-1 flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(e)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(e.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Edit" : "New"} enrollment</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <Label>Coachee</Label>
                <Select value={editing.coachee_id || ""} onValueChange={(v) => setEditing({ ...editing, coachee_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select coachee" /></SelectTrigger>
                  <SelectContent>{coachees.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Programme</Label>
                <Select value={editing.programme_id || ""} onValueChange={(v) => setEditing({ ...editing, programme_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select programme" /></SelectTrigger>
                  <SelectContent>{progs.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Cohort (optional)</Label>
                <Select value={editing.cohort_id || "none"} onValueChange={(v) => setEditing({ ...editing, cohort_id: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {cohs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Status</Label>
                  <Select value={editing.status || "active"} onValueChange={(v) => setEditing({ ...editing, status: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="paused">Paused</SelectItem>
                      <SelectItem value="at_risk">At risk</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Progress %</Label><Input type="number" min={0} max={100} value={editing.progress_pct ?? 0} onChange={(e) => setEditing({ ...editing, progress_pct: Number(e.target.value) })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Start</Label><Input type="date" value={editing.start_date || ""} onChange={(e) => setEditing({ ...editing, start_date: e.target.value })} /></div>
                <div><Label>End</Label><Input type="date" value={editing.end_date || ""} onChange={(e) => setEditing({ ...editing, end_date: e.target.value })} /></div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
