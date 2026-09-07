import { useState } from "react";
import type { TFunction } from "i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, ListChecks, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { Pill } from "../_shared";
import { AssignmentRow, emptyAssignment } from "./types";
import { QuizQuestionEditor } from "./QuizQuestionEditor";

/** Quiz-assignment CRUD (title/instructions, visibility, due offset) for one training week, plus its nested question editor. */
export function AssignmentEditor({
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
                    <QuizQuestionEditor assignmentId={a.id} t={t} />
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
