import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calendar, Check, Loader2, MapPin, Star } from "lucide-react";
import { HeroPanel } from "@/components/ui/page-header";

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
  const { role } = useAuth();
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
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to coaches
      </Link>

      <HeroPanel>
        <div className="flex flex-col gap-7 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-6">
            <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-[22px] bg-primary/20 font-display text-[1.9rem] text-primary-foreground/95">
              {coach.profiles?.avatar_url ? (
                <img src={coach.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <div className="min-w-0">
              <p className="eyebrow mb-2 text-primary">
                {coach.is_featured ? "Featured coach" : coach.country_based || "Coach"}
              </p>
              <h1 className="font-display text-[clamp(2.1rem,4.2vw,3rem)] leading-[1.05]">
                {coach.profiles?.full_name}
              </h1>
              <p className="mt-1.5 text-sm text-secondary-foreground/70">{coach.title}</p>
            </div>
          </div>
          {role === "coachee" && (
            <Button asChild size="lg" className="bg-accent text-accent-foreground shadow-glow hover:bg-accent/90">
              <Link to={`/coaches/${coach.id}/book`}>
                <Calendar className="mr-1 h-4 w-4" /> Book a session
              </Link>
            </Button>
          )}
        </div>

        <div className="mt-9 grid gap-6 border-t border-primary-foreground/15 pt-7 sm:grid-cols-4">
          <Stat
            label="Rating"
            value={
              <span className="inline-flex items-center gap-2">
                <Star className="h-5 w-5 fill-warning text-warning" />
                {Number(coach.rating_avg).toFixed(1)}
              </span>
            }
          />
          <Stat label="Sessions" value={coach.sessions_completed.toString()} />
          <Stat label="Experience" value={`${coach.years_experience ?? 0} yrs`} />
          <Stat label="Rate" value={coach.hourly_rate != null ? `$${coach.hourly_rate}` : "—"} />
        </div>
      </HeroPanel>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="surface-card p-8 lg:col-span-2">
          <h2 className="font-display text-[1.6rem] leading-tight">Approach</h2>
          <p className="mt-4 leading-relaxed text-muted-foreground">
            {coach.profiles?.bio || "This coach hasn't written a bio yet."}
          </p>
          {coach.specialties && coach.specialties.length > 0 && (
            <div className="mt-7">
              <p className="eyebrow mb-3">Specialties</p>
              <div className="flex flex-wrap gap-2">
                {coach.specialties.map((s) => (
                  <span
                    key={s}
                    className="rounded-full bg-primary-soft px-4 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] text-primary"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="surface-card space-y-6 p-7">
          {coach.diplomas_certifications && coach.diplomas_certifications.length > 0 && (
            <div>
              <p className="eyebrow mb-4">Credentials</p>
              <ul className="space-y-3.5">
                {coach.diplomas_certifications.map((d) => (
                  <li key={d} className="flex items-start gap-3 text-sm">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    <span className="leading-snug">{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="border-t border-border pt-6">
            <p className="eyebrow mb-2.5">Based in</p>
            <p className="inline-flex items-center gap-1.5 text-sm">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              {coach.country_based || "—"}
              {coach.nationality && (
                <span className="text-muted-foreground">· {coach.nationality}</span>
              )}
            </p>
          </div>

          {role === "coachee" && (
            <Button asChild size="lg" variant="secondary" className="w-full">
              <Link to={`/coaches/${coach.id}/book`}>Choose a time</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-primary">{label}</p>
      <p className="font-display mt-2 text-[2.2rem] leading-none tracking-tight">{value}</p>
    </div>
  );
}
