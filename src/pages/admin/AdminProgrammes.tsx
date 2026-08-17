import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, ArrowUpRight } from "lucide-react";
import { format } from "date-fns";
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

interface Cohort {
  id: string;
  name: string;
  programme_id: string | null;
  start_date: string | null;
  end_date: string | null;
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
  const { t } = useTranslation("admin");
  const [rows, setRows] = useState<Programme[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [cohortCounts, setCohortCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Programme> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data }, { data: cohortsData }, { data: enr }] = await Promise.all([
      supabase.from("programmes").select("*").order("created_at"),
      supabase.from("cohorts").select("id, name, programme_id, start_date, end_date").order("start_date", { ascending: false }),
      supabase.from("programme_enrollments").select("cohort_id"),
    ]);
    const cnt: Record<string, number> = {};
    (enr || []).forEach((e: { cohort_id: string | null }) => {
      if (e.cohort_id) cnt[e.cohort_id] = (cnt[e.cohort_id] || 0) + 1;
    });
    setRows((data || []) as unknown as Programme[]);
    setCohorts((cohortsData || []) as Cohort[]);
    setCohortCounts(cnt);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!editing?.name?.trim()) { toast.error(t("programmes.nameRequired")); return; }
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
      toast.success(t("programmes.saved"));
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm(t("programmes.deleteConfirm"))) return;
    const { error } = await supabase.from("programmes").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(t("programmes.deleted")); load(); }
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const progById = new Map(rows.map((p) => [p.id, p]));

  return (
    <div>
      <AdminPageHeader
        eyebrow={t("programmes.eyebrow")}
        title={t("programmes.title")}
        trailing=""
        subtitle={t("programmes.subtitle")}
        right={<Button onClick={() => setEditing(empty)}><Plus className="h-4 w-4" /> {t("programmes.newProgramme")}</Button>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="mb-1 flex items-start justify-between gap-2">
              <h3 className="text-base font-semibold">{p.name}</h3>
              <Pill tone={p.is_active ? "success" : "muted"}>{p.is_active ? t("programmes.active") : t("programmes.disabled")}</Pill>
            </div>
            <p className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">{t("programmes.hspGroup")}</p>
            {p.description && <p className="mt-2 text-[12px] text-muted-foreground">{p.description}</p>}
            <div className="mt-3 rounded-md bg-muted/50 px-2 py-1.5 text-[11px]">
              <p className="text-muted-foreground">{t("programmes.duration")}</p>
              <p className="text-sm font-semibold">{t("programmes.monthsValue", { count: p.duration_months })}</p>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-md bg-primary/5 px-2 py-1.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{t("programmes.coachingReceivedCoachee")}</p>
                <p className="text-sm font-semibold">{p.coachee_session_limit}</p>
              </div>
              <div className="rounded-md bg-primary/5 px-2 py-1.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{t("programmes.coachingReceivedCoach")}</p>
                <p className="text-sm font-semibold">{p.coach_session_limit}</p>
              </div>
              <div className="rounded-md bg-accent/10 px-2 py-1.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{t("programmes.peerReceived")}</p>
                <p className="text-sm font-semibold">{p.peer_session_limit}</p>
              </div>
              <div className="rounded-md bg-accent/10 px-2 py-1.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{t("programmes.peerGiven")}</p>
                <p className="text-sm font-semibold">{p.peer_given_limit}</p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(p)}><Pencil className="h-3.5 w-3.5" /> {t("programmes.edit")}</Button>
              <Button variant="ghost" size="sm" onClick={() => remove(p.id)}><Trash2 className="h-3.5 w-3.5" /> {t("programmes.delete")}</Button>
            </div>
          </Card>
        ))}
        {rows.length === 0 && (
          <Card className="col-span-full p-12 text-center text-sm text-muted-foreground">
            {t("programmes.empty")}
          </Card>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{t("programmes.cohorts")}</p>
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/cohorts">{t("programmes.manageCohorts")} <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Link>
        </Button>
      </div>
      <Card className="mt-2 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold">{t("programmes.tableHeaders.cohort")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("programmes.tableHeaders.programme")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("programmes.tableHeaders.starts")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("programmes.tableHeaders.seats")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("programmes.tableHeaders.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {cohorts.map((c) => {
                const prog = c.programme_id ? progById.get(c.programme_id) : null;
                const seats = cohortCounts[c.id] || 0;
                const isFuture = c.start_date ? new Date(c.start_date) > new Date() : false;
                const isPast = c.end_date ? new Date(c.end_date) < new Date() : false;
                const status = isPast ? t("programmes.statusCompleted") : isFuture ? t("programmes.statusUpcoming") : t("programmes.statusActive");
                return (
                  <tr key={c.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5 font-medium">{c.name}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{prog?.name || "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{c.start_date ? format(new Date(c.start_date), "MMM d, yyyy") : "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{seats}</td>
                    <td className="px-3 py-2.5">
                      <Pill tone={status === t("programmes.statusActive") ? "success" : status === t("programmes.statusUpcoming") ? "warning" : "muted"}>{status}</Pill>
                    </td>
                  </tr>
                );
              })}
              {cohorts.length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center text-sm text-muted-foreground">{t("programmes.noCohortsYet")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? t("programmes.dialogTitleEdit") : t("programmes.dialogTitleNew")}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div><Label>{t("programmes.nameLabel")}</Label><Input value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div><Label>{t("programmes.descriptionLabel")}</Label><Textarea rows={3} value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
              <div>
                <Label>{t("programmes.durationMonthsLabel")}</Label>
                <Input type="number" min={1} value={editing.duration_months ?? 3} onChange={(e) => setEditing({ ...editing, duration_months: Number(e.target.value) })} />
              </div>
              <div className="rounded-lg border p-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("programmes.sessionLimitsHeading")}</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-[11px]">{t("programmes.coachingReceivedCoachee")}</Label>
                    <Input type="number" min={0} value={editing.coachee_session_limit ?? 8} onChange={(e) => setEditing({ ...editing, coachee_session_limit: Number(e.target.value) })} />
                  </div>
                  <div>
                    <Label className="text-[11px]">{t("programmes.coachingReceivedCoach")}</Label>
                    <Input type="number" min={0} value={editing.coach_session_limit ?? 8} onChange={(e) => setEditing({ ...editing, coach_session_limit: Number(e.target.value) })} />
                  </div>
                  <div>
                    <Label className="text-[11px]">{t("programmes.peerSessionsReceived")}</Label>
                    <Input type="number" min={0} value={editing.peer_session_limit ?? 4} onChange={(e) => setEditing({ ...editing, peer_session_limit: Number(e.target.value) })} />
                    <p className="mt-1 text-[10px] text-muted-foreground">{t("programmes.coachesOnly")}</p>
                  </div>
                  <div>
                    <Label className="text-[11px]">{t("programmes.peerSessionsGiven")}</Label>
                    <Input type="number" min={0} value={editing.peer_given_limit ?? 4} onChange={(e) => setEditing({ ...editing, peer_given_limit: Number(e.target.value) })} />
                    <p className="mt-1 text-[10px] text-muted-foreground">{t("programmes.coachesOnly")}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div><p className="text-sm font-medium">{t("programmes.activeLabel")}</p><p className="text-[11px] text-muted-foreground">{t("programmes.activeHint")}</p></div>
                <Switch checked={!!editing.is_active} onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>{t("programmes.cancel")}</Button>
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t("programmes.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
