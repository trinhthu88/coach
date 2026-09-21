import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MAX_ACTIVE_GOALS } from "@/lib/goalGate";

export type GoalPayload = {
  title: string;
  description: string | null;
  target_date: string | null;
};

export type AddGoalFn = (payload: GoalPayload) => Promise<boolean | undefined> | void;
export type UpdateGoalFn = (goalId: string, payload: GoalPayload) => Promise<boolean | undefined> | void;

function GoalForm({
  heading,
  initial,
  onSubmit,
  onCancel,
}: {
  heading: string;
  initial?: { title: string; description: string | null; target_date: string | null };
  onSubmit: (payload: GoalPayload) => Promise<boolean | undefined> | void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("journey");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [desc, setDesc] = useState(initial?.description ?? "");
  const [date, setDate] = useState(initial?.target_date ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const ok = await onSubmit({
      title: title.trim(),
      description: desc.trim() || null,
      target_date: date || null,
    });
    setSaving(false);
    if (ok === false) return;
    if (!initial) {
      setTitle(""); setDesc(""); setDate("");
    }
    onCancel();
  };

  return (
    <>
      <DialogHeader><DialogTitle>{heading}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <Input placeholder={t("goalDialog.titlePlaceholder")} value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea placeholder={t("goalDialog.descriptionPlaceholder")} value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} />
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">{t("goalDialog.targetDateLabel")}</p>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>{t("goalDialog.cancel")}</Button>
        <Button onClick={save} disabled={saving || !title.trim()}>{t("goalDialog.saveGoal")}</Button>
      </DialogFooter>
    </>
  );
}

/**
 * Create a goal. `activeCount` is the enrollment's current number of active
 * goals: at MAX_ACTIVE_GOALS the create action is disabled with an explanation
 * (the server enforces the same maximum in validate_enrollment_goal).
 */
export function GoalDialog({ onAdd, activeCount }: { onAdd: AddGoalFn; activeCount?: number }) {
  const { t } = useTranslation("journey");
  const [open, setOpen] = useState(false);
  const limitReached = (activeCount ?? 0) >= MAX_ACTIVE_GOALS;

  if (limitReached) {
    return (
      <span className="inline-flex flex-col items-end gap-1">
        <Button size="sm" disabled aria-describedby="goal-limit-reached">
          <Plus className="mr-1 h-4 w-4" /> {t("goalDialog.newGoal")}
        </Button>
        <span id="goal-limit-reached" className="text-[11px] text-muted-foreground">
          {t("goalDialog.limitReached", { max: MAX_ACTIVE_GOALS })}
        </span>
      </span>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" /> {t("goalDialog.newGoal")}</Button>
      </DialogTrigger>
      <DialogContent>
        <GoalForm heading={t("goalDialog.newGoal")} onSubmit={onAdd} onCancel={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Edit an existing goal's title, description and target date (any time). */
export function EditGoalDialog({
  goal,
  onSave,
}: {
  goal: { id: string; title: string; description: string | null; target_date: string | null };
  onSave: UpdateGoalFn;
}) {
  const { t } = useTranslation("journey");
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
          <Pencil className="h-3 w-3" /> {t("goalDialog.editGoal")}
        </button>
      </DialogTrigger>
      <DialogContent>
        {open && (
          <GoalForm
            heading={t("goalDialog.editGoal")}
            initial={goal}
            onSubmit={(payload) => onSave(goal.id, payload)}
            onCancel={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
