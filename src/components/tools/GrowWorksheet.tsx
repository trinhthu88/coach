import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Circle, Loader2, Plus, Save } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

interface GrowResponses {
  goal: string;
  reality: string;
  options: string;
  will_notes: string;
}

interface ActionItem {
  text: string;
  done: boolean;
  due_date: string | null;
  milestone_id: string | null;
}

const EMPTY: GrowResponses = { goal: "", reality: "", options: "", will_notes: "" };

const FIELDS: { key: keyof GrowResponses; step: number; title: string; prompt: string }[] = [
  { key: "goal", step: 1, title: "Goal", prompt: "What do you want to achieve?" },
  { key: "reality", step: 2, title: "Reality", prompt: "What's the current situation?" },
  { key: "options", step: 3, title: "Options", prompt: "What options are available?" },
  { key: "will_notes", step: 4, title: "Will", prompt: "What will you commit to?" },
];

export function GrowWorksheet({
  sessionId,
  peerSessionId,
  onActionItemsChanged,
}: {
  sessionId?: string;
  peerSessionId?: string;
  onActionItemsChanged?: () => void;
}) {
  const { user } = useAuth();
  const parentTable = sessionId ? "sessions" : "peer_sessions";
  const parentId = (sessionId ?? peerSessionId)!;
  const [values, setValues] = useState<GrowResponses>(EMPTY);
  const [rowId, setRowId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [commitment, setCommitment] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [adding, setAdding] = useState(false);
  const [items, setItems] = useState<ActionItem[]>([]);

  const loadItems = useCallback(async () => {
    const { data } = (await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(parentTable as any)
      .select("action_items")
      .eq("id", parentId)
      .maybeSingle()) as { data: { action_items: unknown } | null };
    setItems(
      Array.isArray(data?.action_items)
        ? (data!.action_items as unknown as ActionItem[])
        : []
    );
  }, [parentTable, parentId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!user) return;
      setLoading(true);
      let query = supabase
        .from("tool_sessions")
        .select("id, responses")
        .eq("tool_type", "grow_worksheet")
        .eq("filled_by", user.id);
      query = sessionId
        ? query.eq("session_id", sessionId)
        : query.eq("peer_session_id", peerSessionId!);
      const { data } = await query.maybeSingle();
      if (cancelled) return;
      if (data) {
        setRowId(data.id);
        const r = (data.responses ?? {}) as Partial<GrowResponses>;
        setValues({ ...EMPTY, ...r });
      }
      await loadItems();
      if (!cancelled) setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, peerSessionId, user, loadItems]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const parentFields = sessionId ? { session_id: sessionId } : { peer_session_id: peerSessionId };
    const { data, error } = rowId
      ? await supabase
          .from("tool_sessions")
          .update({ responses: values as unknown as Json })
          .eq("id", rowId)
          .select("id")
          .maybeSingle()
      : await supabase
          .from("tool_sessions")
          .insert({
            ...parentFields,
            tool_type: "grow_worksheet",
            filled_by: user.id,
            responses: values as unknown as Json,
          })
          .select("id")
          .maybeSingle();
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data?.id) setRowId(data.id);
    toast.success("GROW worksheet saved");
  };

  const addCommitment = async () => {
    const text = commitment.trim();
    if (!text) return;
    setAdding(true);
    const { data: current, error: readErr } = (await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(parentTable as any)
      .select("action_items")
      .eq("id", parentId)
      .maybeSingle()) as { data: { action_items: unknown } | null; error: { message: string } | null };
    if (readErr || !current) {
      setAdding(false);
      toast.error(readErr?.message || "Could not load action items");
      return;
    }
    const existing = Array.isArray(current.action_items)
      ? (current.action_items as unknown as ActionItem[])
      : [];
    const next: ActionItem[] = [
      ...existing,
      { text, done: false, due_date: dueDate || null, milestone_id: null },
    ];
    const { error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(parentTable as any)
      .update({ action_items: next as unknown as Json })
      .eq("id", parentId);
    setAdding(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setItems(next);
    setCommitment("");
    setDueDate("");
    toast.success("Commitment added to action items");
    onActionItemsChanged?.();
  };

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Steps */}
      <ol className="space-y-3">
        {FIELDS.map((f) => {
          const filled = values[f.key].trim().length > 0;
          return (
            <li
              key={f.key}
              className="rounded-[20px] border border-border bg-card p-4 sm:p-5"
            >
              <div className="flex items-start gap-3">
                <span
                  className={
                    filled
                      ? "grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
                      : "grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-bold text-primary"
                  }
                >
                  {f.step}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-xl font-light leading-tight text-foreground">
                    {f.title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{f.prompt}</p>
                  <Textarea
                    value={values[f.key]}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [f.key]: e.target.value }))
                    }
                    rows={4}
                    placeholder={f.prompt}
                    className="mt-3 rounded-[14px] bg-muted/30"
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <Button
        type="button"
        size="sm"
        className="rounded-full"
        onClick={save}
        disabled={saving}
      >
        {saving ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Save className="mr-1 h-3.5 w-3.5" />
        )}
        Save worksheet
      </Button>

      {/* Commitments → action items */}
      <div className="rounded-[20px] border border-border bg-card p-4 sm:p-6">
        <p className="eyebrow text-primary">Commitments</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Anything you add here becomes an agreed action on this session.
        </p>

        {items.length > 0 && (
          <ul className="mt-4 space-y-2">
            {items.map((it, i) => (
              <li
                key={`${it.text}-${i}`}
                className="flex items-start gap-3 rounded-[14px] bg-muted/40 px-4 py-3 text-sm"
              >
                {it.done ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span
                  className={
                    it.done ? "flex-1 text-muted-foreground line-through" : "flex-1"
                  }
                >
                  {it.text}
                </span>
                {it.due_date && (
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-accent">
                    {format(new Date(it.due_date), "d MMM")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 space-y-2 rounded-[16px] border border-dashed border-border p-4">
          <Input
            value={commitment}
            onChange={(e) => setCommitment(e.target.value)}
            placeholder="I will…"
            className="rounded-full"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCommitment();
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-9 w-auto rounded-full text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={addCommitment}
              disabled={adding || !commitment.trim()}
            >
              {adding ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="mr-1 h-3.5 w-3.5" />
              )}
              Add commitment
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GrowWorksheet;
