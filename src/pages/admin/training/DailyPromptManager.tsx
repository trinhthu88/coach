import { useState } from "react";
import type { TFunction } from "i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { Pill } from "../_shared";
import { DailyPromptRow, emptyDailyPrompt } from "./types";

/**
 * 0-7 flexible daily prompts per week, each independently toggleable and
 * either pinned to a day_offset (1-7) or left null ("any day this week") —
 * spec explicitly rejects the old fixed-7-slots model.
 */
export function DailyPromptManager({
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
