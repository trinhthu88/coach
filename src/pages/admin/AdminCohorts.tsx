import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, UsersRound } from "lucide-react";
import { format } from "date-fns";
import { AdminPageHeader, Pill } from "./_shared";
import { toast } from "sonner";

interface Cohort {
  id: string;
  name: string;
  description: string | null;
  programme_id: string | null;
  start_date: string | null;
  end_date: string | null;
}

export default function AdminCohorts() {
  const [rows, setRows] = useState<Cohort[]>([]);
  const [progs, setProgs] = useState<{ id: string; name: string }[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Cohort> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: c }, { data: p }, { data: enr }] = await Promise.all([
      supabase.from("cohorts").select("*").order("start_date", { ascending: false }),
      supabase.from("programmes").select("id, name").eq("is_active", true),
      supabase.from("programme_enrollments").select("cohort_id"),
    ]);
    const cnt: Record<string, number> = {};
    (enr || []).forEach((e: any) => {
      if (e.cohort_id) cnt[e.cohort_id] = (cnt[e.cohort_id] || 0) + 1;
    });
    setRows((c || []) as Cohort[]);
    setProgs((p || []) as any);
    setCounts(cnt);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!editing?.name?.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const payload: any = {
        name: editing.name,
        description: editing.description || null,
        programme_id: editing.programme_id || null,
        start_date: editing.start_date || null,
        end_date: editing.end_date || null,
      };
      if (editing.id) {
        const { error } = await supabase.from("cohorts").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("cohorts").insert(payload);
        if (error) throw error;
      }
      toast.success("Cohort saved");
      setEditing(null);
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete cohort? Enrolled coachees keep their programme.")) return;
    const { error } = await supabase.from("cohorts").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div>
      <AdminPageHeader
        title="Cohorts"
        emphasize="& groups"
        subtitle="Group coachees together — usually by programme intake."
        right={<Button onClick={() => setEditing({ name: "" })}><Plus className="h-4 w-4" /> New cohort</Button>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((c) => {
          const prog = progs.find((p) => p.id === c.programme_id);
          return (
            <Card key={c.id} className="p-4">
              <div className="mb-2 flex items-start justify-between">
                <h3 className="text-base font-semibold">{c.name}</h3>
                {prog && <Pill tone="primary">{prog.name}</Pill>}
              </div>
              {c.description && <p className="text-[12px] text-muted-foreground">{c.description}</p>}
              <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><UsersRound className="h-3 w-3" /> {counts[c.id] || 0} members</span>
                {c.start_date && <span>{format(new Date(c.start_date), "MMM yyyy")}{c.end_date ? ` → ${format(new Date(c.end_date), "MMM yyyy")}` : ""}</span>}
              </div>
              <div className="mt-3 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(c)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => remove(c.id)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
              </div>
            </Card>
          );
        })}
        {rows.length === 0 && (
          <Card className="col-span-full p-12 text-center text-sm text-muted-foreground">
            No cohorts yet. Group coachees by intake to manage them together.
          </Card>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Edit" : "New"} cohort</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div><Label>Description</Label><Textarea rows={2} value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
              <div>
                <Label>Programme</Label>
                <Select value={editing.programme_id || "none"} onValueChange={(v) => setEditing({ ...editing, programme_id: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {progs.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Start date</Label><Input type="date" value={editing.start_date || ""} onChange={(e) => setEditing({ ...editing, start_date: e.target.value })} /></div>
                <div><Label>End date</Label><Input type="date" value={editing.end_date || ""} onChange={(e) => setEditing({ ...editing, end_date: e.target.value })} /></div>
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
