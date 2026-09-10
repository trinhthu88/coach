import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save, Target, Lock } from "lucide-react";
import { toast } from "sonner";
import { GoalDialog, type AddGoalFn } from "@/pages/journey/GoalDialog";
import { cn } from "@/lib/utils";

interface Props {
  sessionId: string;
  coacheeId: string;
  enrollmentId?: string | null;
  sourceActivityType?: "coaching" | "mentoring" | "peer_coaching" | "triad";
  /** Whether the current viewer can edit (must be the coachee themselves AND session completed). */
  canEdit: boolean;
  canCreateGoal?: boolean;
  sessionStatus: string;
}

interface GoalRow {
  id: string;
  title: string;
}

interface RatingRow {
  goal_id: string;
  new_rating: number | null;
  note: string | null;
}
type GoalCheckinPayload = { goal_id: string; new_rating: number | null; note: string | null };

export function SessionGoalRatings({ sessionId, coacheeId, enrollmentId, sourceActivityType = "coaching", canEdit, canCreateGoal = canEdit, sessionStatus }: Props) {
  const { t } = useTranslation("sessions");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [ratings, setRatings] = useState<Record<string, { rating: number | null; note: string }>>({});
  const pendingSubmission = useRef<{ fingerprint: string; id: string } | null>(null);

  const load = useCallback(async () => {
    if (!enrollmentId) { setGoals([]); setRatings({}); setLoading(false); return; }
    setLoading(true);
    const [{ data: gs, error: goalsError }, { data: rs, error: ratingsError }] = await Promise.all([
      supabase
        .from("coachee_goals")
        .select("id, title")
        .eq("enrollment_id", enrollmentId)
        .eq("status", "active")
        .order("sort_order"),
      supabase
        .from("goal_checkins")
        .select("goal_id, new_rating, note")
        .eq("enrollment_id", enrollmentId)
        .eq("source_activity_type", sourceActivityType)
        .eq("source_activity_id", sessionId)
        .order("created_at", { ascending: false }),
    ]);
    if (goalsError || ratingsError) {
      setGoals([]);
      setRatings({});
      setLoading(false);
      toast.error((goalsError ?? ratingsError)?.message ?? "Unable to load goal check-ins");
      return;
    }
    const goalList = (gs || []) as GoalRow[];
    setGoals(goalList);
    const map: Record<string, { rating: number | null; note: string }> = {};
    goalList.forEach((g) => {
      const existing = (rs as RatingRow[] | null)?.find((r) => r.goal_id === g.id);
      map[g.id] = {
        rating: existing?.new_rating ?? null,
        note: existing?.note ?? "",
      };
    });
    setRatings(map);
    setSelected(new Set());
    setLoading(false);
  }, [sessionId, enrollmentId, sourceActivityType]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!canEdit || !enrollmentId) return;
    setSaving(true);
    const payload: GoalCheckinPayload[] = goals.filter((g) => selected.has(g.id)).map((g) => ({
      goal_id: g.id,
      new_rating: ratings[g.id]?.rating ?? null,
      note: ratings[g.id]?.note?.trim() || null,
    }));
    const fingerprint = JSON.stringify(payload);
    const pending = pendingSubmission.current?.fingerprint === fingerprint ? pendingSubmission.current : {
      fingerprint,
      id: crypto.randomUUID(),
    };
    pendingSubmission.current = pending;
    const { error } = await supabase.rpc("record_goal_checkins", {
      p_enrollment_id: enrollmentId,
      p_source_activity_type: sourceActivityType,
      p_source_activity_id: sessionId,
      p_checkins: payload,
      p_submission_id: pending.id,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    pendingSubmission.current = null;
    toast.success(t("goalRatings.toast.saved"));
    load();
  };

  const addGoal: AddGoalFn = async (payload) => {
    if (!canCreateGoal || !enrollmentId) return false;
    const { error } = await supabase.from("coachee_goals").insert({ ...payload, enrollment_id: enrollmentId, coachee_id: coacheeId });
    if (error) { toast.error(error.message); return false; }
    await load();
    return true;
  };

  if (loading) {
    return (
      <Card className="flex items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </Card>
    );
  }

  if (!enrollmentId) {
    return (
      <Card className="p-5 text-sm text-destructive">
        {t("goalRatings.enrollmentRequired")}
      </Card>
    );
  }

  if (goals.length === 0) {
    return (
      <Card className="p-5 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <Target className="h-3.5 w-3.5 text-primary" />
          {t("goalRatings.title")}
        </div>
        {canCreateGoal && enrollmentId && <GoalDialog onAdd={addGoal} />}
        <p className="mt-2">
          {t("goalRatings.emptyPrefix")} <span className="font-semibold">{t("goalRatings.emptyLinkText")}</span> {t("goalRatings.emptySuffix")}
        </p>
      </Card>
    );
  }

  const locked = !canEdit;

  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <Target className="h-3.5 w-3.5 text-primary" />
            {t("goalRatings.title")}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {locked ? (
              sessionStatus !== "completed" ? (
                <span className="inline-flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5" />
                  {t("goalRatings.lockedNotCompleted")} <strong className="font-semibold">{t("goalRatings.lockedNotCompletedSuffix")}</strong>.
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5" />
                  {t("goalRatings.lockedReadOnly")}
                </span>
              )
            ) : (
              <>{t("goalRatings.unlockedHint")}</>
            )}
          </p>
        </div>
        {canEdit && (
          <Button onClick={save} disabled={saving || selected.size === 0} size="sm">
            {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
            {t("goalRatings.saveReflection")}
          </Button>
        )}
      </div>

      {canCreateGoal && enrollmentId && goals.length < 3 && <GoalDialog onAdd={addGoal} />}
      <div className="space-y-4">
        {goals.map((g) => {
          const r = ratings[g.id] ?? { rating: null, note: "" };
          return (
            <div
              key={g.id}
              className={cn(
                "rounded-lg border p-3",
                locked ? "bg-muted/20" : "bg-background"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm font-semibold">
                  {!locked && <input type="checkbox" aria-label={`Discussed: ${g.title}`} checked={selected.has(g.id)} onChange={(event) => setSelected((previous) => { const next = new Set(previous); if (event.target.checked) next.add(g.id); else next.delete(g.id); return next; })} />}
                  {g.title}
                </label>
                <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                  {r.rating ?? "—"}
                </span>
              </div>
              <Input
                className="mt-3"
                type="number"
                aria-label={`${g.title}: ${t("goalRatings.title")}`}
                min={0}
                max={100}
                step={1}
                value={r.rating ?? ""}
                disabled={locked || !selected.has(g.id)}
                onChange={(event) => {
                  const value = event.target.value === "" ? null : Number(event.target.value);
                  if (value !== null && (!Number.isInteger(value) || value < 0 || value > 100)) return;
                  setRatings((prev) => ({ ...prev, [g.id]: { ...prev[g.id], rating: value } }));
                }}
              />
              {locked && (
                <div className="mt-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Lock className="h-3 w-3" />
                  {t("goalRatings.noteLockedLabel")}
                </div>
              )}
              <Textarea
                className={cn("min-h-[60px] text-xs", locked ? "mt-1" : "mt-2")}
                placeholder={locked ? t("goalRatings.noteLockedEmptyPlaceholder") : t("goalRatings.notePlaceholder")}
                value={r.note}
                disabled={locked || !selected.has(g.id)}
                onChange={(e) =>
                  setRatings((prev) => ({
                    ...prev,
                    [g.id]: { ...prev[g.id], note: e.target.value },
                  }))
                }
              />
            </div>
          );
        })}
      </div>
    </Card>
  );
}
