import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Star, MapPin, Loader2, Sparkles } from "lucide-react";

interface CoachRow {
  id: string;
  title: string | null;
  specialties: string[] | null;
  hourly_rate: number | null;
  years_experience: number | null;
  country_based: string | null;
  is_featured: boolean;
  rating_avg: number;
  sessions_completed: number;
  profiles: {
    full_name: string;
    avatar_url: string | null;
    bio: string | null;
  } | null;
}

export default function Coaches() {
  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("coach_profiles")
        .select("id, title, specialties, hourly_rate, years_experience, country_based, is_featured, rating_avg, sessions_completed, profiles!inner(full_name, avatar_url, bio)")
        .eq("approval_status", "active")
        .order("is_featured", { ascending: false })
        .order("rating_avg", { ascending: false });

      if (!error && data) setCoaches(data as unknown as CoachRow[]);
      setLoading(false);
    })();
  }, []);

  const filtered = coaches.filter((c) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      c.profiles?.full_name.toLowerCase().includes(q) ||
      c.title?.toLowerCase().includes(q) ||
      c.specialties?.some((s) => s.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
          <Sparkles className="h-3 w-3" /> Curated network
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">Find your coach</h1>
        <p className="text-muted-foreground">
          Vetted, world-class coaches. Browse profiles and book your next session.
        </p>
        <div className="relative max-w-xl pt-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, specialty, or title…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-12 pl-11"
          />
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState query={query} />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((coach) => (
            <CoachCard key={coach.id} coach={coach} />
          ))}
        </div>
      )}
    </div>
  );
}

function CoachCard({ coach }: { coach: CoachRow }) {
  const initials = (coach.profiles?.full_name || "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Link to={`/coaches/${coach.id}`} className="group block">
      <Card className="relative h-full overflow-hidden p-6 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg">
        {coach.is_featured && (
          <div className="absolute right-4 top-4 rounded-full bg-gradient-primary px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-primary-foreground shadow-glow">
            Featured
          </div>
        )}

        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary-soft text-base font-bold text-primary">
            {coach.profiles?.avatar_url ? (
              <img src={coach.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-semibold tracking-tight">
              {coach.profiles?.full_name}
            </h3>
            <p className="truncate text-sm text-muted-foreground">{coach.title}</p>
            <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                <Star className="h-3.5 w-3.5 fill-warning text-warning" />
                {Number(coach.rating_avg).toFixed(1)}
              </span>
              {coach.country_based && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> {coach.country_based}
                </span>
              )}
            </div>
          </div>
        </div>

        <p className="mt-4 line-clamp-2 text-sm text-muted-foreground">
          {coach.profiles?.bio || "Profile available — open to learn more."}
        </p>

        {coach.specialties && coach.specialties.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {coach.specialties.slice(0, 3).map((s) => (
              <Badge key={s} variant="secondary" className="rounded-full font-medium">
                {s}
              </Badge>
            ))}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-sm">
          <span className="text-muted-foreground">
            {coach.years_experience ?? 0}+ yrs experience
          </span>
          {coach.hourly_rate != null && (
            <span className="font-semibold">
              ${coach.hourly_rate}
              <span className="text-xs font-normal text-muted-foreground">/hr</span>
            </span>
          )}
        </div>
      </Card>
    </Link>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <Card className="flex flex-col items-center gap-3 p-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
        <Search className="h-6 w-6" />
      </div>
      <h3 className="text-lg font-semibold">
        {query ? "No coaches match your search" : "No coaches available yet"}
      </h3>
      <p className="max-w-md text-sm text-muted-foreground">
        {query
          ? "Try a different keyword, or clear the search to see everyone."
          : "Once admins approve coach profiles, they'll appear here for booking."}
      </p>
    </Card>
  );
}
