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
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, ArrowUpRight } from "lucide-react";
import { format } from "date-fns";
import { AdminPageHeader, Pill } from "./_shared";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import { getFriendlyErrorMessage } from "@/lib/errors";
import type { ProgrammeModuleType } from "@/hooks/useProgrammeModules";
import type { Json } from "@/integrations/supabase/types";

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
  // Unlike the four limits above (NOT NULL, numeric default), this one is
  // nullable — NULL = unlimited, matching coach_programmes' convention.
  mentoring_received_limit: number | null;
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
  mentoring_received_limit: null,
};

const MODULE_TYPES: ProgrammeModuleType[] = [
  "coaching",
  "peer_coaching",
  "mentoring",
  "triads",
  "training",
  "quiz",
  "assessment",
  "daily_prompt",
];

interface ModuleRow {
  enabled: boolean;
  config: Record<string, unknown>;
}

type ModuleRows = Record<ProgrammeModuleType, ModuleRow>;

// Default config shape per module type — see the programme_modules.config
// JSONB shapes documented alongside the 20260903100000 migration.
function defaultModuleRows(): ModuleRows {
  return {
    coaching: { enabled: false, config: { give: false, receive: false, give_limit: null, receive_limit: null } },
    peer_coaching: { enabled: false, config: { give: false, receive: false, monthly_limit: null } },
    mentoring: { enabled: false, config: { give: false, receive: false, give_limit: null, receive_limit: null } },
    triads: { enabled: false, config: { group_size: 3, sessions_per_week: 1 } },
    training: { enabled: false, config: { weeks: 4 } },
    quiz: { enabled: false, config: {} },
    assessment: { enabled: false, config: { include_direct_reports: false } },
    daily_prompt: { enabled: false, config: { delivery_time: "07:00" } },
  };
}

function LimitField({
  label,
  value,
  onChange,
  t,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  t: (key: string) => string;
}) {
  return (
    <div>
      <Label className="text-[10.5px] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        min={0}
        placeholder={t("programmes.modules.unlimited")}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    </div>
  );
}

