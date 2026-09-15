import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { AdminPageHeader } from "./_shared";
import { ModuleConfigRow, defaultModuleRows, type ModuleRows } from "./AdminProgrammes";
import type { TrainingWeekOption } from "./ProgrammeModuleScheduleFields";
import type { ProgrammeModuleType } from "@/hooks/useProgrammeModules";
import { normalizeModuleScheduleConfig, validateModuleScheduleConfig } from "@/lib/programmeModuleConfig";
import type { Json } from "@/integrations/supabase/types";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { useConfirm } from "@/hooks/use-confirm";
import { toast } from "sonner";

type ProgrammeForm = {
  id?: string; name: string; description: string; duration_months: number; color: string;
  is_active: boolean; coachee_session_limit: number; coach_session_limit: number;
  peer_session_limit: number; peer_given_limit: number; mentoring_received_limit: number | null;
};
const MODULE_TYPES: ProgrammeModuleType[] = ["coaching", "peer_coaching", "mentoring", "triads", "training", "quiz", "assessment", "daily_prompt"];
const emptyForm: ProgrammeForm = {
  name: "", description: "", duration_months: 3, color: "cobalt", is_active: true,
  coachee_session_limit: 8, coach_session_limit: 8, peer_session_limit: 4, peer_given_limit: 4, mentoring_received_limit: null,
};

