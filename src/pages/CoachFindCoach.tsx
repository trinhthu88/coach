import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Star, Loader2, Info } from "lucide-react";
import { Link } from "react-router-dom";

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
  const [limit, setLimit] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: allowlist } = await supabase
        .from("coach_as_coachee_allowlist")
        .select("selectable_coach_id")
        .eq("coach_user_id", user.id);
      const ids = (allowlist || []).map((r: any) => r.selectable_coach_id);
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
      const { data: lim } = await supabase
        .from("coach_session_limits")
        .select("monthly_limit")
        .eq("coach_user_id", user.id)
        .maybeSingle();
      setLimit(lim?.monthly_limit ?? 0);
      setLoading(false);
    })();
  }, [user]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <Search className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-3xl tracking-tight text-secondary">
            Find a <em className="not-italic text-primary">coach</em>
          </h1>
          <p className="text-sm text-muted-foreground">
            Coaches curated by admin for your continued growth.
          </p>
        </div>
      </div>

      <Card className="flex items-start gap-2 border-warning/30 bg-warning/5 p-4 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div>
          The coach list and your session allowance are set by the platform admin.
          {limit > 0 && <> Current allowance: <strong>{limit}</strong> sessions.</>}
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
        <div className="space-y-2">
          {coaches.map((c) => (
            <Card key={c.id} className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-primary">
                {(c.profiles?.full_name || "?")
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{c.profiles?.full_name}</p>
                <p className="truncate text-xs text-muted-foreground">{c.title || "Coach"}</p>
                {c.specialties && c.specialties.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {c.specialties.slice(0, 3).map((s) => (
                      <Badge key={s} variant="secondary" className="rounded-full text-[10px]">
                        {s}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-semibold">
                <Star className="h-3 w-3 fill-warning text-warning" />
                {Number(c.rating_avg).toFixed(1)}
              </span>
              <Button asChild size="sm" variant="outline">
                <Link to={`/coaches/${c.id}`}>View</Link>
              </Button>
              <Button asChild size="sm">
                <Link to={`/coaches/${c.id}/book`}>Book</Link>
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
