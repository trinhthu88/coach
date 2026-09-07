import { useEffect, useState } from "react";
import type { TFunction } from "i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Loader2, Plus, Pencil, Trash2, X, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { emptyOption, emptyQuestion, QuizQuestionRow } from "./types";

/** Quiz-question CRUD (question text EN/VI, multiple-choice options, explanation) for one assignment. */
export function QuizQuestionEditor({ assignmentId, t }: { assignmentId: string; t: TFunction }) {
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

  const updateOption = (index: number, patch: Partial<ReturnType<typeof emptyOption>>) => {
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
