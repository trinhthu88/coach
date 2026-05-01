import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save, Target, Lock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  sessionId: string;
  coacheeId: string;
  /** Whether the current viewer can edit (must be the coachee themselves AND session completed). */
  canEdit: boolean;
  sessionStatus: string;
}

interface GoalRow {
  id: string;
  title: string;
}

interface RatingRow {
  goal_id: string;
  rating: number;
  note: string | null;
}

export function SessionGoalRatings({ sessionId, coacheeId, canEdit, sessionStatus }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [ratings, setRatings] = useState<Record<string, { rating: number; note: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: gs }, { data: rs }] = await Promise.all([
      supabase
        .from("coachee_goals")
        .select("id, title")
        .eq("coachee_id", coacheeId)
        .eq("status", "active")
        .order("sort_order"),
      supabase
        .from("session_goal_ratings")
        .select("goal_id, rating, note")
        .eq("session_id", sessionId),
    ]);
    const goalList = (gs || []) as GoalRow[];
    setGoals(goalList);
    const map: Record<string, { rating: number; note: string }> = {};
    goalList.forEach((g) => {
      const existing = (rs as RatingRow[] | null)?.find((r) => r.goal_id === g.id);
      map[g.id] = {
        rating: existing?.rating ?? 50,
        note: existing?.note ?? "",
      };
    });
    setRatings(map);
    setLoading(false);
  }, [sessionId, coacheeId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!canEdit) return;
    setSaving(true);
    const rows = goals.map((g) => ({
      session_id: sessionId,
      coachee_id: coacheeId,
      goal_id: g.id,
      rating: ratings[g.id]?.rating ?? 50,
      note: ratings[g.id]?.note?.trim() || null,
    }));
    const { error } = await supabase
      .from("session_goal_ratings")
      .upsert(rows, { onConflict: "session_id,goal_id" });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Goal ratings saved — your wheel will update.");
    load();
  };

  if (loading) {
    return (
      <Card className="flex items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </Card>
    );
  }

  if (goals.length === 0) {
    return (
      <Card className="p-5 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <Target className="h-3.5 w-3.5 text-primary" />
          Goal reflection
        </div>
        <p className="mt-2">
          No active goals yet. Add goals in <span className="font-semibold">My journey</span> to score them after each session.
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
            Goal reflection
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {locked ? (
              sessionStatus !== "completed" ? (
                <span className="inline-flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5" />
                  Available once the session is marked <strong className="font-semibold">completed</strong>.
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5" />
                  Read-only — only the coachee can rate their own goals.
                </span>
              )
            ) : (
              <>Score 0–100 for each goal. Your wheel will plot this session as a new layer.</>
            )}
          </p>
        </div>
        {canEdit && (
          <Button onClick={save} disabled={saving} size="sm">
            {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
            Save reflection
          </Button>
        )}
      </div>

      <div className="space-y-4">
        {goals.map((g) => {
          const r = ratings[g.id] ?? { rating: 50, note: "" };
          return (
            <div
              key={g.id}
              className={cn(
                "rounded-lg border p-3",
                locked ? "bg-muted/20" : "bg-background"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">{g.title}</p>
                <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                  {r.rating}
                </span>
              </div>
              <Slider
                className="mt-3"
                min={0}
                max={100}
                step={1}
                value={[r.rating]}
                disabled={locked}
                onValueChange={(v) =>
                  setRatings((prev) => ({
                    ...prev,
                    [g.id]: { ...prev[g.id], rating: v[0] ?? 0 },
                  }))
                }
              />
              <Textarea
                className="mt-2 min-h-[60px] text-xs"
                placeholder={locked ? "" : "Optional reflection note for this goal…"}
                value={r.note}
                disabled={locked}
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
