import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { AdminPageHeader, Pill } from "./_shared";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { AssignmentEditor } from "./training/AssignmentEditor";
import { DailyPromptManager } from "./training/DailyPromptManager";
import { ReflectionEditor } from "./training/ReflectionEditor";
import { WeekEditor } from "./training/WeekEditor";
import { AssignmentRow, DailyPromptRow, emptyWeek, TrainingWeekRow } from "./training/types";

export default function AdminTrainingContent() {
  const { t } = useTranslation("training");
  const { confirm, ConfirmDialog } = useConfirm();

  const [programmes, setProgrammes] = useState<{ id: string; name: string }[]>([]);
  const [programmeId, setProgrammeId] = useState<string>("");
  const [weeks, setWeeks] = useState<TrainingWeekRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<TrainingWeekRow> | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"en" | "vi" | null>(null);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [dailyPrompts, setDailyPrompts] = useState<DailyPromptRow[]>([]);
  const [dailyPromptsLoading, setDailyPromptsLoading] = useState(false);

  const loadProgrammes = async () => {
    const { data } = await supabase.from("programmes").select("id, name").order("name");
    setProgrammes(data || []);
    if (!programmeId && data && data.length > 0) setProgrammeId(data[0].id);
  };

  const loadWeeks = async (pid: string) => {
    setLoading(true);
    const { data } = await supabase
      .from("training_weeks")
      .select("*")
      .eq("programme_id", pid)
      .order("week_number");
    setWeeks((data || []) as TrainingWeekRow[]);
    setLoading(false);
  };

  useEffect(() => {
    loadProgrammes();
  }, []);

  useEffect(() => {
    if (programmeId) loadWeeks(programmeId);
  }, [programmeId]);

  const loadAssignments = async (weekId: string) => {
    setAssignmentsLoading(true);
    const { data } = await supabase
      .from("assignments")
      .select("id, training_week_id, assignment_type, title, title_vi, instructions, instructions_vi, is_visible, due_offset_days, sort_order")
      .eq("training_week_id", weekId)
      .eq("assignment_type", "quiz")
      .order("sort_order");
    setAssignments((data || []) as AssignmentRow[]);
    setAssignmentsLoading(false);
  };

  const loadDailyPrompts = async (weekId: string) => {
    setDailyPromptsLoading(true);
    const { data } = await supabase
      .from("daily_prompts")
      .select("id, training_week_id, day_offset, prompt_text, prompt_text_vi, is_visible, sort_order")
      .eq("training_week_id", weekId)
      .order("sort_order");
    setDailyPrompts((data || []) as DailyPromptRow[]);
    setDailyPromptsLoading(false);
  };

  const isNewWeek = useMemo(() => !!editing && !weeks.some((w) => w.id === editing.id), [editing, weeks]);

  const openNew = () => {
    const nextWeekNumber = (weeks[weeks.length - 1]?.week_number ?? 0) + 1;
    setEditing(emptyWeek(programmeId, nextWeekNumber));
    setAssignments([]);
    setDailyPrompts([]);
  };

  const openEdit = (w: TrainingWeekRow) => {
    setEditing(w);
    loadAssignments(w.id);
    loadDailyPrompts(w.id);
  };

  const save = async () => {
    if (!editing?.title?.trim()) {
      toast.error(t("admin.nameRequired"));
      return;
    }
    if (!editing.week_number || editing.week_number < 1) {
      toast.error(t("admin.weekNumberRequired"));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        id: editing.id,
        programme_id: programmeId,
        week_number: editing.week_number,
        title: editing.title!,
        title_vi: editing.title_vi || null,
        subtitle: editing.subtitle || null,
        subtitle_vi: editing.subtitle_vi || null,
        skill_card_html: editing.skill_card_html || null,
        skill_card_html_vi: editing.skill_card_html_vi || null,
        video_url: editing.video_url || null,
        pdf_storage_path: editing.pdf_storage_path || null,
        pdf_storage_path_vi: editing.pdf_storage_path_vi || null,
        is_visible: !!editing.is_visible,
        skill_card_visible: editing.skill_card_visible ?? true,
        unlock_date: editing.unlock_date || null,
      };
      const { error } = await supabase.from("training_weeks").upsert(payload);
      if (error) throw error;
      toast.success(t("admin.saved"));
      setEditing(null);
      loadWeeks(programmeId);
    } catch (e) {
      toast.error(getFriendlyErrorMessage(e, t));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (w: TrainingWeekRow) => {
    const ok = await confirm({
      title: t("admin.deleteConfirmTitle"),
      description: t("admin.deleteConfirmBody"),
      confirmLabel: t("admin.delete"),
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("training_weeks").delete().eq("id", w.id);
    if (error) toast.error(getFriendlyErrorMessage(error, t));
    else {
      toast.success(t("admin.deleted"));
      loadWeeks(programmeId);
    }
  };

  const uploadPdf = async (file: File, lang: "en" | "vi") => {
    if (!editing?.id) return;
    setUploading(lang);
    const path = `${editing.id}/${lang}-${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("training-pdfs").upload(path, file, { upsert: true });
    setUploading(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setEditing((prev) => (prev ? { ...prev, [lang === "en" ? "pdf_storage_path" : "pdf_storage_path_vi"]: path } : prev));
  };

  if (loading && weeks.length === 0 && !editing) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        eyebrow={t("admin.eyebrow")}
        title={t("admin.title")}
        trailing=""
        subtitle={t("admin.subtitle")}
        right={
          <Button onClick={openNew} disabled={!programmeId}>
            <Plus className="h-4 w-4" /> {t("admin.newWeek")}
          </Button>
        }
      />

      <div className="mb-5 max-w-xs">
        <Label className="text-[11px]">{t("admin.programmeLabel")}</Label>
        <Select value={programmeId} onValueChange={setProgrammeId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {programmes.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {weeks.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">{t("admin.empty")}</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {weeks.map((w) => (
            <Card key={w.id} className="p-4">
              <div className="mb-1 flex items-start justify-between gap-2">
                <h3 className="min-w-0 truncate text-base font-semibold">{t("admin.weekN", { n: w.week_number })}</h3>
                <Pill tone={w.is_visible ? "success" : "muted"} className="shrink-0">
                  {w.is_visible ? t("admin.visible") : t("admin.hidden")}
                </Pill>
              </div>
              <p className="truncate text-sm text-foreground">{w.title}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {w.unlock_date ? t("admin.unlocksOn", { date: format(new Date(w.unlock_date), "MMM d, yyyy") }) : t("admin.noUnlockDate")}
              </p>
              <div className="mt-3 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => openEdit(w)}>
                  <Pencil className="h-3.5 w-3.5" /> {t("admin.edit")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => remove(w)}>
                  <Trash2 className="h-3.5 w-3.5" /> {t("admin.delete")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isNewWeek ? t("admin.dialogTitleNew") : t("admin.dialogTitleEdit")}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <WeekEditor editing={editing} setEditing={setEditing} uploading={uploading} onUploadPdf={uploadPdf} t={t} />

              {!isNewWeek && (
                <>
                  <AssignmentEditor
                    weekId={editing.id!}
                    assignments={assignments}
                    loading={assignmentsLoading}
                    onChanged={() => loadAssignments(editing.id!)}
                    t={t}
                  />
                  <DailyPromptManager
                    weekId={editing.id!}
                    prompts={dailyPrompts}
                    loading={dailyPromptsLoading}
                    onChanged={() => loadDailyPrompts(editing.id!)}
                    t={t}
                  />
                  <ReflectionEditor programmeId={programmeId} weekNumber={editing.week_number!} t={t} />
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t("admin.cancel")}
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("admin.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {ConfirmDialog}
    </div>
  );
}
