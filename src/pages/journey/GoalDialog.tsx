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
  start_rating: number;
  target_rating: number;
};

export type AddGoalFn = (payload: GoalPayload) => Promise<boolean | undefined> | void;
export type UpdateGoalPayload = Omit<GoalPayload, "start_rating" | "target_rating">;
export type UpdateGoalFn = (goalId: string, payload: UpdateGoalPayload) => Promise<boolean | undefined> | void;

function GoalForm({
  heading,
  initial,
  onSubmit,
  onCancel,
}: {
  heading: string;
  initial?: { title: string; description: string | null; target_date: string | null };
  onSubmit: (payload: GoalPayload | UpdateGoalPayload) => Promise<boolean | undefined> | void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("journey");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [desc, setDesc] = useState(initial?.description ?? "");
  const [date, setDate] = useState(initial?.target_date ?? "");
  const [startRating, setStartRating] = useState("");
  const [targetRating, setTargetRating] = useState("");
  const [ratingError, setRatingError] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) return;
    const start = Number(startRating);
    const target = Number(targetRating);
    if (!initial && (!Number.isInteger(start) || start < 0 || start > 100 || !Number.isInteger(target) || target < 0 || target > 100)) {
      setRatingError(true);
      return;
    }
    setSaving(true);
    const payload = {
      title: title.trim(),
      description: desc.trim() || null,
      target_date: date || null,
      ...(!initial ? { start_rating: start, target_rating: target } : {}),
    } as GoalPayload | UpdateGoalPayload;
    const ok = await onSubmit(payload);
    setSaving(false);
    if (ok === false) return;
    if (!initial) {
      setTitle(""); setDesc(""); setDate(""); setStartRating(""); setTargetRating("");
    }
    onCancel();
  };

  return (
    <>
      <DialogHeader><DialogTitle>{heading}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <Input placeholder={t("goalDialog.titlePlaceholder")} value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea placeholder={t("goalDialog.descriptionPlaceholder")} value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} />
        {!initial && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t("goalDialog.startRatingLabel")}
              <Input
                className="mt-1"
                type="number"
                min={0}
                max={100}
                step={1}
                required
                placeholder="0–100"
                value={startRating}
                onChange={(e) => { setStartRating(e.target.value); setRatingError(false); }}
              />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              {t("goalDialog.targetRatingLabel")}
              <Input
                className="mt-1"
                type="number"
                min={0}
                max={100}
                step={1}
                required
                placeholder="0–100"
                value={targetRating}
                onChange={(e) => { setTargetRating(e.target.value); setRatingError(false); }}
              />
            </label>
          </div>
        )}
        {ratingError && <p role="alert" className="text-xs text-destructive">{t("goalDialog.ratingRequired")}</p>}
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">{t("goalDialog.targetDateLabel")}</p>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>{t("goalDialog.cancel")}</Button>
        <Button onClick={save} disabled={saving || !title.trim() || (!initial && (!startRating || !targetRating))}>{t("goalDialog.saveGoal")}</Button>
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
