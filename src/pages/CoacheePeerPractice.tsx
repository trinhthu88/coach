import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/ui/page-header";
import { getFriendlyErrorMessage } from "@/lib/errors";

interface PeerCoachee {
  id: string;
  full_name: string;
  avatar_url: string | null;
}

/**
 * Coachee equivalent of CoachPeerCoaching.tsx — same structure, sourcing
 * candidates from profiles.peer_coaching_opt_in (coachee-role rows) instead
 * of coach_profiles.peer_coaching_opt_in. A separate, open opt-in pool from
 * the coach one (RULES.md §3) — not merged.
 */
export default function CoacheePeerPractice() {
  const { user } = useAuth();
  const { t } = useTranslation("profile");
  const [coachees, setCoachees] = useState<PeerCoachee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .eq("peer_coaching_opt_in", true)
      .neq("id", user.id);
    if (fetchError) {
      setError(getFriendlyErrorMessage(fetchError, t));
      setLoading(false);
      return;
    }
    setCoachees((data || []) as PeerCoachee[]);
    setLoading(false);
  }, [user, t]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        className="mb-0"
        eyebrow={t("coacheePeerPractice.header.eyebrow")}
        title={t("coacheePeerPractice.header.titleLead")}
        emphasis={t("coacheePeerPractice.header.titleEmphasis")}
        subtitle={t("coacheePeerPractice.header.subtitle")}
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
            {t("coacheePeerPractice.retry")}
          </Button>
        </Card>
      ) : coachees.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">{t("coacheePeerPractice.empty")}</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {coachees.map((c) => (
            <Card key={c.id} className="p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-sm font-bold text-success">
                  {(c.full_name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{c.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{t("coacheePeerPractice.defaultTitle")}</p>
                </div>
              </div>
              <div className="mt-4">
                <Button asChild size="sm" className="w-full">
                  <Link to={`/coachee/peer-practice/${c.id}/book`}>{t("coacheePeerPractice.book")}</Link>
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
