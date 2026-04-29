import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";

interface LimitRow {
  id: string;
  coachee_id: string | null;
  monthly_limit: number;
  notes: string | null;
}

interface CoacheeRow {
  id: string;
  full_name: string;
  email: string;
  limit: number;
}

export default function AdminLimits() {
  const [globalLimit, setGlobalLimit] = useState<LimitRow | null>(null);
  const [globalValue, setGlobalValue] = useState(4);
  const [coachees, setCoachees] = useState<CoacheeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: limits } = await supabase.from("session_limits").select("*");
    const g = (limits || []).find((l) => l.coachee_id === null) as LimitRow | undefined;
    if (g) {
      setGlobalLimit(g);
      setGlobalValue(g.monthly_limit);
    }
    const overrides = new Map(
      (limits || []).filter((l) => l.coachee_id).map((l) => [l.coachee_id!, l.monthly_limit])
    );

    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "coachee");
    const ids = (roles || []).map((r) => r.user_id);
    if (ids.length === 0) {
      setCoachees([]);
      setLoading(false);
      return;
    }
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids);

    setCoachees(
      (profs || []).map((p) => ({
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        limit: overrides.get(p.id) ?? (g?.monthly_limit ?? 4),
      }))
    );
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const saveGlobal = async () => {
    if (!globalLimit) return;
    setSaving(true);
    const { error } = await supabase
      .from("session_limits")
      .update({ monthly_limit: globalValue })
      .eq("id", globalLimit.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Global limit updated");
    load();
  };

  const saveOverride = async (coachee: CoacheeRow, value: number) => {
    const { error } = await supabase
      .from("session_limits")
      .upsert({ coachee_id: coachee.id, monthly_limit: value }, { onConflict: "coachee_id" });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Updated limit for ${coachee.full_name}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Session limits</h1>
          <p className="text-sm text-muted-foreground">
            Set the monthly session cap each coachee can book.
          </p>
        </div>
      </div>

      <Card className="space-y-3 p-6">
        <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Global default (sessions per month)
        </Label>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            min={0}
            max={50}
            value={globalValue}
            onChange={(e) => setGlobalValue(Number(e.target.value))}
            className="w-32"
          />
          <Button onClick={saveGlobal} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Save default
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-4 text-lg font-semibold">Per-coachee overrides</h2>
        {coachees.length === 0 ? (
          <p className="text-sm text-muted-foreground">No coachees yet.</p>
        ) : (
          <div className="space-y-2">
            {coachees.map((c) => (
              <CoacheeLimitRow key={c.id} coachee={c} onSave={saveOverride} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function CoacheeLimitRow({
  coachee,
  onSave,
}: {
  coachee: CoacheeRow;
  onSave: (c: CoacheeRow, v: number) => void;
}) {
  const [value, setValue] = useState(coachee.limit);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{coachee.full_name}</p>
        <p className="truncate text-xs text-muted-foreground">{coachee.email}</p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          max={50}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          className="w-24"
        />
        <Button size="sm" variant="outline" onClick={() => onSave(coachee, value)}>
          Save
        </Button>
      </div>
    </div>
  );
}