function ModuleConfigRow({
  module,
  row,
  onToggle,
  onConfigChange,
  t,
}: {
  module: ProgrammeModuleType;
  row: ModuleRow;
  onToggle: (enabled: boolean) => void;
  onConfigChange: (patch: Record<string, unknown>) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const cfg = row.config;
  return (
    <div className="rounded-md border p-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] font-medium">{t(`programmes.modules.types.${module}`)}</p>
        <Switch checked={row.enabled} onCheckedChange={onToggle} />
      </div>
      {row.enabled && (
        <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {(module === "coaching" || module === "mentoring") && (
            <>
              <label className="flex items-center gap-1.5 text-[11px]">
                <Checkbox checked={!!cfg.give} onCheckedChange={(v) => onConfigChange({ give: !!v })} />
                {t("programmes.modules.give")}
              </label>
              <LimitField
                label={t("programmes.modules.giveLimit")}
                value={(cfg.give_limit as number | null) ?? null}
                onChange={(v) => onConfigChange({ give_limit: v })}
                t={t}
              />
              <label className="flex items-center gap-1.5 text-[11px]">
                <Checkbox checked={!!cfg.receive} onCheckedChange={(v) => onConfigChange({ receive: !!v })} />
                {t("programmes.modules.receive")}
              </label>
              <LimitField
                label={t("programmes.modules.receiveLimit")}
                value={(cfg.receive_limit as number | null) ?? null}
                onChange={(v) => onConfigChange({ receive_limit: v })}
                t={t}
              />
            </>
          )}
          {module === "peer_coaching" && (
            <>
              <label className="flex items-center gap-1.5 text-[11px]">
                <Checkbox checked={!!cfg.give} onCheckedChange={(v) => onConfigChange({ give: !!v })} />
                {t("programmes.modules.give")}
              </label>
              <label className="flex items-center gap-1.5 text-[11px]">
                <Checkbox checked={!!cfg.receive} onCheckedChange={(v) => onConfigChange({ receive: !!v })} />
                {t("programmes.modules.receive")}
              </label>
              <LimitField
                label={t("programmes.modules.monthlyLimit")}
                value={(cfg.monthly_limit as number | null) ?? null}
                onChange={(v) => onConfigChange({ monthly_limit: v })}
                t={t}
              />
            </>
          )}
          {module === "triads" && (
            <>
              <div>
                <Label className="text-[10.5px] text-muted-foreground">{t("programmes.modules.groupSize")}</Label>
                <Input
                  type="number" min={2}
                  value={(cfg.group_size as number) ?? 3}
                  onChange={(e) => onConfigChange({ group_size: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-[10.5px] text-muted-foreground">{t("programmes.modules.sessionsPerWeek")}</Label>
                <Input
                  type="number" min={1}
                  value={(cfg.sessions_per_week as number) ?? 1}
                  onChange={(e) => onConfigChange({ sessions_per_week: Number(e.target.value) })}
                />
              </div>
            </>
          )}
          {module === "training" && (
            <div>
              <Label className="text-[10.5px] text-muted-foreground">{t("programmes.modules.weeks")}</Label>
              <Input
                type="number" min={1}
                value={(cfg.weeks as number) ?? 4}
                onChange={(e) => onConfigChange({ weeks: Number(e.target.value) })}
              />
            </div>
          )}
          {module === "assessment" && (
            <label className="flex items-center gap-1.5 text-[11px]">
              <Checkbox
                checked={!!cfg.include_direct_reports}
                onCheckedChange={(v) => onConfigChange({ include_direct_reports: !!v })}
              />
              {t("programmes.modules.includeDirectReports")}
            </label>
          )}
          {module === "daily_prompt" && (
            <div>
              <Label className="text-[10.5px] text-muted-foreground">{t("programmes.modules.deliveryTime")}</Label>
              <Input
                type="time"
                value={(cfg.delivery_time as string) ?? "07:00"}
                onChange={(e) => onConfigChange({ delivery_time: e.target.value })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminProgrammes() {
  const { t } = useTranslation("admin");
  const [rows, setRows] = useState<Programme[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [cohortCounts, setCohortCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Programme> | null>(null);
  const [moduleRows, setModuleRows] = useState<ModuleRows>(defaultModuleRows());
  const [saving, setSaving] = useState(false);
  const { confirm, ConfirmDialog } = useConfirm();

  const openEditor = async (p: Partial<Programme> | null) => {
    setEditing(p);
    if (!p?.id) {
      setModuleRows(defaultModuleRows());
      return;
    }
    const { data } = await supabase
      .from("programme_modules")
      .select("module, enabled, config")
      .eq("programme_id", p.id);
    const rows = defaultModuleRows();
    (data || []).forEach((m) => {
      rows[m.module] = {
        enabled: m.enabled,
        config: { ...rows[m.module].config, ...(m.config as Record<string, unknown>) },
      };
    });
    setModuleRows(rows);
  };

  const updateModule = (mod: ProgrammeModuleType, patch: Partial<ModuleRow>) =>
    setModuleRows((prev) => ({ ...prev, [mod]: { ...prev[mod], ...patch } }));

  const updateModuleConfig = (mod: ProgrammeModuleType, patch: Record<string, unknown>) =>
    setModuleRows((prev) => ({ ...prev, [mod]: { ...prev[mod], config: { ...prev[mod].config, ...patch } } }));

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
        mentoring_received_limit: editing.mentoring_received_limit ?? null,
      };
      let programmeId = editing.id;
      if (programmeId) {
        const { error } = await supabase.from("programmes").update(payload).eq("id", programmeId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("programmes").insert(payload).select("id").single();
        if (error) throw error;
        programmeId = data.id;
      }

      const moduleUpserts = MODULE_TYPES.map((module) => ({
        programme_id: programmeId,
        module,
        enabled: moduleRows[module].enabled,
        config: moduleRows[module].config as Json,
      }));
      const { error: moduleError } = await supabase
        .from("programme_modules")
        .upsert(moduleUpserts, { onConflict: "programme_id,module" });
      if (moduleError) throw moduleError;

      toast.success(t("programmes.saved"));
      setEditing(null);
      load();
    } catch (e) {
      toast.error(getFriendlyErrorMessage(e, t));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    const ok = await confirm({
      title: t("programmes.delete"),
      description: t("programmes.deleteConfirm"),
      confirmLabel: t("programmes.delete"),
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("programmes").delete().eq("id", id);
    if (error) toast.error(getFriendlyErrorMessage(error, t));
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
        right={<Button onClick={() => openEditor(empty)}><Plus className="h-4 w-4" /> {t("programmes.newProgramme")}</Button>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="mb-1 flex items-start justify-between gap-2">
              <h3 className="min-w-0 truncate text-base font-semibold">{p.name}</h3>
              <Pill tone={p.is_active ? "success" : "muted"} className="shrink-0">{p.is_active ? t("programmes.active") : t("programmes.disabled")}</Pill>
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
              <div className="rounded-md bg-secondary/10 px-2 py-1.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{t("programmes.mentoringReceived")}</p>
                <p className="text-sm font-semibold">{p.mentoring_received_limit === null ? t("coachProgrammes.unlimited") : p.mentoring_received_limit}</p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => openEditor(p)}><Pencil className="h-3.5 w-3.5" /> {t("programmes.edit")}</Button>
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
                  <div>
                    <Label className="text-[11px]">{t("programmes.mentoringSessionsReceived")}</Label>
                    <Input
                      type="number" min={0} placeholder={t("coachProgrammes.unlimited")}
                      value={editing.mentoring_received_limit ?? ""}
                      onChange={(e) => setEditing({ ...editing, mentoring_received_limit: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </div>
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("programmes.modules.heading")}</p>
                <p className="mb-2.5 mt-0.5 text-[11px] text-muted-foreground">{t("programmes.modules.hint")}</p>
                <div className="space-y-2">
                  {MODULE_TYPES.map((mod) => (
                    <ModuleConfigRow
                      key={mod}
                      module={mod}
                      row={moduleRows[mod]}
                      onToggle={(enabled) => updateModule(mod, { enabled })}
                      onConfigChange={(patch) => updateModuleConfig(mod, patch)}
                      t={t}
                    />
                  ))}
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
      {ConfirmDialog}
    </div>
  );
}
