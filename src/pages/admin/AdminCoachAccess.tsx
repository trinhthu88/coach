import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Search, Lock, UserCog } from "lucide-react";
import { AdminPageHeader, Pill, Avatar } from "./_shared";
import { toast } from "sonner";

interface Coachee {
  id: string;
  name: string;
  email: string;
  status: string;
  allow: string[];
}
interface CoachOpt { id: string; name: string; }

export default function AdminCoachAccess() {
  const [coachees, setCoachees] = useState<Coachee[]>([]);
  const [coaches, setCoaches] = useState<CoachOpt[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Coachee | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: roles }, { data: profs }, { data: allow }] = await Promise.all([
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("profiles").select("id, full_name, email, status"),
      supabase.from("coachee_coach_allowlist").select("coachee_id, coach_id"),
    ]);
    const profById = new Map((profs || []).map((p: any) => [p.id, p]));
    const coacheeIds = (roles || []).filter((r) => r.role === "coachee").map((r) => r.user_id);
    const coachIds = (roles || []).filter((r) => r.role === "coach").map((r) => r.user_id);
    const allowMap = new Map<string, string[]>();
    (allow || []).forEach((a: any) => {
      const arr = allowMap.get(a.coachee_id) || [];
      arr.push(a.coach_id);
      allowMap.set(a.coachee_id, arr);
    });
    setCoachees(
      coacheeIds
        .map((id) => {
          const p: any = profById.get(id);
          if (!p) return null;
          return { id, name: p.full_name, email: p.email, status: p.status, allow: allowMap.get(id) || [] };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => a.name.localeCompare(b.name)) as Coachee[]
    );
    setCoaches(
      coachIds
        .map((id) => ({ id, name: profById.get(id)?.full_name || "—" }))
        .filter((c) => c.name !== "—")
        .sort((a, b) => a.name.localeCompare(b.name))
    );
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const open = (c: Coachee) => { setEditing(c); setDraft([...c.allow]); };

  const saveAccess = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      // Replace all
      await supabase.from("coachee_coach_allowlist").delete().eq("coachee_id", editing.id);
      if (draft.length) {
        const rows = draft.map((coach_id) => ({ coachee_id: editing.id, coach_id }));
        const { error } = await supabase.from("coachee_coach_allowlist").insert(rows);
        if (error) throw error;
      }
      toast.success("Access updated");
      setEditing(null);
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const filtered = coachees.filter((c) => !q.trim() || c.name.toLowerCase().includes(q.toLowerCase()) || c.email.toLowerCase().includes(q.toLowerCase()));

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div>
      <AdminPageHeader title="Coach" emphasize="access" subtitle="Choose which coaches each coachee can see and book." />

      <div className="mb-3 relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search coachees" className="pl-9" />
      </div>

      <Card className="overflow-hidden">
        <div className="divide-y">
          {filtered.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/30">
              <Avatar name={c.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{c.email}</p>
              </div>
              <Pill tone={c.allow.length === 0 ? "warning" : "primary"}>
                {c.allow.length} coach{c.allow.length === 1 ? "" : "es"} assigned
              </Pill>
              <Button variant="outline" size="sm" onClick={() => open(c)}>
                <UserCog className="h-4 w-4" /> Manage
              </Button>
            </div>
          ))}
          {filtered.length === 0 && <p className="p-12 text-center text-sm text-muted-foreground">No coachees.</p>}
        </div>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Coaches available to {editing?.name}</DialogTitle></DialogHeader>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {coaches.map((c) => (
              <label key={c.id} className="flex items-center gap-3 rounded-md p-2 hover:bg-muted/50">
                <Checkbox
                  checked={draft.includes(c.id)}
                  onCheckedChange={(v) => setDraft((d) => (v ? [...d, c.id] : d.filter((x) => x !== c.id)))}
                />
                <span className="text-sm">{c.name}</span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveAccess} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
