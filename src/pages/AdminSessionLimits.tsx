import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Save, Settings2, Users } from "lucide-react";

interface CoachLimit {
  id: string;
  coach_user_id: string | null;
  monthly_limit: number;
  peer_monthly_limit: number;
}

interface CoachRow {
  id: string;
  full_name: string;
  email: string;
  coachingLimit: number;
  peerLimit: number;
  rowId: string | null; // existing coach_session_limits id, if any
}

export default function AdminSessionLimits() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [defaultRow, setDefaultRow] = useState<CoachLimit | null>(null);
  const [defaultCoaching, setDefaultCoaching] = useState(4);
  const [defaultPeer, setDefaultPeer] = useState(4);
  const [coaches, setCoaches] = useState<CoachRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: limits }, { data: coachProfs }] = await Promise.all([
      supabase.from("coach_session_limits").select("*"),
      supabase
        .from("coach_profiles")
        .select("id")
        .eq("approval_status", "active"),
    ]);

    const ids = (coachProfs || []).map((c: any) => c.id);
    let profilesById: Record<string, any> = {};
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ids);
      profilesById = Object.fromEntries((profs || []).map((p: any) => [p.id, p]));
    }

    const def = (limits || []).find((l: any) => l.coach_user_id === null) || null;
    setDefaultRow(def as any);
    setDefaultCoaching(def?.monthly_limit ?? 4);
    setDefaultPeer(def?.peer_monthly_limit ?? 4);

    const limitByCoach = new Map<string, CoachLimit>();
    (limits || [])
      .filter((l: any) => l.coach_user_id)
      .forEach((l: any) => limitByCoach.set(l.coach_user_id, l));

    const rows: CoachRow[] = ids.map((id) => {
      const lim = limitByCoach.get(id);
      const p = profilesById[id];
      return {
        id,
        full_name: p?.full_name || "—",
        email: p?.email || "—",
        coachingLimit: lim?.monthly_limit ?? def?.monthly_limit ?? 4,
        peerLimit: lim?.peer_monthly_limit ?? def?.peer_monthly_limit ?? 4,
        rowId: lim?.id ?? null,
      };
    });
    rows.sort((a, b) => a.full_name.localeCompare(b.full_name));
    setCoaches(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveDefault = async () => {
    setSaving("default");
    try {
      if (defaultRow) {
        const { error } = await supabase
          .from("coach_session_limits")
          .update({
            monthly_limit: defaultCoaching,
            peer_monthly_limit: defaultPeer,
          })
          .eq("id", defaultRow.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("coach_session_limits").insert({
          coach_user_id: null,
          monthly_limit: defaultCoaching,
          peer_monthly_limit: defaultPeer,
        });
        if (error) throw error;
      }
      toast.success("Default limits saved");
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(null);
    }
  };

  const saveCoach = async (row: CoachRow) => {
    setSaving(row.id);
    try {
      if (row.rowId) {
        const { error } = await supabase
          .from("coach_session_limits")
          .update({
            monthly_limit: row.coachingLimit,
            peer_monthly_limit: row.peerLimit,
          })
          .eq("id", row.rowId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("coach_session_limits").insert({
          coach_user_id: row.id,
          monthly_limit: row.coachingLimit,
          peer_monthly_limit: row.peerLimit,
        });
        if (error) throw error;
      }
      toast.success(`Saved limits for ${row.full_name}`);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(null);
    }
  };

  const updateCoachField = (id: string, patch: Partial<CoachRow>) => {
    setCoaches((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Admin</p>
        <h1 className="font-display text-3xl tracking-tight text-secondary">
          Session <em className="not-italic text-primary">limits</em>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Set how many coaching and peer-coaching sessions a coach can receive each month.
        </p>
      </div>

      {/* DEFAULT */}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-primary" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Platform default (applies when no per-coach override exists)
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <div>
            <p className="mb-1 text-xs font-medium">Coaching sessions / month</p>
            <Input
              type="number"
              min={0}
              value={defaultCoaching}
              onChange={(e) => setDefaultCoaching(Number(e.target.value))}
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium">Peer sessions / month</p>
            <Input
              type="number"
              min={0}
              value={defaultPeer}
              onChange={(e) => setDefaultPeer(Number(e.target.value))}
            />
          </div>
          <Button onClick={saveDefault} disabled={saving === "default"}>
            {saving === "default" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save default
          </Button>
        </div>
      </Card>

      {/* PER COACH */}
      <Card className="overflow-hidden">
        <div className="border-b bg-muted/30 px-4 py-2.5">
          <p className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> Per-coach overrides ({coaches.length})
          </p>
        </div>
        {coaches.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">No active coaches.</p>
        ) : (
          <ul className="divide-y">
            {coaches.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold">{c.full_name}</p>
                    {c.rowId ? (
                      <Badge variant="outline" className="border-primary/40 text-primary">
                        Override
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Uses default</Badge>
                    )}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">{c.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Coaching
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={c.coachingLimit}
                    onChange={(e) =>
                      updateCoachField(c.id, { coachingLimit: Number(e.target.value) })
                    }
                    className="h-9 w-20"
                  />
                  <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Peer
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={c.peerLimit}
                    onChange={(e) => updateCoachField(c.id, { peerLimit: Number(e.target.value) })}
                    className="h-9 w-20"
                  />
                  <Button
                    size="sm"
                    onClick={() => saveCoach(c)}
                    disabled={saving === c.id}
                  >
                    {saving === c.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    Save
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
