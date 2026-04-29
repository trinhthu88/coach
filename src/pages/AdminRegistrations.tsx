import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Check, Loader2, X } from "lucide-react";

interface PendingCoach {
  id: string;
  title: string | null;
  approval_status: string;
  created_at: string;
  years_experience: number | null;
  country_based: string | null;
  specialties: string[] | null;
  profile: { full_name: string; email: string; bio: string | null } | null;
}

export default function AdminRegistrations() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<PendingCoach[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: coaches, error } = await supabase
      .from("coach_profiles")
      .select("*")
      .eq("approval_status", "pending_approval")
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Failed to load", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const ids = (coaches ?? []).map((c) => c.id);
    let profilesById: Record<string, any> = {};
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, email, bio")
        .in("id", ids);
      profilesById = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));
    }

    setItems(
      (coaches ?? []).map((c: any) => ({
        ...c,
        profile: profilesById[c.id] ?? null,
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (id: string, decision: "active" | "rejected") => {
    setBusyId(id);
    try {
      const { error: cErr } = await supabase
        .from("coach_profiles")
        .update({ approval_status: decision })
        .eq("id", id);
      if (cErr) throw cErr;
      const { error: pErr } = await supabase
        .from("profiles")
        .update({ status: decision })
        .eq("id", id);
      if (pErr) throw pErr;

      toast({
        title: decision === "active" ? "Coach approved" : "Coach rejected",
      });
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err: any) {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
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
        <h1 className="text-3xl font-semibold tracking-tight">Coach registrations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review applications and approve coaches into the public directory.
        </p>
      </div>

      {items.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          No pending coach registrations.
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((c) => (
            <Card key={c.id} className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold">
                      {c.profile?.full_name ?? "Unknown"}
                    </h3>
                    <Badge variant="secondary">Pending</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{c.profile?.email}</p>
                  {c.title && <p className="text-sm font-medium">{c.title}</p>}
                  <p className="text-sm text-muted-foreground">
                    {c.years_experience ?? 0} yrs · {c.country_based ?? "—"}
                  </p>
                  {c.specialties && c.specialties.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {c.specialties.map((s) => (
                        <Badge key={s} variant="outline" className="text-[10px]">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {c.profile?.bio && (
                    <p className="max-w-2xl pt-2 text-sm text-muted-foreground">
                      {c.profile.bio}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === c.id}
                    onClick={() => decide(c.id, "rejected")}
                  >
                    <X className="h-4 w-4" /> Reject
                  </Button>
                  <Button
                    size="sm"
                    disabled={busyId === c.id}
                    onClick={() => decide(c.id, "active")}
                  >
                    <Check className="h-4 w-4" /> Approve
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
