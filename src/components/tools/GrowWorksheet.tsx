import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, Save } from "lucide-react";
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
  onActionItemsChanged,
}: {
  sessionId: string;
  onActionItemsChanged?: () => void;
}) {
  const { user } = useAuth();
  const [values, setValues] = useState<GrowResponses>(EMPTY);
  const [rowId, setRowId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [commitment, setCommitment] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!user) return;
      setLoading(true);
      const { data } = await supabase
        .from("tool_sessions")
        .select("id, responses")
        .eq("session_id", sessionId)
        .eq("tool_type", "grow_worksheet")
        .eq("filled_by", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setRowId(data.id);
        const r = (data.responses ?? {}) as Partial<GrowResponses>;
        setValues({ ...EMPTY, ...r });
      }
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
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
            session_id: sessionId,
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
    const { data: current, error: readErr } = await supabase
      .from("sessions")
      .select("action_items")
      .eq("id", sessionId)
      .maybeSingle();
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
      .from("sessions")
      .update({ action_items: next as unknown as Json })
      .eq("id", sessionId);
    setAdding(false);
    if (error) {
      toast.error(error.message);
      return;
    }
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
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {FIELDS.map((f) => (
          <Card key={f.key} className="space-y-2 p-5">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-soft text-[11px] font-bold text-primary">
                {f.step}
              </span>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {f.title}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">{f.prompt}</p>
            <Textarea
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              rows={5}
              placeholder={f.prompt}
            />
            {f.key === "will_notes" && (
              <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                <p className="text-[11px] font-semibold">
                  Turn a commitment into an action item
                </p>
                <p className="text-[10px] text-muted-foreground">Becomes action items</p>
                <Input
                  value={commitment}
                  onChange={(e) => setCommitment(e.target.value)}
                  placeholder="I will..."
                  className="h-8 text-sm"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="h-8 w-auto text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
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
            )}
          </Card>
        ))}
      </div>
      <Button type="button" size="sm" onClick={save} disabled={saving}>
        {saving ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Save className="mr-1 h-3.5 w-3.5" />
        )}
        Save worksheet
      </Button>
    </div>
  );
}

export default GrowWorksheet;
