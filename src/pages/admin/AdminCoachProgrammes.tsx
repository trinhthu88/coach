import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { AdminPageHeader, Pill } from "./_shared";
import { toast } from "sonner";

interface CoachProgramme {
  id: string;
  name: string;
  description: string | null;
  color: string;
  is_active: boolean;
  client_coaching_limit: number | null;
  mentee_sessions_limit: number | null;
  peer_given_limit: number | null;
  peer_received_limit: number | null;
}

interface CoachRow {
  id: string;
  full_name: string;
  email: string;
  enrollment_id: string | null;
  coach_programme_id: string | null;
}

const empty: Partial<CoachProgramme> = {
  name: "",
  description: "",
  color: "cobalt",
  is_active: true,
  client_coaching_limit: null,
  mentee_sessions_limit: 4,
  peer_given_limit: null,
  peer_received_limit: 4,
};

function limitLabel(v: number | null, t: (key: string) => string) {
  return v === null ? t("coachProgrammes.unlimited") : String(v);
}

export default function AdminCoachProgrammes() {
  const { t } = useTranslation("admin");
  const [rows, setRows] = useState<CoachProgramme[]>([]);
  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<CoachProgramme> | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingCoachId, setSavingCoachId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: programmes }, { data: roles }, { data: profiles }, { data: enrollments }] =
      await Promise.all([
        supabase.from("coach_programmes").select("*").order("created_at"),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("profiles").select("id, full_name, email"),
        supabase.from("coach_programme_enrollments").select("id, coach_id, coach_programme_id"),
      ]);
    setRows((programmes || []) as unknown as CoachProgramme[]);

    const coachIds = (roles || []).filter((r) => r.role === "coach").map((r) => r.user_id);
    const profileById = new Map((profiles || []).map((p) => [p.id, p]));
    const enrollByCoach = new Map((enrollments || []).map((e) => [e.coach_id, e]));
    const coachRows: CoachRow[] = coachIds
      .map((id): CoachRow | null => {
        const p = profileById.get(id);
        if (!p) return null;
        const enr = enrollByCoach.get(id);
        return {
          id,
          full_name: p.full_name,
          email: p.email,
          enrollment_id: enr?.id ?? null,
          coach_programme_id: enr?.coach_programme_id ?? null,
        };
      })
      .filter((r): r is CoachRow => r !== null);
    setCoaches(coachRows.sort((a, b) => a.full_name.localeCompare(b.full_name)));
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!editing?.name?.trim()) {
      toast.error(t("coachProgrammes.nameRequired"));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: editing.name!,
        description: editing.description || null,
        color: editing.color || "cobalt",
        is_active: !!editing.is_active,
        client_coaching_limit: editing.client_coaching_limit ?? null,
        mentee_sessions_limit: editing.mentee_sessions_limit ?? null,
        peer_given_limit: editing.peer_given_limit ?? null,
        peer_received_limit: editing.peer_received_limit ?? null,
      };
      if (editing.id) {
        const { error } = await supabase.from("coach_programmes").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("coach_programmes").insert(payload);
        if (error) throw error;
      }
      toast.success(t("coachProgrammes.saved"));
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm(t("coachProgrammes.deleteConfirm"))) return;
    const { error } = await supabase.from("coach_programmes").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success(t("coachProgrammes.deleted"));
      load();
    }
  };

  const changeEnrollment = async (coach: CoachRow, coachProgrammeId: string) => {
    setSavingCoachId(coach.id);
    try {
      const { error } = await supabase
        .from("coach_programme_enrollments")
        .upsert(
          { coach_id: coach.id, coach_programme_id: coachProgrammeId, start_date: new Date().toISOString().slice(0, 10) },
          { onConflict: "coach_id" }
        );
      if (error) throw error;
      toast.success(t("coachProgrammes.coachProgrammeUpdated", { name: coach.full_name }));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingCoachId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const progById = new Map(rows.map((p) => [p.id, p]));

  return (
    <div>
      <AdminPageHeader
        eyebrow={t("coachProgrammes.eyebrow")}
        title={t("coachProgrammes.title")}
        trailing=""
        subtitle={t("coachProgrammes.subtitle")}
        right={<Button onClick={() => setEditing(empty)}><Plus className="h-4 w-4" /> {t("coachProgrammes.newCoachProgramme")}</Button>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="mb-1 flex items-start justify-between gap-2">
              <h3 className="text-base font-semibold">{p.name}</h3>
              <Pill tone={p.is_active ? "success" : "muted"}>{p.is_active ? t("coachProgrammes.active") : t("coachProgrammes.disabled")}</Pill>
            </div>
            {p.description && <p className="mt-2 text-[12px] text-muted-foreground">{p.description}</p>}
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-md bg-primary/5 px-2 py-1.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{t("coachProgrammes.clientCoachingGiven")}</p>
                <p className="text-sm font-semibold">{limitLabel(p.client_coaching_limit, t)}</p>
              </div>
              <div className="rounded-md bg-primary/5 px-2 py-1.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{t("coachProgrammes.menteeSessionsReceived")}</p>
                <p className="text-sm font-semibold">{limitLabel(p.mentee_sessions_limit, t)}</p>
              </div>
              <div className="rounded-md bg-accent/10 px-2 py-1.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{t("coachProgrammes.peerGiven")}</p>
                <p className="text-sm font-semibold">{limitLabel(p.peer_given_limit, t)}</p>
              </div>
              <div className="rounded-md bg-accent/10 px-2 py-1.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{t("coachProgrammes.peerReceived")}</p>
                <p className="text-sm font-semibold">{limitLabel(p.peer_received_limit, t)}</p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(p)}><Pencil className="h-3.5 w-3.5" /> {t("coachProgrammes.edit")}</Button>
              <Button variant="ghost" size="sm" onClick={() => remove(p.id)}><Trash2 className="h-3.5 w-3.5" /> {t("coachProgrammes.delete")}</Button>
            </div>
          </Card>
        ))}
        {rows.length === 0 && (
          <Card className="col-span-full p-12 text-center text-sm text-muted-foreground">
            {t("coachProgrammes.empty")}
          </Card>
        )}
      </div>

      <div className="mt-6 mb-2">
        <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{t("coachProgrammes.coachEnrollments")}</p>
      </div>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coachProgrammes.tableHeaders.coach")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coachProgrammes.tableHeaders.coachProgramme")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("coachProgrammes.tableHeaders.change")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {coaches.map((c) => {
                const prog = c.coach_programme_id ? progById.get(c.coach_programme_id) : null;
                return (
                  <tr key={c.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{c.full_name}</p>
                      <p className="text-[10px] text-muted-foreground">{c.email}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      {prog ? prog.name : <span className="italic text-muted-foreground">{t("coachProgrammes.notEnrolled")}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <Select
                        value={c.coach_programme_id || ""}
                        onValueChange={(v) => changeEnrollment(c, v)}
                        disabled={savingCoachId === c.id}
                      >
                        <SelectTrigger className="w-56">
                          <SelectValue placeholder={t("coachProgrammes.selectCoachProgrammePlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {rows.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                );
              })}
              {coaches.length === 0 && (
                <tr><td colSpan={3} className="p-8 text-center text-sm text-muted-foreground">{t("coachProgrammes.noCoachesYet")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? t("coachProgrammes.dialogTitleEdit") : t("coachProgrammes.dialogTitleNew")}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div><Label>{t("coachProgrammes.nameLabel")}</Label><Input value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div><Label>{t("coachProgrammes.descriptionLabel")}</Label><Textarea rows={3} value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
              <div className="rounded-lg border p-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("coachProgrammes.sessionLimitsHeading")}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-[11px]">{t("coachProgrammes.clientCoachingGivenLabel")}</Label>
                    <Input
                      type="number" min={0} placeholder={t("coachProgrammes.unlimited")}
                      value={editing.client_coaching_limit ?? ""}
                      onChange={(e) => setEditing({ ...editing, client_coaching_limit: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">{t("coachProgrammes.menteeSessionsReceivedLabel")}</Label>
                    <Input
                      type="number" min={0} placeholder={t("coachProgrammes.unlimited")}
                      value={editing.mentee_sessions_limit ?? ""}
                      onChange={(e) => setEditing({ ...editing, mentee_sessions_limit: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">{t("coachProgrammes.peerSessionsGivenLabel")}</Label>
                    <Input
                      type="number" min={0} placeholder={t("coachProgrammes.unlimited")}
                      value={editing.peer_given_limit ?? ""}
                      onChange={(e) => setEditing({ ...editing, peer_given_limit: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">{t("coachProgrammes.peerSessionsReceivedLabel")}</Label>
                    <Input
                      type="number" min={0} placeholder={t("coachProgrammes.unlimited")}
                      value={editing.peer_received_limit ?? ""}
                      onChange={(e) => setEditing({ ...editing, peer_received_limit: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div><p className="text-sm font-medium">{t("coachProgrammes.activeLabel")}</p><p className="text-[11px] text-muted-foreground">{t("coachProgrammes.activeHint")}</p></div>
                <Switch checked={!!editing.is_active} onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>{t("coachProgrammes.cancel")}</Button>
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t("coachProgrammes.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
