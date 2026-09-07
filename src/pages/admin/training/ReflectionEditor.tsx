import { useEffect, useState } from "react";
import type { TFunction } from "i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { Pill } from "../_shared";
import { emptyReflectionQuestion, ReflectionQuestionRow, ReflectionQuestionType, ReflectionRow } from "./types";

/**
 * The reflection assigned to this training week (programme_reflections,
 * keyed by programme_id + appears_at_week = this week's week_number), its
 * admin-authored questions, and the ability to create one if none exists
 * yet. Confidence score is not a question here — it's a fixed field always
 * collected on submission, see reflection_submissions.confidence_score.
 */
export function ReflectionEditor({ programmeId, weekNumber, t }: { programmeId: string; weekNumber: number; t: TFunction }) {
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
