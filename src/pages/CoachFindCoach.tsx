import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Star, Loader2, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/ui/page-header";

interface CoachRow {
  id: string;
  title: string | null;
  specialties: string[] | null;
  rating_avg: number;
  profiles: { full_name: string; avatar_url: string | null } | null;
}

export default function CoachFindCoach() {
  const { user } = useAuth();
  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  // null = unlimited, 0 = "not loaded yet" (matches the previous coach_session_limits
  // fallback sentinel so the hint line below only renders once a real value is known).
  const [limit, setLimit] = useState<number | null>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: allowlist } = await supabase
        .from("coach_as_coachee_allowlist")
        .select("selectable_coach_id")
        .eq("coach_user_id", user.id);
      const ids = (allowlist || []).map((r: { selectable_coach_id: string }) => r.selectable_coach_id);
      if (ids.length) {
        const { data } = await supabase
          .from("coach_profiles")
          .select("id, title, specialties, rating_avg, profiles!inner(full_name, avatar_url)")
          .in("id", ids)
          .eq("approval_status", "active");
        setCoaches((data as unknown as CoachRow[]) || []);
      } else {
        setCoaches([]);
      }
      const { data: enrollment } = await supabase
        .from("coach_programme_enrollments")
        .select("coach_programme:coach_programmes(mentee_sessions_limit)")
        .eq("coach_id", user.id)
        .maybeSingle();
      setLimit(enrollment ? enrollment.coach_programme?.mentee_sessions_limit ?? null : 0);
      setLoading(false);
    })();
  }, [user]);

  return (
    <div className="space-y-6">
      <PageHeader
            className="mb-0"
            eyebrow="Curated network"
            title="Find a"
            emphasis="coach"
            subtitle="Coaches curated by admin for your continued growth."
          />

      <Card className="flex items-start gap-2 border-warning/30 bg-warning/5 p-4 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div>
          The coach list and your session allowance are set by the platform admin.
          {limit === null && <> Current allowance: <strong>unlimited</strong> sessions.</>}
          {typeof limit === "number" && limit > 0 && (
            <> Current allowance: <strong>{limit}</strong> sessions.</>
          )}
        </div>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : coaches.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          No coaches have been assigned to you yet. Reach out to your admin.
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {coaches.map((c) => (
            <div key={c.id} className="surface-card hover-lift flex flex-col gap-3 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-primary">
                  {(c.profiles?.full_name || "?")
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{c.profiles?.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.title || "Coach"}</p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-foreground">
                  <Star className="h-3 w-3 fill-warning text-warning" />
                  {Number(c.rating_avg).toFixed(1)}
                </span>
              </div>

              {c.specialties && c.specialties.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {c.specialties.slice(0, 3).map((s) => (
                    <Badge key={s} variant="secondary" className="rounded-full text-[10px] uppercase tracking-wider">
                      {s}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="mt-auto flex items-center gap-2 pt-1">
                <Button asChild size="sm" variant="outline" className="flex-1">
                  <Link to={`/coaches/${c.id}`}>View</Link>
                </Button>
                <Button asChild size="sm" className="flex-1">
                  <Link to={`/coaches/${c.id}/book`}>Book</Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
