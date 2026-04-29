import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  Loader2,
  Search,
  Star,
  StarOff,
  Pause,
  Play,
  Eye,
  AlertCircle,
  Check,
} from "lucide-react";
import { format } from "date-fns";

interface CoachRow {
  id: string;
  title: string | null;
  approval_status: string;
  is_featured: boolean;
  rating_avg: number;
  sessions_completed: number;
  years_experience: number | null;
  country_based: string | null;
  nationality: string | null;
  specialties: string[] | null;
  diplomas_certifications: string[] | null;
  calendly_url: string | null;
  last_approved_at: string | null;
  last_profile_update_at: string;
  created_at: string;
  profile: { full_name: string; email: string; status: string; bio: string | null } | null;
}

export default function AdminCoaches() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CoachRow[]>([]);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<CoachRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: coaches } = await supabase
      .from("coach_profiles")
      .select("*")
      .order("created_at", { ascending: false });

    const ids = (coaches ?? []).map((c) => c.id);
    let profilesById: Record<string, any> = {};
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, email, status, bio")
        .in("id", ids);
      profilesById = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));
    }
    setRows(
      (coaches ?? []).map((c: any) => ({ ...c, profile: profilesById[c.id] ?? null }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = async (
    id: string,
    patch: Partial<CoachRow>,
    profilePatch?: { status?: string }
  ) => {
    setBusyId(id);
    try {
      const { error } = await supabase
        .from("coach_profiles")
        .update(patch as any)
        .eq("id", id);
      if (error) throw error;
      if (profilePatch) {
        await supabase.from("profiles").update(profilePatch as any).eq("id", id);
      }
      toast({ title: "Updated" });
      await load();
    } catch (err: any) {
      toast({
        title: "Update failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const acknowledgeChanges = async (id: string) => {
    await update(id, { last_approved_at: new Date().toISOString() } as any);
  };

  const filtered = rows.filter(
    (r) =>
      (r.profile?.full_name ?? "").toLowerCase().includes(query.toLowerCase()) ||
      (r.profile?.email ?? "").toLowerCase().includes(query.toLowerCase())
  );

  const hasUnreviewedChanges = (c: CoachRow) =>
    c.approval_status === "active" &&
    c.last_approved_at &&
    new Date(c.last_profile_update_at) > new Date(c.last_approved_at);

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
        <h1 className="text-3xl font-semibold tracking-tight">Manage coaches</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review profiles, feature, suspend, or reactivate coaches.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          No coaches found.
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => {
            const isActive = c.approval_status === "active";
            const isSuspended = c.approval_status === "suspended";
            const changed = hasUnreviewedChanges(c);
            return (
              <Card key={c.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{c.profile?.full_name ?? "Unknown"}</h3>
                    <Badge
                      variant={isActive ? "default" : isSuspended ? "destructive" : "secondary"}
                      className="capitalize"
                    >
                      {c.approval_status.replace("_", " ")}
                    </Badge>
                    {c.is_featured && (
                      <Badge variant="outline" className="border-primary/40 text-primary">
                        Featured
                      </Badge>
                    )}
                    {changed && (
                      <Badge
                        variant="outline"
                        className="border-warning/50 text-warning gap-1"
                      >
                        <AlertCircle className="h-3 w-3" />
                        Edited since approval
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {c.profile?.email} · {c.title ?? "No title"} · {c.sessions_completed}{" "}
                    sessions · ★ {Number(c.rating_avg).toFixed(1)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Registered {format(new Date(c.created_at), "PP")} · Updated{" "}
                    {format(new Date(c.last_profile_update_at), "PP")}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setViewing(c)}>
                    <Eye className="h-4 w-4" /> View
                  </Button>
                  {changed && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === c.id}
                      onClick={() => acknowledgeChanges(c.id)}
                    >
                      <Check className="h-4 w-4" /> Mark reviewed
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === c.id}
                    onClick={() => update(c.id, { is_featured: !c.is_featured } as any)}
                  >
                    {c.is_featured ? (
                      <StarOff className="h-4 w-4" />
                    ) : (
                      <Star className="h-4 w-4" />
                    )}
                    {c.is_featured ? "Unfeature" : "Feature"}
                  </Button>
                  {isActive ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === c.id}
                      onClick={() =>
                        update(
                          c.id,
                          { approval_status: "suspended" } as any,
                          { status: "suspended" }
                        )
                      }
                    >
                      <Pause className="h-4 w-4" /> Suspend
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={busyId === c.id}
                      onClick={() =>
                        update(
                          c.id,
                          {
                            approval_status: "active",
                            last_approved_at: new Date().toISOString(),
                          } as any,
                          { status: "active" }
                        )
                      }
                    >
                      <Play className="h-4 w-4" /> Activate
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewing?.profile?.full_name}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <Detail label="Email" value={viewing.profile?.email ?? "—"} />
                <Detail label="Title" value={viewing.title ?? "—"} />
                <Detail
                  label="Experience"
                  value={`${viewing.years_experience ?? 0} years`}
                />
                <Detail label="Country" value={viewing.country_based ?? "—"} />
                <Detail label="Nationality" value={viewing.nationality ?? "—"} />
                <Detail
                  label="Sessions completed"
                  value={String(viewing.sessions_completed)}
                />
                <Detail label="Rating" value={`★ ${Number(viewing.rating_avg).toFixed(1)}`} />
                <Detail
                  label="Calendly"
                  value={viewing.calendly_url ?? "Not set"}
                />
                <Detail
                  label="Registered"
                  value={format(new Date(viewing.created_at), "PP")}
                />
                <Detail
                  label="Last update"
                  value={format(new Date(viewing.last_profile_update_at), "PPp")}
                />
              </div>

              {viewing.specialties && viewing.specialties.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Specialties
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {viewing.specialties.map((s) => (
                      <Badge key={s} variant="outline">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {viewing.diplomas_certifications &&
                viewing.diplomas_certifications.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Certifications
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {viewing.diplomas_certifications.map((s) => (
                        <Badge key={s} variant="secondary">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

              {viewing.profile?.bio && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Bio
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{viewing.profile.bio}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-words">{value}</p>
    </div>
  );
}
