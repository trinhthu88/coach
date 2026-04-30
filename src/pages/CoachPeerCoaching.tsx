import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessagesSquare, Loader2, Star } from "lucide-react";
import { Link } from "react-router-dom";

interface PeerCoach {
  id: string;
  title: string | null;
  specialties: string[] | null;
  rating_avg: number;
  full_name: string;
  avatar_url: string | null;
}

export default function CoachPeerCoaching() {
  const { user } = useAuth();
  const [coaches, setCoaches] = useState<PeerCoach[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("coach_profiles")
        .select("id, title, specialties, rating_avg, peer_coaching_opt_in, profiles!inner(full_name, avatar_url)")
        .eq("approval_status", "active")
        .eq("peer_coaching_opt_in", true)
        .neq("id", user.id);
      setCoaches(
        ((data as any[]) || []).map((c) => ({
          id: c.id,
          title: c.title,
          specialties: c.specialties,
          rating_avg: c.rating_avg,
          full_name: c.profiles?.full_name,
          avatar_url: c.profiles?.avatar_url,
        }))
      );
      setLoading(false);
    })();
  }, [user]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10 text-success">
          <MessagesSquare className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-3xl tracking-tight text-secondary">
            Peer <em className="not-italic text-primary">coaching</em>
          </h1>
          <p className="text-sm text-muted-foreground">
            Coaches who have opted in to peer coaching. Book a session to be coached by a peer.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : coaches.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          No peer coaches available right now. Check back soon.
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {coaches.map((c) => (
            <Card key={c.id} className="p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-sm font-bold text-success">
                  {(c.full_name || "?")
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{c.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.title || "Peer coach"}</p>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-semibold">
                  <Star className="h-3 w-3 fill-warning text-warning" />
                  {Number(c.rating_avg).toFixed(1)}
                </span>
              </div>
              <div className="mt-4 flex gap-2">
                <Button asChild variant="outline" size="sm" className="flex-1">
                  <Link to={`/coaches/${c.id}`}>View</Link>
                </Button>
                <Button asChild size="sm" className="flex-1">
                  <Link to={`/coaches/${c.id}/book?mode=peer`}>Book peer</Link>
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
