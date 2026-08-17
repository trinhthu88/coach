import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Star, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/ui/page-header";
import { getFriendlyErrorMessage } from "@/lib/errors";

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
  const { t } = useTranslation("profile");
  const [coaches, setCoaches] = useState<PeerCoach[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("coach_profiles")
      .select("id, title, specialties, rating_avg, peer_coaching_opt_in, profiles!inner(full_name, avatar_url)")
      .eq("approval_status", "active")
      .eq("peer_coaching_opt_in", true)
      .neq("id", user.id);
    if (fetchError) {
      setError(getFriendlyErrorMessage(fetchError, t));
      setLoading(false);
      return;
    }
    setCoaches(
      (data || []).map((c) => ({
        id: c.id,
        title: c.title,
        specialties: c.specialties,
        rating_avg: c.rating_avg,
        full_name: c.profiles?.full_name,
        avatar_url: c.profiles?.avatar_url,
      }))
    );
    setLoading(false);
  }, [user, t]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
            className="mb-0"
            eyebrow={t("peerCoaching.header.eyebrow")}
            title={t("peerCoaching.header.titleLead")}
            emphasis={t("peerCoaching.header.titleEmphasis")}
            subtitle={t("peerCoaching.header.subtitle")}
          />

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : error ? (
        <Card className="flex flex-col items-center gap-3 border-destructive/30 bg-destructive/5 p-12 text-center text-sm">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <p className="text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" onClick={load}>
            {t("peerCoaching.retry")}
          </Button>
        </Card>
      ) : coaches.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          {t("peerCoaching.empty")}
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
                  <p className="truncate text-xs text-muted-foreground">{c.title || t("peerCoaching.defaultTitle")}</p>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-semibold">
                  <Star className="h-3 w-3 fill-warning text-warning" />
                  {Number(c.rating_avg).toFixed(1)}
                </span>
              </div>
              <div className="mt-4 flex gap-2">
                <Button asChild variant="outline" size="sm" className="flex-1">
                  <Link to={`/coaches/${c.id}`}>{t("peerCoaching.view")}</Link>
                </Button>
                <Button asChild size="sm" className="flex-1">
                  <Link to={`/coaches/${c.id}/book?mode=peer`}>{t("peerCoaching.bookPeer")}</Link>
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
