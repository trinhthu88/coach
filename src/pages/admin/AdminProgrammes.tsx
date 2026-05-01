import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { AdminPageHeader, Pill } from "./_shared";
import { toast } from "sonner";

interface Programme {
  id: string;
  name: string;
  description: string | null;
  duration_months: number;
  color: string;
  is_active: boolean;
  coachee_session_limit: number;
  coach_session_limit: number;
  peer_session_limit: number;
  peer_given_limit: number;
}

const empty: Partial<Programme> = {
  name: "",
  description: "",
  duration_months: 3,
  color: "cobalt",
  is_active: true,
  coachee_session_limit: 8,
  coach_session_limit: 8,
  peer_session_limit: 4,
  peer_given_limit: 4,
};

export default function AdminProgrammes() {
  const [rows, setRows] = useState<Programme[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Programme> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("programmes").select("*").order("created_at");
    setRows((data || []) as unknown as Programme[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!editing?.name?.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const payload = {
        name: editing.name!,
        description: editing.description || null,
        duration_months: Number(editing.duration_months) || 3,
        color: editing.color || "cobalt",
        is_active: !!editing.is_active,
        coachee_session_limit: Number(editing.coachee_session_limit) || 0,
        coach_session_limit: Number(editing.coach_session_limit) || 0,
        peer_session_limit: Number(editing.peer_session_limit) || 0,
        peer_given_limit: Number(editing.peer_given_limit) || 0,
      };
      if (editing.id) {
        const { error } = await supabase.from("programmes").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("programmes").insert(payload);
        if (error) throw error;
      }
      toast.success("Programme saved");
      setEditing(null);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this programme? Coachees enrolled will not be removed.")) return;
    const { error } = await supabase.from("programmes").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Programme deleted"); load(); }
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div>
      <AdminPageHeader
        title="Programmes"
        subtitle="Preset coaching programmes that can be assigned to coachees and coaches."
        right={<Button onClick={() => setEditing(empty)}><Plus className="h-4 w-4" /> New programme</Button>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="mb-2 flex items-start justify-between">
              <h3 className="text-base font-semibold">{p.name}</h3>
              <Pill tone={p.is_active ? "success" : "muted"}>{p.is_active ? "Active" : "Disabled"}</Pill>
            </div>
            {p.description && <p className="text-[12px] text-muted-foreground">{p.description}</p>}
            <div className="mt-3 rounded-md bg-muted/50 px-2 py-1.5 text-[11px]">
              <p className="text-muted-foreground">Duration</p>
              <p className="text-sm font-semibold">{p.duration_months} months</p>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-md bg-primary/5 px-2 py-1.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Coaching received (coachee)</p>
                <p className="text-sm font-semibold">{p.coachee_session_limit}</p>
              </div>
              <div className="rounded-md bg-primary/5 px-2 py-1.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Coaching received (coach)</p>
                <p className="text-sm font-semibold">{p.coach_session_limit}</p>
              </div>
              <div className="rounded-md bg-accent/10 px-2 py-1.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Peer received</p>
                <p className="text-sm font-semibold">{p.peer_session_limit}</p>
              </div>
              <div className="rounded-md bg-accent/10 px-2 py-1.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Peer given</p>
                <p className="text-sm font-semibold">{p.peer_given_limit}</p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(p)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
              <Button variant="ghost" size="sm" onClick={() => remove(p.id)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
            </div>
          </Card>
        ))}
        {rows.length === 0 && (
          <Card className="col-span-full p-12 text-center text-sm text-muted-foreground">
            No programmes yet. Create one to start enrolling coachees.
          </Card>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit" : "New"} programme</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div><Label>Description</Label><Textarea rows={3} value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
              <div>
                <Label>Duration (months)</Label>
                <Input type="number" min={1} value={editing.duration_months ?? 3} onChange={(e) => setEditing({ ...editing, duration_months: Number(e.target.value) })} />
              </div>
              <div className="rounded-lg border p-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Session limits (default applied at enrollment)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-[11px]">Coaching received — coachee</Label>
                    <Input type="number" min={0} value={editing.coachee_session_limit ?? 8} onChange={(e) => setEditing({ ...editing, coachee_session_limit: Number(e.target.value) })} />
                  </div>
                  <div>
                    <Label className="text-[11px]">Coaching received — coach</Label>
                    <Input type="number" min={0} value={editing.coach_session_limit ?? 8} onChange={(e) => setEditing({ ...editing, coach_session_limit: Number(e.target.value) })} />
                  </div>
                  <div>
                    <Label className="text-[11px]">Peer sessions — received</Label>
                    <Input type="number" min={0} value={editing.peer_session_limit ?? 4} onChange={(e) => setEditing({ ...editing, peer_session_limit: Number(e.target.value) })} />
                    <p className="mt-1 text-[10px] text-muted-foreground">Coaches only</p>
                  </div>
                  <div>
                    <Label className="text-[11px]">Peer sessions — given</Label>
                    <Input type="number" min={0} value={editing.peer_given_limit ?? 4} onChange={(e) => setEditing({ ...editing, peer_given_limit: Number(e.target.value) })} />
                    <p className="mt-1 text-[10px] text-muted-foreground">Coaches only</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div><p className="text-sm font-medium">Active</p><p className="text-[11px] text-muted-foreground">Visible for new enrollments.</p></div>
                <Switch checked={!!editing.is_active} onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
