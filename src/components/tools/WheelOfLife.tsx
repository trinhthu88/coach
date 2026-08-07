import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Loader2, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";
import { WheelRadar, domainsToSeries, WheelDomain } from "./WheelRadar";

const MIN_DOMAINS = 3;
const MAX_DOMAINS = 10;

const DEFAULT_LABELS = [
  "Career",
  "Finances",
  "Health",
  "Relationships",
  "Personal Growth",
  "Fun & Recreation",
  "Physical Environment",
  "Family",
];

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `d${Math.random().toString(36).slice(2, 10)}`;

const defaultDomains = (): WheelDomain[] =>
  DEFAULT_LABELS.map((label) => ({ id: newId(), label, rating: 5 }));

export function WheelOfLife({ sessionId }: { sessionId: string }) {
  const { user } = useAuth();
  const [domains, setDomains] = useState<WheelDomain[]>(defaultDomains);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rowId, setRowId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!user) return;
      setLoading(true);
      const { data } = await supabase
        .from("tool_sessions")
        .select("id, responses")
        .eq("session_id", sessionId)
        .eq("tool_type", "wheel_of_life")
        .eq("filled_by", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setRowId(data.id);
        const saved = (data.responses as { domains?: WheelDomain[] } | null)?.domains;
        if (Array.isArray(saved) && saved.length) {
          setDomains(
            saved.map((d) => ({
              id: d.id || newId(),
              label: d.label ?? "",
              rating: Number(d.rating) || 0,
            }))
          );
        }
      }
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, user]);

  const update = (id: string, patch: Partial<WheelDomain>) =>
    setDomains((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const remove = (id: string) =>
    setDomains((prev) =>
      prev.length <= MIN_DOMAINS ? prev : prev.filter((d) => d.id !== id)
    );

  const add = () =>
    setDomains((prev) =>
      prev.length >= MAX_DOMAINS
        ? prev
        : [...prev, { id: newId(), label: "New domain", rating: 5 }]
    );

  const save = async () => {
    if (!user) return;
    if (domains.some((d) => !d.label.trim())) {
      toast.error("Every domain needs a label");
      return;
    }
    setSaving(true);
    const payload = {
      session_id: sessionId,
      tool_type: "wheel_of_life",
      filled_by: user.id,
      responses: { domains },
    };
    const { data, error } = rowId
      ? await supabase
          .from("tool_sessions")
          .update({ responses: payload.responses })
          .eq("id", rowId)
          .select("id")
          .maybeSingle()
      : await supabase.from("tool_sessions").insert(payload).select("id").maybeSingle();
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data?.id) setRowId(data.id);
    toast.success("Wheel of Life saved");
  };

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-4">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Wheel of Life
        </p>
        {domains.length >= MIN_DOMAINS ? (
          <WheelRadar
            axes={domains.map((d) => d.label)}
            series={[domainsToSeries(domains, "now", "Current", true)]}
          />
        ) : (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Add at least {MIN_DOMAINS} domains to see the wheel.
          </p>
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Domains &amp; ratings
          </p>
          <span className="text-[11px] text-muted-foreground">
            {domains.length}/{MAX_DOMAINS}
          </span>
        </div>

        <ul className="space-y-4">
          {domains.map((d) => (
            <li key={d.id} className="space-y-2 rounded-md border bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <Input
                  value={d.label}
                  onChange={(e) => update(d.id, { label: e.target.value })}
                  className="h-8 flex-1 text-sm"
                  placeholder="Domain name"
                />
                <span className="w-7 shrink-0 text-right text-sm font-semibold tabular-nums text-primary">
                  {d.rating}
                </span>
                <button
                  type="button"
                  onClick={() => remove(d.id)}
                  disabled={domains.length <= MIN_DOMAINS}
                  className="text-muted-foreground hover:text-destructive disabled:opacity-30"
                  aria-label={`Remove ${d.label}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <Slider
                value={[d.rating]}
                min={0}
                max={10}
                step={1}
                onValueChange={([v]) => update(d.id, { rating: v })}
                aria-label={`${d.label} rating`}
              />
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={add}
            disabled={domains.length >= MAX_DOMAINS}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add domain
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1 h-3.5 w-3.5" />
            )}
            Save wheel
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default WheelOfLife;
