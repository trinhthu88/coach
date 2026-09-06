import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Loader2, Plus, Pencil, Trash2, Upload, X, ListChecks, ChevronDown, ChevronUp, CheckCircle2, ArrowUp, ArrowDown } from "lucide-react";
import { format } from "date-fns";
import { AdminPageHeader, Pill } from "./_shared";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import { getFriendlyErrorMessage } from "@/lib/errors";
import type { AssignmentType } from "@/hooks/training/useAssignments";
import type { QuizOption } from "@/hooks/training/useQuiz";

interface TrainingWeekRow {
  id: string;
  programme_id: string;
  week_number: number;
  title: string;
  title_vi: string | null;
  subtitle: string | null;
  subtitle_vi: string | null;
  skill_card_html: string | null;
  skill_card_html_vi: string | null;
  video_url: string | null;
  pdf_storage_path: string | null;
  pdf_storage_path_vi: string | null;
  is_visible: boolean;
  skill_card_visible: boolean;
  unlock_date: string | null;
}

const emptyWeek = (programmeId: string, nextWeekNumber: number): Partial<TrainingWeekRow> => ({
  id: crypto.randomUUID(),
  programme_id: programmeId,
  week_number: nextWeekNumber,
  title: "",
  title_vi: "",
  subtitle: "",
  subtitle_vi: "",
  skill_card_html: "",
  skill_card_html_vi: "",
  video_url: "",
  is_visible: false,
  skill_card_visible: true,
  unlock_date: null,
});

interface AssignmentRow {
  id: string;
  training_week_id: string;
  assignment_type: AssignmentType;
  title: string;
  title_vi: string | null;
  instructions: string | null;
  instructions_vi: string | null;
  is_visible: boolean;
  due_offset_days: number | null;
  sort_order: number;
}

interface QuizQuestionRow {
  id: string;
  assignment_id: string;
  question_text: string;
  question_text_vi: string | null;
  options: QuizOption[];
  explanation: string | null;
  explanation_vi: string | null;
  sort_order: number;
}