export default function ProgrammeBuilder() {
  const { programmeId } = useParams();
  const isEdit = Boolean(programmeId);
  const navigate = useNavigate();
  const { t } = useTranslation("admin");
  const { confirm, ConfirmDialog } = useConfirm();
  const [form, setForm] = useState<ProgrammeForm>(emptyForm);
  const [modules, setModules] = useState<ModuleRows>(defaultModuleRows());
  const [weeks, setWeeks] = useState<TrainingWeekOption[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!programmeId) return;
    (async () => {
      const [{ data: p }, { data: ms }, { data: ws }] = await Promise.all([
        supabase.from("programmes").select("*").eq("id", programmeId).single(),
        supabase.from("programme_modules").select("module, enabled, config").eq("programme_id", programmeId),
        supabase.from("training_weeks").select("id, week_number, title").eq("programme_id", programmeId).order("week_number"),
      ]);
      if (p) setForm({
        ...emptyForm,
        ...p,
        color: p.color || emptyForm.color,
        description: p.description || "",
        mentoring_received_limit: p.mentoring_received_limit ?? null,
      });
      const next = defaultModuleRows();
      (ms || []).forEach((m) => { next[m.module as ProgrammeModuleType] = { enabled: m.enabled, config: { ...next[m.module as ProgrammeModuleType].config, ...(m.config as Record<string, unknown>) } }; });
      setModules(next);
      setWeeks((ws || []).map((w) => ({ id: w.id, weekNumber: w.week_number, title: w.title })));
      setLoading(false);
    })();
  }, [programmeId]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const update = (patch: Partial<ProgrammeForm>) => { setForm((v) => ({ ...v, ...patch })); setDirty(true); };
  const updateModule = (module: ProgrammeModuleType, patch: Partial<ModuleRows[ProgrammeModuleType]>) => {
    setModules((v) => ({ ...v, [module]: { ...v[module], ...patch } })); setDirty(true);
  };
  const updateConfig = (module: ProgrammeModuleType, patch: Record<string, unknown>) => {
    setModules((v) => ({ ...v, [module]: { ...v[module], config: { ...v[module].config, ...patch } } })); setDirty(true);
  };

  const validation = useMemo(() => {
    const errors: string[] = [];
    if (!form.name.trim()) errors.push(t("programmes.nameRequired"));
    MODULE_TYPES.forEach((module) => {
      const row = modules[module]; if (!row.enabled) return;
      const key = validateModuleScheduleConfig(row.config, weeks.map((w) => w.id));
      if (key) errors.push(`${t(`programmes.modules.types.${module}`)}: ${t(key)}`);
      const target = row.config.required_units;
      const limits = module === "triads"
        ? [row.config.max_triads]
        : [row.config.give_limit, row.config.receive_limit];
      const applicableLimits = limits.filter((limit): limit is number => typeof limit === "number");
      if (row.config.required === true && typeof target === "number" && applicableLimits.some((max) => target > max)) {
        errors.push(t("programmes.builder.targetExceedsMaximum", {
          module: t(`programmes.modules.types.${module}`),
          target,
          max: Math.min(...applicableLimits),
        }));
      }
    });
    return errors;
  }, [form, modules, weeks, t]);

  const cancel = async () => {
    if (dirty && !(await confirm({ title: t("programmes.builder.unsavedTitle"), description: t("programmes.builder.unsavedDescription"), confirmLabel: t("programmes.builder.leave"), destructive: true }))) return;
    navigate("/admin/programmes");
  };
  const save = async () => {
    if (validation.length) { toast.error(t("programmes.builder.fixErrors")); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(), description: form.description || null, duration_months: Number(form.duration_months) || 3,
        color: form.color || "cobalt", is_active: !!form.is_active, coachee_session_limit: Number(form.coachee_session_limit) || 0,
        coach_session_limit: Number(form.coach_session_limit) || 0, peer_session_limit: Number(form.peer_session_limit) || 0,
        peer_given_limit: Number(form.peer_given_limit) || 0, mentoring_received_limit: form.mentoring_received_limit ?? null,
      };
      let id = programmeId;
      if (id) { const { error } = await supabase.from("programmes").update(payload).eq("id", id); if (error) throw error; }
      else { const { data, error } = await supabase.from("programmes").insert(payload).select("id").single(); if (error) throw error; id = data.id; }
      const { error } = await supabase.from("programme_modules").upsert(MODULE_TYPES.map((module) => ({
        programme_id: id, module, enabled: modules[module].enabled, config: normalizeModuleScheduleConfig(modules[module].config) as Json,
      })), { onConflict: "programme_id,module" });
      if (error) throw error;
      setDirty(false); toast.success(t("programmes.saved")); navigate("/admin/programmes");
    } catch (error) { toast.error(getFriendlyErrorMessage(error, t)); } finally { setSaving(false); }
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  const field = (key: keyof ProgrammeForm, value: string | number | null) => update({ [key]: value } as Partial<ProgrammeForm>);
  return (
    <div className="mx-auto max-w-6xl pb-10">
      <AdminPageHeader eyebrow={t("programmes.eyebrow")} title={isEdit ? t("programmes.builder.editTitle") : t("programmes.builder.newTitle")} subtitle={t("programmes.builder.subtitle")} right={<Button variant="ghost" onClick={cancel}><ArrowLeft className="h-4 w-4" /> {t("programmes.builder.back")}</Button>} />
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <main className="space-y-4">
          <Card className="space-y-3 p-5">
            <div><Label>{t("programmes.nameLabel")}</Label><Input value={form.name} onChange={(e) => field("name", e.target.value)} /></div>
            <div><Label>{t("programmes.descriptionLabel")}</Label><Textarea rows={3} value={form.description} onChange={(e) => field("description", e.target.value)} /></div>
            <div className="max-w-xs"><Label>{t("programmes.durationMonthsLabel")}</Label><Input type="number" min={1} value={form.duration_months} onChange={(e) => field("duration_months", Number(e.target.value))} /></div>
          </Card>
          <Card className="p-5">
            <h2 className="mb-1 text-sm font-semibold">{t("programmes.sessionLimitsHeading")}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["coachee_session_limit", "coach_session_limit", "peer_session_limit", "peer_given_limit"] as const).map((key) => <div key={key}><Label>{t(`programmes.${key === "coachee_session_limit" ? "coachingReceivedCoachee" : key === "coach_session_limit" ? "coachingReceivedCoach" : key === "peer_session_limit" ? "peerSessionsReceived" : "peerSessionsGiven"}`)}</Label><Input type="number" min={0} value={form[key]} onChange={(e) => field(key, Number(e.target.value))} /></div>)}
              <div><Label>{t("programmes.mentoringSessionsReceived")}</Label><Input type="number" min={0} placeholder={t("coachProgrammes.unlimited")} value={form.mentoring_received_limit ?? ""} onChange={(e) => field("mentoring_received_limit", e.target.value === "" ? null : Number(e.target.value))} /></div>
            </div>
          </Card>
          <Card className="p-5"><h2 className="text-sm font-semibold">{t("programmes.modules.heading")}</h2><p className="mb-3 text-xs text-muted-foreground">{t("programmes.modules.hint")}</p><div className="grid gap-3 sm:grid-cols-2">{MODULE_TYPES.map((module) => <ModuleConfigRow key={module} module={module} row={modules[module]} onToggle={(enabled) => updateModule(module, { enabled })} onConfigChange={(patch) => updateConfig(module, patch)} t={t} trainingWeeks={weeks} />)}</div></Card>
          <div className="flex items-center justify-between rounded-lg border p-4"><div><p className="text-sm font-medium">{t("programmes.activeLabel")}</p><p className="text-xs text-muted-foreground">{t("programmes.activeHint")}</p></div><Switch checked={form.is_active} onCheckedChange={(v) => update({ is_active: v })} /></div>
        </main>
        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card className="p-4"><h2 className="mb-3 text-sm font-semibold">{t("programmes.builder.summary")}</h2><p className="text-lg font-semibold">{form.name || t("programmes.builder.untitled")}</p><p className="text-xs text-muted-foreground">{t("programmes.monthsValue", { count: form.duration_months })}</p><div className="mt-3 space-y-1 text-xs">{MODULE_TYPES.filter((m) => modules[m].enabled).map((m) => <p key={m}>✓ {t(`programmes.modules.types.${m}`)}</p>)}{!MODULE_TYPES.some((m) => modules[m].enabled) && <p className="text-muted-foreground">{t("programmes.builder.noModules")}</p>}</div></Card>
          <Card className="p-4"><h2 className="mb-2 text-sm font-semibold">{t("programmes.builder.validation")}</h2>{validation.length ? <ul className="space-y-2 text-xs text-destructive">{validation.map((error, i) => <li key={i} className="flex gap-2"><AlertCircle className="h-4 w-4 shrink-0" />{error}</li>)}</ul> : <p className="flex gap-2 text-xs text-primary"><CheckCircle2 className="h-4 w-4" />{t("programmes.builder.valid")}</p>}</Card>
          <div className="flex gap-2"><Button variant="outline" onClick={cancel}>{t("programmes.cancel")}</Button><Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}{t("programmes.save")}</Button></div>
        </aside>
      </div>
      {ConfirmDialog}
    </div>
  );
}