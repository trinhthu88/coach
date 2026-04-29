import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Check, Loader2, X, Eye, Calendar } from "lucide-react";
import { format } from "date-fns";

interface BaseProfile {
  id: string;
  full_name: string;
  email: string;
  bio: string | null;
  status: string;
  created_at: string;
  last_profile_update_at: string;
}

interface PendingCoach extends BaseProfile {
  title: string | null;
  approval_status: string;
  years_experience: number | null;
  country_based: string | null;
  nationality: string | null;
  specialties: string[] | null;
  diplomas_certifications: string[] | null;
  sessions_completed: number;
  rating_avg: number;
  calendly_url: string | null;
}

export default function AdminRegistrations() {
  const [loading, setLoading] = useState(true);
  const [coaches, setCoaches] = useState<PendingCoach[]>([]);
  const [coachees, setCoachees] = useState<BaseProfile[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<PendingCoach | BaseProfile | null>(null);
  const [viewKind, setViewKind] = useState<"coach" | "coachee">("coach");

  const load = useCallback(async () => {
    setLoading(true);

    // Pending coaches with their profile + coach_profile data
    const { data: cps } = await supabase
      .from("coach_profiles")
      .select("*")
      .eq("approval_status", "pending_approval")
      .order("created_at", { ascending: false });

    const coachIds = (cps ?? []).map((c) => c.id);
    let coachProfilesById: Record<string, any> = {};
    if (coachIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("*")
        .in("id", coachIds);
      coachProfilesById = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));
    }
    setCoaches(
      (cps ?? []).map((c: any) => ({
        ...coachProfilesById[c.id],
        ...c,
      }))
    );

    // Pending coachees: profiles status pending_approval AND role coachee
    const { data: pendingProfiles } = await supabase
      .from("profiles")
      .select("*")
      .eq("status", "pending_approval")
      .order("created_at", { ascending: false });

    const pendingIds = (pendingProfiles ?? []).map((p) => p.id);
    let rolesByUser: Record<string, string> = {};
    if (pendingIds.length) {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", pendingIds);
      rolesByUser = Object.fromEntries((roles ?? []).map((r) => [r.user_id, r.role]));
    }
    setCoachees(
      (pendingProfiles ?? []).filter((p) => rolesByUser[p.id] === "coachee") as BaseProfile[]
    );

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const decideCoach = async (id: string, decision: "active" | "rejected") => {
    setBusyId(id);
    try {
      const patch: any = { approval_status: decision };
      if (decision === "active") patch.last_approved_at = new Date().toISOString();
      const { error: cErr } = await supabase
        .from("coach_profiles")
        .update(patch)
        .eq("id", id);
      if (cErr) throw cErr;
      await supabase.from("profiles").update({ status: decision }).eq("id", id);

      toast({ title: decision === "active" ? "Coach approved" : "Coach rejected" });
      setCoaches((prev) => prev.filter((i) => i.id !== id));
      setViewing(null);
    } catch (err: any) {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const decideCoachee = async (id: string, decision: "active" | "rejected") => {
    setBusyId(id);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ status: decision })
        .eq("id", id);
      if (error) throw error;
      toast({ title: decision === "active" ? "Coachee approved" : "Coachee rejected" });
      setCoachees((prev) => prev.filter((i) => i.id !== id));
      setViewing(null);
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
        <h1 className="text-3xl font-semibold tracking-tight">Registrations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review coach and coachee applications.
        </p>
      </div>

      <Tabs defaultValue="coaches">
        <TabsList>
          <TabsTrigger value="coaches">Coaches ({coaches.length})</TabsTrigger>
          <TabsTrigger value="coachees">Coachees ({coachees.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="coaches" className="space-y-4 pt-4">
          {coaches.length === 0 ? (
            <Card className="p-12 text-center text-sm text-muted-foreground">
              No pending coach registrations.
            </Card>
          ) : (
            coaches.map((c) => (
              <RegistrationCard
                key={c.id}
                title={c.full_name}
                email={c.email}
                subtitle={c.title ?? "Coach"}
                createdAt={c.created_at}
                updatedAt={c.last_profile_update_at}
                meta={`${c.years_experience ?? 0} yrs · ${c.country_based ?? "—"}`}
                busy={busyId === c.id}
                onView={() => {
                  setViewKind("coach");
                  setViewing(c);
                }}
                onApprove={() => decideCoach(c.id, "active")}
                onReject={() => decideCoach(c.id, "rejected")}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="coachees" className="space-y-4 pt-4">
          {coachees.length === 0 ? (
            <Card className="p-12 text-center text-sm text-muted-foreground">
              No pending coachee registrations.
            </Card>
          ) : (
            coachees.map((c) => (
              <RegistrationCard
                key={c.id}
                title={c.full_name}
                email={c.email}
                subtitle="Coachee"
                createdAt={c.created_at}
                updatedAt={c.last_profile_update_at}
                meta={c.bio ? c.bio.slice(0, 80) + (c.bio.length > 80 ? "…" : "") : "No bio yet"}
                busy={busyId === c.id}
                onView={() => {
                  setViewKind("coachee");
                  setViewing(c);
                }}
                onApprove={() => decideCoachee(c.id, "active")}
                onReject={() => decideCoachee(c.id, "rejected")}
              />
            ))
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewing?.full_name}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Email" value={viewing.email} />
                <Field label="Status" value={viewing.status} />
                <Field
                  label="Registered"
                  value={format(new Date(viewing.created_at), "PP")}
                />
                <Field
                  label="Last update"
                  value={format(new Date(viewing.last_profile_update_at), "PPp")}
                />
              </div>

              {viewKind === "coach" && "title" in viewing && (
                <>
                  <Field label="Title" value={viewing.title ?? "—"} />
                  <div className="grid grid-cols-3 gap-4">
                    <Field label="Experience" value={`${viewing.years_experience ?? 0} yrs`} />
                    <Field label="Country" value={viewing.country_based ?? "—"} />
                    <Field label="Nationality" value={viewing.nationality ?? "—"} />
                  </div>
                  <Field
                    label="Sessions completed"
                    value={String(viewing.sessions_completed)}
                  />
                  {viewing.specialties && viewing.specialties.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Specialties
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {viewing.specialties.map((s: string) => (
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
                          {viewing.diplomas_certifications.map((s: string) => (
                            <Badge key={s} variant="secondary">
                              {s}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                </>
              )}

              {viewing.bio && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Bio
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{viewing.bio}</p>
                </div>
              )}

              <div className="flex justify-end gap-2 border-t pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyId === viewing.id}
                  onClick={() =>
                    viewKind === "coach"
                      ? decideCoach(viewing.id, "rejected")
                      : decideCoachee(viewing.id, "rejected")
                  }
                >
                  <X className="h-4 w-4" /> Reject
                </Button>
                <Button
                  size="sm"
                  disabled={busyId === viewing.id}
                  onClick={() =>
                    viewKind === "coach"
                      ? decideCoach(viewing.id, "active")
                      : decideCoachee(viewing.id, "active")
                  }
                >
                  <Check className="h-4 w-4" /> Approve
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 capitalize">{value}</p>
    </div>
  );
}

function RegistrationCard({
  title,
  email,
  subtitle,
  createdAt,
  updatedAt,
  meta,
  busy,
  onView,
  onApprove,
  onReject,
}: {
  title: string;
  email: string;
  subtitle: string;
  createdAt: string;
  updatedAt: string;
  meta: string;
  busy: boolean;
  onView: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{title}</h3>
            <Badge variant="secondary">Pending</Badge>
          </div>
          <p className="text-xs text-muted-foreground">{email}</p>
          <p className="text-sm">{subtitle}</p>
          <p className="text-xs text-muted-foreground">{meta}</p>
          <p className="flex items-center gap-1 pt-1 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            Registered {format(new Date(createdAt), "PP")} · Updated{" "}
            {format(new Date(updatedAt), "PP")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onView}>
            <Eye className="h-4 w-4" /> View
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={onReject}>
            <X className="h-4 w-4" /> Reject
          </Button>
          <Button size="sm" disabled={busy} onClick={onApprove}>
            <Check className="h-4 w-4" /> Approve
          </Button>
        </div>
      </div>
    </Card>
  );
}
