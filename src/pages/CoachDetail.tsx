import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Award, Calendar, Loader2, MapPin, Star } from "lucide-react";

interface CoachDetail {
  id: string;
  title: string | null;
  specialties: string[] | null;
  hourly_rate: number | null;
  years_experience: number | null;
  nationality: string | null;
  country_based: string | null;
  diplomas_certifications: string[] | null;
  is_featured: boolean;
  rating_avg: number;
  sessions_completed: number;
  profiles: {
    full_name: string;
    avatar_url: string | null;
    bio: string | null;
    email: string;
  } | null;
}

export default function CoachDetail() {
  const { coachId } = useParams<{ coachId: string }>();
  const [coach, setCoach] = useState<CoachDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!coachId) return;
    (async () => {
      const { data } = await supabase
        .from("coach_profiles")
        .select("*, profiles!inner(full_name, avatar_url, bio, email)")
        .eq("id", coachId)
        .maybeSingle();
      setCoach(data as unknown as CoachDetail | null);
      setLoading(false);
    })();
  }, [coachId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!coach) {
    return (
      <Card className="p-12 text-center">
        <h2 className="text-xl font-semibold">Coach not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The coach you're looking for doesn't exist or isn't available.
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/coaches">Back to coaches</Link>
        </Button>
      </Card>
    );
  }

  const initials = (coach.profiles?.full_name || "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="space-y-6">
      <Link
        to="/coaches"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to coaches
      </Link>

      <Card className="overflow-hidden">
        <div className="relative h-32 bg-gradient-hero">
          {coach.is_featured && (
            <div className="absolute right-6 top-6 rounded-full bg-white/15 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary-foreground backdrop-blur-sm">
              Featured coach
            </div>
          )}
        </div>

        <div className="px-8 pb-8">
          <div className="-mt-12 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-5">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-3xl border-4 border-card bg-primary-soft text-2xl font-bold text-primary shadow-md">
                {coach.profiles?.avatar_url ? (
                  <img src={coach.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials
                )}
              </div>
              <div className="pb-1">
                <h1 className="text-3xl font-semibold tracking-tight">{coach.profiles?.full_name}</h1>
                <p className="text-muted-foreground">{coach.title}</p>
              </div>
            </div>
            <Button size="lg" className="shadow-glow">
              <Calendar className="mr-1 h-4 w-4" /> Book a session
            </Button>
          </div>

          <div className="mt-6 grid gap-4 border-t border-border pt-6 sm:grid-cols-4">
            <Stat
              label="Rating"
              value={
                <span className="inline-flex items-center gap-1">
                  <Star className="h-4 w-4 fill-warning text-warning" />
                  {Number(coach.rating_avg).toFixed(1)}
                </span>
              }
            />
            <Stat label="Sessions" value={coach.sessions_completed.toString()} />
            <Stat label="Experience" value={`${coach.years_experience ?? 0}+ yrs`} />
            <Stat
              label="Rate"
              value={coach.hourly_rate != null ? `$${coach.hourly_rate}/hr` : "—"}
            />
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="space-y-3 p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold">About</h2>
          <p className="leading-relaxed text-muted-foreground">
            {coach.profiles?.bio || "This coach hasn't written a bio yet."}
          </p>
          {coach.specialties && coach.specialties.length > 0 && (
            <div className="pt-2">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Specialties
              </p>
              <div className="flex flex-wrap gap-1.5">
                {coach.specialties.map((s) => (
                  <Badge key={s} variant="secondary" className="rounded-full">
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="space-y-4 p-6">
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Location
            </p>
            <p className="inline-flex items-center gap-1.5 text-sm">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              {coach.country_based || "—"}
              {coach.nationality && (
                <span className="text-muted-foreground">· {coach.nationality}</span>
              )}
            </p>
          </div>

          {coach.diplomas_certifications && coach.diplomas_certifications.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Certifications
              </p>
              <ul className="space-y-2">
                {coach.diplomas_certifications.map((d) => (
                  <li key={d} className="flex items-start gap-2 text-sm">
                    <Award className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