interface DailyPromptRow {
  id: string;
  training_week_id: string;
  day_offset: number | null;
  prompt_text: string;
  prompt_text_vi: string | null;
  is_visible: boolean;
  sort_order: number;
}

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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("admin.weekNumberLabel")}</Label>
                  <Input
                    type="number"
                    min={1}
                    value={editing.week_number ?? 1}
                    onChange={(e) => setEditing({ ...editing, week_number: Number(e.target.value) })}
                  />
                </div>
                <div className="flex items-end justify-between gap-2 rounded-md border p-2.5">
                  <div>
                    <p className="text-sm font-medium">{t("admin.visibleLabel")}</p>
                    <p className="text-[10.5px] text-muted-foreground">{t("admin.visibleHint")}</p>
                  </div>
                  <Switch checked={!!editing.is_visible} onCheckedChange={(v) => setEditing({ ...editing, is_visible: v })} />
                </div>
              </div>
              <div className="flex items-end justify-between gap-2 rounded-md border p-2.5">
                <div>
                  <p className="text-sm font-medium">{t("admin.skillCardVisibleLabel")}</p>
                  <p className="text-[10.5px] text-muted-foreground">{t("admin.skillCardVisibleHint")}</p>
                </div>
                <Switch
                  checked={editing.skill_card_visible ?? true}
                  onCheckedChange={(v) => setEditing({ ...editing, skill_card_visible: v })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("admin.titleLabel")}</Label>
                  <Input value={editing.title || ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
                </div>
                <div>
                  <Label>{t("admin.titleViLabel")}</Label>
                  <Input value={editing.title_vi || ""} onChange={(e) => setEditing({ ...editing, title_vi: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("admin.subtitleLabel")}</Label>
                  <Input value={editing.subtitle || ""} onChange={(e) => setEditing({ ...editing, subtitle: e.target.value })} />
                </div>
                <div>
                  <Label>{t("admin.subtitleViLabel")}</Label>
                  <Input value={editing.subtitle_vi || ""} onChange={(e) => setEditing({ ...editing, subtitle_vi: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>{t("admin.unlockDateLabel")}</Label>
                <Input
                  type="date"
                  value={editing.unlock_date || ""}
                  onChange={(e) => setEditing({ ...editing, unlock_date: e.target.value || null })}
                />
                <p className="mt-1 text-[10.5px] text-muted-foreground">{t("admin.unlockDateHint")}</p>
              </div>
              <div>
                <Label>{t("admin.skillCardHtmlLabel")}</Label>
                <Textarea
                  rows={6}
                  className="font-mono text-xs"
                  value={editing.skill_card_html || ""}
                  onChange={(e) => setEditing({ ...editing, skill_card_html: e.target.value })}
                />
              </div>
              <div>
                <Label>{t("admin.skillCardHtmlViLabel")}</Label>
                <Textarea
                  rows={6}
                  className="font-mono text-xs"
                  value={editing.skill_card_html_vi || ""}
                  onChange={(e) => setEditing({ ...editing, skill_card_html_vi: e.target.value })}
                />
              </div>
              <div>
                <Label>{t("admin.videoUrlLabel")}</Label>
                <Input
                  value={editing.video_url || ""}
                  onChange={(e) => setEditing({ ...editing, video_url: e.target.value })}
                  placeholder="https://www.youtube.com/embed/..."
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <PdfField
                  label={t("admin.pdfLabel")}
                  path={editing.pdf_storage_path}
                  uploading={uploading === "en"}
                  onUpload={(f) => uploadPdf(f, "en")}
                  onRemove={() => setEditing({ ...editing, pdf_storage_path: null })}
                  t={t}
                />
                <PdfField
                  label={t("admin.pdfViLabel")}
                  path={editing.pdf_storage_path_vi}
                  uploading={uploading === "vi"}
                  onUpload={(f) => uploadPdf(f, "vi")}
                  onRemove={() => setEditing({ ...editing, pdf_storage_path_vi: null })}
                  t={t}
                />
              </div>

              {!isNewWeek && (
                <>
                  <AssignmentsEditor
                    weekId={editing.id!}
                    assignments={assignments}
                    loading={assignmentsLoading}
                    onChanged={() => loadAssignments(editing.id!)}
                    t={t}
                  />
                  <DailyPromptsEditor
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

function PdfField({
  label,
  path,
  uploading,
  onUpload,
  onRemove,
  t,
}: {
  label: string;
  path: string | null | undefined;
  uploading: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
  t: (key: string) => string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      {path ? (
        <div className="flex items-center justify-between rounded-md border px-2.5 py-2 text-[11px]">
          <span className="truncate">{t("admin.currentFile")}: {path.split("/").pop()}</span>
          <div className="flex shrink-0 items-center gap-1">
            <label className="cursor-pointer text-primary hover:underline">
              {t("admin.replacePdf")}
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
              />
            </label>
            <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed px-2.5 py-2 text-[11px] font-medium text-muted-foreground hover:border-primary hover:text-primary">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {uploading ? t("admin.uploading") : t("admin.uploadPdf")}
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={uploading}
            onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
          />
        </label>
      )}
    </div>
  );
}

const emptyAssignment = (weekId: string, nextSort: number): Partial<AssignmentRow> & { training_week_id: string } => ({
  training_week_id: weekId,
  assignment_type: "quiz",
  title: "",
  title_vi: "",
  instructions: "",
  instructions_vi: "",
  is_visible: false,
  due_offset_days: 7,
  sort_order: nextSort,
});

function AssignmentsEditor({
  weekId,
  assignments,
  loading,
  onChanged,
  t,
}: {
  weekId: string;
  assignments: AssignmentRow[];
  loading: boolean;
  onChanged: () => void;
  t: TFunction;
}) {
  const { confirm, ConfirmDialog } = useConfirm();
  const [editingA, setEditingA] = useState<(Partial<AssignmentRow> & { training_week_id: string }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const saveAssignment = async () => {
    if (!editingA?.title?.trim()) {
      toast.error(t("admin.nameRequired"));
      return;
    }
    setSaving(true);
    const payload = {
      ...(editingA.id ? { id: editingA.id } : {}),
      training_week_id: weekId,
      assignment_type: editingA.assignment_type || "quiz",
      title: editingA.title,
      title_vi: editingA.title_vi || null,
      instructions: editingA.instructions || null,
      instructions_vi: editingA.instructions_vi || null,
      is_visible: !!editingA.is_visible,
      due_offset_days: editingA.due_offset_days ?? 7,
      sort_order: editingA.sort_order ?? assignments.length,
    };
    const { error } = await supabase.from("assignments").upsert(payload);
    setSaving(false);
    if (error) {
      toast.error(getFriendlyErrorMessage(error, t));
      return;
    }
    toast.success(t("admin.assignmentSaved"));
    setEditingA(null);
    onChanged();
  };

  const removeAssignment = async (a: AssignmentRow) => {
    const ok = await confirm({
      title: t("admin.delete"),
      description: t("admin.assignmentDeleteConfirmBody"),
      confirmLabel: t("admin.delete"),
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("assignments").delete().eq("id", a.id);
    if (error) toast.error(getFriendlyErrorMessage(error, t));
    else {
      toast.success(t("admin.assignmentDeleted"));
      onChanged();
    }
  };

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("admin.assignmentsHeading")}</p>
          <p className="text-[10.5px] text-muted-foreground">{t("admin.assignmentsHint")}</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setEditingA(emptyAssignment(weekId, assignments.length))}>
          <Plus className="h-3.5 w-3.5" /> {t("admin.addAssignment")}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        </div>
      ) : assignments.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-muted-foreground">{t("admin.noAssignments")}</p>
      ) : (
        <ul className="space-y-1.5">
          {assignments.map((a) => {
            const isExpanded = expandedId === a.id;
            return (
              <li key={a.id} className="rounded-md border bg-card">
                <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px]">
                  <div className="flex min-w-0 items-center gap-2">
                    <ListChecks className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <Pill tone={a.is_visible ? "success" : "muted"}>{a.is_visible ? t("admin.visible") : t("admin.hidden")}</Pill>
                    <span className="truncate font-medium">{a.title}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setExpandedId(isExpanded ? null : a.id)}>
                      {t("admin.questions")} {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEditingA({ ...a, training_week_id: weekId })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeAssignment(a)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t p-2.5">
                    <QuizQuestionsEditor assignmentId={a.id} t={t} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={!!editingA} onOpenChange={(o) => !o && setEditingA(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.addAssignment")}</DialogTitle>
          </DialogHeader>
          {editingA && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 rounded-md border p-2.5">
                <p className="text-sm font-medium">{t("admin.visibleLabel")}</p>
                <Switch checked={!!editingA.is_visible} onCheckedChange={(v) => setEditingA({ ...editingA, is_visible: v })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("admin.titleLabel")}</Label>
                  <Input value={editingA.title || ""} onChange={(e) => setEditingA({ ...editingA, title: e.target.value })} />
                </div>
                <div>
                  <Label>{t("admin.titleViLabel")}</Label>
                  <Input value={editingA.title_vi || ""} onChange={(e) => setEditingA({ ...editingA, title_vi: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("admin.instructionsLabel")}</Label>
                  <Textarea
                    rows={3}
                    value={editingA.instructions || ""}
                    onChange={(e) => setEditingA({ ...editingA, instructions: e.target.value })}
                  />
                </div>
                <div>
                  <Label>{t("admin.instructionsViLabel")}</Label>
                  <Textarea
                    rows={3}
                    value={editingA.instructions_vi || ""}
                    onChange={(e) => setEditingA({ ...editingA, instructions_vi: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>{t("admin.dueOffsetLabel")}</Label>
                <Input
                  type="number"
                  min={0}
                  value={editingA.due_offset_days ?? 7}
                  onChange={(e) => setEditingA({ ...editingA, due_offset_days: Number(e.target.value) })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingA(null)}>
              {t("admin.cancel")}
            </Button>
            <Button onClick={saveAssignment} disabled={saving}>
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

const emptyOption = (): QuizOption => ({ id: crypto.randomUUID().slice(0, 8), text: "", text_vi: "", is_correct: false });

const emptyQuestion = (assignmentId: string, nextSort: number): Partial<QuizQuestionRow> & { assignment_id: string } => ({
  assignment_id: assignmentId,
  question_text: "",
  question_text_vi: "",
  options: [emptyOption(), emptyOption()],
  explanation: "",
  explanation_vi: "",
  sort_order: nextSort,
});

function QuizQuestionsEditor({ assignmentId, t }: { assignmentId: string; t: TFunction }) {
  const { confirm, ConfirmDialog } = useConfirm();
  const [questions, setQuestions] = useState<QuizQuestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingQ, setEditingQ] = useState<(Partial<QuizQuestionRow> & { assignment_id: string }) | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("quiz_questions")
      .select("id, assignment_id, question_text, question_text_vi, options, explanation, explanation_vi, sort_order")
      .eq("assignment_id", assignmentId)
      .order("sort_order");
    setQuestions((data || []) as unknown as QuizQuestionRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  const saveQuestion = async () => {
    if (!editingQ?.question_text?.trim()) {
      toast.error(t("admin.nameRequired"));
      return;
    }
    const options = editingQ.options || [];
    if (options.length < 2 || options.some((o) => !o.text.trim()) || !options.some((o) => o.is_correct)) {
      toast.error(t("admin.questionOptionsInvalid"));
      return;
    }
    setSaving(true);
    const payload = {
      ...(editingQ.id ? { id: editingQ.id } : {}),
      assignment_id: assignmentId,
      question_text: editingQ.question_text,
      question_text_vi: editingQ.question_text_vi || null,
      options,
      explanation: editingQ.explanation || null,
      explanation_vi: editingQ.explanation_vi || null,
      sort_order: editingQ.sort_order ?? questions.length,
    };
    const { error } = await supabase.from("quiz_questions").upsert(payload);
    setSaving(false);
    if (error) {
      toast.error(getFriendlyErrorMessage(error, t));
      return;
    }
    toast.success(t("admin.questionSaved"));
    setEditingQ(null);
    load();
  };

  const removeQuestion = async (q: QuizQuestionRow) => {
    const ok = await confirm({
      title: t("admin.delete"),
      description: t("admin.questionDeleteConfirmBody"),
      confirmLabel: t("admin.delete"),
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("quiz_questions").delete().eq("id", q.id);
    if (error) toast.error(getFriendlyErrorMessage(error, t));
    else {
      toast.success(t("admin.questionDeleted"));
      load();
    }
  };

  const updateOption = (index: number, patch: Partial<QuizOption>) => {
    if (!editingQ) return;
    const options = [...(editingQ.options || [])];
    options[index] = { ...options[index], ...patch };
    setEditingQ({ ...editingQ, options });
  };

  const setCorrectOption = (index: number) => {
    if (!editingQ) return;
    const options = (editingQ.options || []).map((o, i) => ({ ...o, is_correct: i === index }));
    setEditingQ({ ...editingQ, options });
  };

  const addOption = () => {
    if (!editingQ) return;
    setEditingQ({ ...editingQ, options: [...(editingQ.options || []), emptyOption()] });
  };

  const removeOption = (index: number) => {
    if (!editingQ) return;
    setEditingQ({ ...editingQ, options: (editingQ.options || []).filter((_, i) => i !== index) });
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10.5px] font-semibold text-muted-foreground">{t("admin.questionsHeading")}</p>
        <Button type="button" size="sm" variant="outline" onClick={() => setEditingQ(emptyQuestion(assignmentId, questions.length))}>
          <Plus className="h-3.5 w-3.5" /> {t("admin.addQuestion")}
        </Button>
      </div>
      {loading ? (
        <div className="flex justify-center py-3">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        </div>
      ) : questions.length === 0 ? (
        <p className="py-2 text-center text-[11px] text-muted-foreground">{t("admin.noQuestions")}</p>
      ) : (
        <ul className="space-y-1.5">
          {questions.map((q) => (
            <li key={q.id} className="flex items-center justify-between gap-2 rounded-md border bg-background px-2.5 py-1.5 text-[11px]">
              <span className="min-w-0 truncate">{q.question_text}</span>
              <div className="flex shrink-0 items-center gap-0.5">
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditingQ({ ...q, assignment_id: assignmentId })}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeQuestion(q)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!editingQ} onOpenChange={(o) => !o && setEditingQ(null)}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("admin.addQuestion")}</DialogTitle>
          </DialogHeader>
          {editingQ && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("admin.questionText")}</Label>
                  <Textarea
                    rows={2}
                    value={editingQ.question_text || ""}
                    onChange={(e) => setEditingQ({ ...editingQ, question_text: e.target.value })}
                  />
                </div>
                <div>
                  <Label>{t("admin.questionTextVi")}</Label>
                  <Textarea
                    rows={2}
                    value={editingQ.question_text_vi || ""}
                    onChange={(e) => setEditingQ({ ...editingQ, question_text_vi: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <Label>{t("admin.optionsLabel")}</Label>
                  <Button type="button" size="sm" variant="outline" onClick={addOption}>
                    <Plus className="h-3.5 w-3.5" /> {t("admin.addOption")}
                  </Button>
                </div>
                <div className="space-y-2">
                  {(editingQ.options || []).map((opt, idx) => (
                    <div key={idx} className="flex items-center gap-2 rounded-md border p-2">
                      <button type="button" onClick={() => setCorrectOption(idx)} title={t("admin.markCorrect")} className="shrink-0">
                        <CheckCircle2 className={cn("h-4 w-4", opt.is_correct ? "text-success" : "text-muted-foreground/40")} />
                      </button>
                      <Input
                        className="flex-1"
                        placeholder={t("admin.optionText")}
                        value={opt.text}
                        onChange={(e) => updateOption(idx, { text: e.target.value })}
                      />
                      <Input
                        className="flex-1"
                        placeholder={t("admin.optionTextVi")}
                        value={opt.text_vi || ""}
                        onChange={(e) => updateOption(idx, { text_vi: e.target.value })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeOption(idx)}
                        disabled={(editingQ.options || []).length <= 2}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-[10.5px] text-muted-foreground">{t("admin.optionsHint")}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("admin.explanationLabel")}</Label>
                  <Textarea
                    rows={2}
                    value={editingQ.explanation || ""}
                    onChange={(e) => setEditingQ({ ...editingQ, explanation: e.target.value })}
                  />
                </div>
                <div>
                  <Label>{t("admin.explanationViLabel")}</Label>
                  <Textarea
                    rows={2}
                    value={editingQ.explanation_vi || ""}
                    onChange={(e) => setEditingQ({ ...editingQ, explanation_vi: e.target.value })}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingQ(null)}>
              {t("admin.cancel")}
            </Button>
            <Button onClick={saveQuestion} disabled={saving}>
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

const emptyDailyPrompt = (weekId: string, nextSort: number): Partial<DailyPromptRow> & { training_week_id: string } => ({
  training_week_id: weekId,
  day_offset: null,
  prompt_text: "",
  prompt_text_vi: "",
  is_visible: true,
  sort_order: nextSort,
});

/**
 * 0-7 flexible daily prompts per week, each independently toggleable and
 * either pinned to a day_offset (1-7) or left null ("any day this week") —
 * spec explicitly rejects the old fixed-7-slots model.
 */
function DailyPromptsEditor({
  weekId,
  prompts,
  loading,
  onChanged,
  t,
}: {
  weekId: string;
  prompts: DailyPromptRow[];
  loading: boolean;
  onChanged: () => void;
  t: TFunction;
}) {
  const { confirm, ConfirmDialog } = useConfirm();
  const [editingP, setEditingP] = useState<(Partial<DailyPromptRow> & { training_week_id: string }) | null>(null);
  const [saving, setSaving] = useState(false);

  const savePrompt = async () => {
    if (!editingP?.prompt_text?.trim()) {
      toast.error(t("admin.nameRequired"));
      return;
    }
    setSaving(true);
    const payload = {
      ...(editingP.id ? { id: editingP.id } : {}),
      training_week_id: weekId,
      day_offset: editingP.day_offset ?? null,
      prompt_text: editingP.prompt_text,
      prompt_text_vi: editingP.prompt_text_vi || null,
      is_visible: editingP.is_visible ?? true,
      sort_order: editingP.sort_order ?? prompts.length,
    };
    const { error } = await supabase.from("daily_prompts").upsert(payload);
    setSaving(false);
    if (error) {
      toast.error(getFriendlyErrorMessage(error, t));
      return;
    }
    toast.success(t("admin.promptSaved"));
    setEditingP(null);
    onChanged();
  };

  const removePrompt = async (p: DailyPromptRow) => {
    const ok = await confirm({
      title: t("admin.delete"),
      description: t("admin.promptDeleteConfirmBody"),
      confirmLabel: t("admin.delete"),
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("daily_prompts").delete().eq("id", p.id);
    if (error) toast.error(getFriendlyErrorMessage(error, t));
    else {
      toast.success(t("admin.promptDeleted"));
      onChanged();
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= prompts.length) return;
    const a = prompts[index];
    const b = prompts[target];
    const [{ error: errA }, { error: errB }] = await Promise.all([
      supabase.from("daily_prompts").update({ sort_order: b.sort_order }).eq("id", a.id),
      supabase.from("daily_prompts").update({ sort_order: a.sort_order }).eq("id", b.id),
    ]);
    const error = errA || errB;
    if (error) toast.error(getFriendlyErrorMessage(error, t));
    else onChanged();
  };

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("admin.dailyPromptsHeading")}</p>
          <p className="text-[10.5px] text-muted-foreground">{t("admin.dailyPromptsHint")}</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setEditingP(emptyDailyPrompt(weekId, prompts.length))}>
          <Plus className="h-3.5 w-3.5" /> {t("admin.addPrompt")}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        </div>
      ) : prompts.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-muted-foreground">{t("admin.noPrompts")}</p>
      ) : (
        <ul className="space-y-1.5">
          {prompts.map((p, idx) => (
            <li key={p.id} className="flex items-center justify-between gap-2 rounded-md border bg-card px-2.5 py-1.5 text-[11px]">
              <div className="flex min-w-0 items-center gap-2">
                <Pill tone="secondary">{p.day_offset ? t("admin.dayN", { n: p.day_offset }) : t("admin.anyDay")}</Pill>
                <Pill tone={p.is_visible ? "success" : "muted"}>{p.is_visible ? t("admin.visible") : t("admin.hidden")}</Pill>
                <span className="min-w-0 truncate">{p.prompt_text}</span>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <Button type="button" variant="ghost" size="sm" onClick={() => move(idx, -1)} disabled={idx === 0} title={t("admin.moveUp")}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => move(idx, 1)}
                  disabled={idx === prompts.length - 1}
                  title={t("admin.moveDown")}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditingP({ ...p, training_week_id: weekId })}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => removePrompt(p)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!editingP} onOpenChange={(o) => !o && setEditingP(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.addPrompt")}</DialogTitle>
          </DialogHeader>
          {editingP && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("admin.dayOffsetLabel")}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={7}
                    placeholder={t("admin.anyDay")}
                    value={editingP.day_offset ?? ""}
                    onChange={(e) =>
                      setEditingP({ ...editingP, day_offset: e.target.value === "" ? null : Number(e.target.value) })
                    }
                  />
                  <p className="mt-1 text-[10.5px] text-muted-foreground">{t("admin.dayOffsetHint")}</p>
                </div>
                <div className="flex items-end justify-between gap-2 rounded-md border p-2.5">
                  <p className="text-sm font-medium">{t("admin.visibleLabel")}</p>
                  <Switch checked={editingP.is_visible ?? true} onCheckedChange={(v) => setEditingP({ ...editingP, is_visible: v })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Textarea
                  rows={3}
                  placeholder={t("admin.promptTextPlaceholder")}
                  value={editingP.prompt_text || ""}
                  onChange={(e) => setEditingP({ ...editingP, prompt_text: e.target.value })}
                />
                <Textarea
                  rows={3}
                  placeholder={t("admin.promptTextViPlaceholder")}
                  value={editingP.prompt_text_vi || ""}
                  onChange={(e) => setEditingP({ ...editingP, prompt_text_vi: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingP(null)}>
              {t("admin.cancel")}
            </Button>
            <Button onClick={savePrompt} disabled={saving}>
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

type ReflectionQuestionType = "open_text" | "scale_1_10";

interface ReflectionRow {
  id: string;
  programme_id: string;
  reflection_number: number;
  title: string;
  title_vi: string | null;
  instructions: string | null;
  instructions_vi: string | null;
  appears_at_week: number;
  is_visible: boolean;
}

interface ReflectionQuestionRow {
  id: string;
  reflection_id: string;
  question_text: string;
  question_text_vi: string | null;
  question_type: ReflectionQuestionType;
  is_required: boolean;
  sort_order: number;
}

const emptyReflectionQuestion = (reflectionId: string, nextSort: number): Partial<ReflectionQuestionRow> & { reflection_id: string } => ({
  reflection_id: reflectionId,
  question_text: "",
  question_text_vi: "",
  question_type: "open_text",
  is_required: true,
  sort_order: nextSort,
});

/**
 * The reflection assigned to this training week (programme_reflections,
 * keyed by programme_id + appears_at_week = this week's week_number), its
 * admin-authored questions, and the ability to create one if none exists
 * yet. Confidence score is not a question here — it's a fixed field always
 * collected on submission, see reflection_submissions.confidence_score.
 */
function ReflectionEditor({ programmeId, weekNumber, t }: { programmeId: string; weekNumber: number; t: TFunction }) {
  const { confirm, ConfirmDialog } = useConfirm();
  const [reflection, setReflection] = useState<ReflectionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [questions, setQuestions] = useState<ReflectionQuestionRow[]>([]);
  const [editingQ, setEditingQ] = useState<(Partial<ReflectionQuestionRow> & { reflection_id: string }) | null>(null);
  const [savingQ, setSavingQ] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("programme_reflections")
      .select("id, programme_id, reflection_number, title, title_vi, instructions, instructions_vi, appears_at_week, is_visible")
      .eq("programme_id", programmeId)
      .eq("appears_at_week", weekNumber)
      .maybeSingle();
    setReflection((data as ReflectionRow | null) ?? null);
    if (data) {
      const { data: q } = await supabase
        .from("reflection_questions")
        .select("id, reflection_id, question_text, question_text_vi, question_type, is_required, sort_order")
        .eq("reflection_id", data.id)
        .order("sort_order");
      setQuestions((q || []) as ReflectionQuestionRow[]);
    } else {
      setQuestions([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programmeId, weekNumber]);

  const createReflection = async () => {
    setSaving(true);
    const { error } = await supabase.from("programme_reflections").insert({
      programme_id: programmeId,
      reflection_number: weekNumber,
      title: t("admin.reflection.defaultTitle", { n: weekNumber }),
      appears_at_week: weekNumber,
      is_visible: false,
    });
    setSaving(false);
    if (error) {
      toast.error(getFriendlyErrorMessage(error, t));
      return;
    }
    load();
  };

  const saveReflection = async () => {
    if (!reflection?.title.trim()) {
      toast.error(t("admin.nameRequired"));
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("programme_reflections")
      .update({
        title: reflection.title,
        title_vi: reflection.title_vi || null,
        instructions: reflection.instructions || null,
        instructions_vi: reflection.instructions_vi || null,
        is_visible: reflection.is_visible,
      })
      .eq("id", reflection.id);
    setSaving(false);
    if (error) {
      toast.error(getFriendlyErrorMessage(error, t));
      return;
    }
    toast.success(t("admin.saved"));
  };

  const deleteReflection = async () => {
    if (!reflection) return;
    const ok = await confirm({
      title: t("admin.delete"),
      description: t("admin.reflection.deleteConfirmBody"),
      confirmLabel: t("admin.delete"),
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("programme_reflections").delete().eq("id", reflection.id);
    if (error) toast.error(getFriendlyErrorMessage(error, t));
    else {
      toast.success(t("admin.deleted"));
      load();
    }
  };

  const saveQuestion = async () => {
    if (!editingQ?.question_text?.trim()) {
      toast.error(t("admin.nameRequired"));
      return;
    }
    setSavingQ(true);
    const payload = {
      ...(editingQ.id ? { id: editingQ.id } : {}),
      reflection_id: editingQ.reflection_id,
      question_text: editingQ.question_text,
      question_text_vi: editingQ.question_text_vi || null,
      question_type: editingQ.question_type || "open_text",
      is_required: editingQ.is_required ?? true,
      sort_order: editingQ.sort_order ?? questions.length,
    };
    const { error } = await supabase.from("reflection_questions").upsert(payload);
    setSavingQ(false);
    if (error) {
      toast.error(getFriendlyErrorMessage(error, t));
      return;
    }
    toast.success(t("admin.questionSaved"));
    setEditingQ(null);
    load();
  };

  const removeQuestion = async (q: ReflectionQuestionRow) => {
    const ok = await confirm({
      title: t("admin.delete"),
      description: t("admin.questionDeleteConfirmBody"),
      confirmLabel: t("admin.delete"),
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("reflection_questions").delete().eq("id", q.id);
    if (error) toast.error(getFriendlyErrorMessage(error, t));
    else {
      toast.success(t("admin.questionDeleted"));
      load();
    }
  };

  const moveQuestion = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= questions.length) return;
    const a = questions[index];
    const b = questions[target];
    const [{ error: errA }, { error: errB }] = await Promise.all([
      supabase.from("reflection_questions").update({ sort_order: b.sort_order }).eq("id", a.id),
      supabase.from("reflection_questions").update({ sort_order: a.sort_order }).eq("id", b.id),
    ]);
    const error = errA || errB;
    if (error) toast.error(getFriendlyErrorMessage(error, t));
    else load();
  };

  if (loading) {
    return (
      <div className="flex justify-center rounded-lg border p-4">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      </div>
    );
  }

  if (!reflection) {
    return (
      <div className="rounded-lg border p-3">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("admin.reflection.heading")}</p>
        <p className="mb-3 text-[10.5px] text-muted-foreground">{t("admin.reflection.hint")}</p>
        <Button type="button" size="sm" variant="outline" onClick={createReflection} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          {t("admin.reflection.create", { n: weekNumber })}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("admin.reflection.heading")}</p>
          <p className="text-[10.5px] text-muted-foreground">{t("admin.reflection.hint")}</p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={deleteReflection}>
          <Trash2 className="h-3.5 w-3.5" /> {t("admin.delete")}
        </Button>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t("admin.titleLabel")}</Label>
            <Input value={reflection.title} onChange={(e) => setReflection({ ...reflection, title: e.target.value })} />
          </div>
          <div>
            <Label>{t("admin.titleViLabel")}</Label>
            <Input value={reflection.title_vi || ""} onChange={(e) => setReflection({ ...reflection, title_vi: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t("admin.instructionsLabel")}</Label>
            <Textarea
              rows={2}
              value={reflection.instructions || ""}
              onChange={(e) => setReflection({ ...reflection, instructions: e.target.value })}
            />
          </div>
          <div>
            <Label>{t("admin.instructionsViLabel")}</Label>
            <Textarea
              rows={2}
              value={reflection.instructions_vi || ""}
              onChange={(e) => setReflection({ ...reflection, instructions_vi: e.target.value })}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-md border p-2.5">
          <p className="text-sm font-medium">{t("admin.visibleLabel")}</p>
          <Switch checked={reflection.is_visible} onCheckedChange={(v) => setReflection({ ...reflection, is_visible: v })} />
        </div>
        <Button type="button" size="sm" onClick={saveReflection} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t("admin.save")}
        </Button>
      </div>

      <div className="mt-4 border-t pt-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10.5px] font-semibold text-muted-foreground">{t("admin.reflection.questionsHeading")}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEditingQ(emptyReflectionQuestion(reflection.id, questions.length))}
          >
            <Plus className="h-3.5 w-3.5" /> {t("admin.addQuestion")}
          </Button>
        </div>
        <p className="mb-2 text-[10.5px] italic text-muted-foreground">{t("admin.reflection.confidenceNote")}</p>

        {questions.length === 0 ? (
          <p className="py-2 text-center text-[11px] text-muted-foreground">{t("admin.noQuestions")}</p>
        ) : (
          <ul className="space-y-1.5">
            {questions.map((q, idx) => (
              <li key={q.id} className="flex items-center justify-between gap-2 rounded-md border bg-background px-2.5 py-1.5 text-[11px]">
                <div className="flex min-w-0 items-center gap-2">
                  <Pill tone="secondary">{t(`admin.reflection.questionTypes.${q.question_type}`)}</Pill>
                  {q.is_required && <Pill tone="muted">{t("admin.reflection.required")}</Pill>}
                  <span className="min-w-0 truncate">{q.question_text}</span>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button type="button" variant="ghost" size="sm" onClick={() => moveQuestion(idx, -1)} disabled={idx === 0}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveQuestion(idx, 1)}
                    disabled={idx === questions.length - 1}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditingQ({ ...q })}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeQuestion(q)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={!!editingQ} onOpenChange={(o) => !o && setEditingQ(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.addQuestion")}</DialogTitle>
          </DialogHeader>
          {editingQ && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("admin.questionText")}</Label>
                  <Textarea
                    rows={2}
                    value={editingQ.question_text || ""}
                    onChange={(e) => setEditingQ({ ...editingQ, question_text: e.target.value })}
                  />
                </div>
                <div>
                  <Label>{t("admin.questionTextVi")}</Label>
                  <Textarea
                    rows={2}
                    value={editingQ.question_text_vi || ""}
                    onChange={(e) => setEditingQ({ ...editingQ, question_text_vi: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("admin.reflection.questionType")}</Label>
                  <Select
                    value={editingQ.question_type}
                    onValueChange={(v) => setEditingQ({ ...editingQ, question_type: v as ReflectionQuestionType })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open_text">{t("admin.reflection.questionTypes.open_text")}</SelectItem>
                      <SelectItem value="scale_1_10">{t("admin.reflection.questionTypes.scale_1_10")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end justify-between gap-2 rounded-md border p-2.5">
                  <p className="text-sm font-medium">{t("admin.reflection.required")}</p>
                  <Switch
                    checked={editingQ.is_required ?? true}
                    onCheckedChange={(v) => setEditingQ({ ...editingQ, is_required: v })}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingQ(null)}>
              {t("admin.cancel")}
            </Button>
            <Button onClick={saveQuestion} disabled={savingQ}>
              {savingQ ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("admin.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {ConfirmDialog}
    </div>
  );
}
