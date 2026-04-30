import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Star, MapPin, Loader2, Sparkles, Heart, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFavorites } from "@/hooks/useFavorites";

interface CoachRow {
  id: string;
  title: string | null;
  specialties: string[] | null;
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

const SPECIALTY_FILTERS = [
  "All",
  "Leadership",
  "Productivity",
  "Mindset",
  "Communication",
  "Wellness",
] as const;

export default function Coaches() {
  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeSpec, setActiveSpec] = useState<string>("All");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("coach_profiles")
        .select(
          "id, title, specialties, years_experience, country_based, is_featured, rating_avg, sessions_completed, profiles!inner(full_name, avatar_url, bio)"
        )
        .eq("approval_status", "active")
        .order("is_featured", { ascending: false })
        .order("rating_avg", { ascending: false });
      if (!error && data) setCoaches(data as unknown as CoachRow[]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    return coaches.filter((c) => {
      const q = query.trim().toLowerCase();
      const matchQ =
        !q ||
        c.profiles?.full_name.toLowerCase().includes(q) ||
        c.title?.toLowerCase().includes(q) ||
        c.specialties?.some((s) => s.toLowerCase().includes(q));
      const matchSpec =
        activeSpec === "All" ||
        c.specialties?.some((s) => s.toLowerCase().includes(activeSpec.toLowerCase()));
      return matchQ && matchSpec;
    });
  }, [coaches, query, activeSpec]);

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
          <Sparkles className="h-3 w-3" /> Curated network
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">Discover coaches</h1>
        <p className="text-muted-foreground">
          Find your perfect guide to accelerate your professional growth.
        </p>
      </header>

      <div className="space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, specialty, or language…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-12 pl-11"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {SPECIALTY_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setActiveSpec(s)}
              className={cn(
                "rounded-full px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors",
                activeSpec === s
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-card text-muted-foreground border border-border hover:border-primary/40 hover:text-foreground"
              )}
            >
              {s === "All" ? "All Specialties" : s}
            </button>
          ))}
        </div>
      </div>

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
  const { isFavorite, toggle } = useFavorites();
  const fav = isFavorite(coach.id);
  const initials = (coach.profiles?.full_name || "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Card className="relative h-full overflow-hidden p-6 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg">
      {/* Top-right: rating chip + favorite */}
      <div className="absolute right-4 top-4 flex items-center gap-2">
        {coach.is_featured && (
          <span className="rounded-full bg-gradient-primary px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-primary-foreground shadow-glow">
            Featured
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-bold text-warning">
          <Star className="h-3 w-3 fill-warning" />
          {Number(coach.rating_avg).toFixed(1)}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            toggle(coach.id);
          }}
          aria-label={fav ? "Remove from favorites" : "Add to favorites"}
          className={cn(
            "rounded-full p-1.5 transition-colors",
            fav ? "text-destructive" : "text-muted-foreground hover:text-destructive"
          )}
        >
          <Heart className={cn("h-4 w-4", fav && "fill-destructive")} />
        </button>
      </div>

      <Link to={`/coaches/${coach.id}`} className="block">
        <div className="flex items-start gap-4 pr-24">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary-soft text-base font-bold text-primary">
            {coach.profiles?.avatar_url ? (
              <img src={coach.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
        </div>

        <div className="mt-4">
          <h3 className="text-lg font-semibold tracking-tight">{coach.profiles?.full_name}</h3>
          <p className="text-sm text-muted-foreground">{coach.title}</p>
        </div>

        <p className="mt-3 line-clamp-2 text-sm italic text-muted-foreground">
          {coach.profiles?.bio
            ? `"${coach.profiles.bio}"`
            : "Profile available — open to learn more."}
        </p>

        {coach.specialties && coach.specialties.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {coach.specialties.slice(0, 3).map((s) => (
              <Badge key={s} variant="secondary" className="rounded-full text-[10px] uppercase tracking-wider">
                {s}
              </Badge>
            ))}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-sm">
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {coach.years_experience ?? 0}+ years
          </span>
          <Button variant="link" size="sm" className="h-auto p-0 text-primary">
            View profile
          </Button>
        </div>
      </Link>
    </Card>
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
          ? "Try a different keyword or specialty."
          : "Once admins approve coach profiles, they'll appear here for booking."}
      </p>
    </Card>
  );
}
