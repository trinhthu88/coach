import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, Handshake } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/ui/page-header";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

interface MentorRow {
  mentor_user_id: string;
  bio: string | null;
  expertise_tags: string[] | null;
  full_name: string;
  avatar_url: string | null;
  atCapacity?: boolean;
}

export default function MentoringFindMentor() {
  const { user } = useAuth();
  const { t } = useTranslation("mentoring");
  const [mentors, setMentors] = useState<MentorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    // Single source of truth: get_my_mentors() (mentoring_get_my_mentors
    // migration) does the allowlist + is_active filtering server-side, so
    // this list can't drift from what can_book_mentoring_session() allows.
    const { data, error: err } = await supabase.rpc("get_my_mentors");
    if (err) {
      setError(getFriendlyErrorMessage(err, t));
      setLoading(false);
      return;
    }
    const rows = (data as MentorRow[]) || [];
    setMentors(rows);
    setLoading(false);

    // Small N (allowlists are curated), cheap to check each mentor's given-side
    // capacity so a full mentor shows as unavailable before the user picks them.
    const withCapacity = await Promise.all(
      rows.map(async (m) => {
        const { data: usageRows } = await supabase.rpc("check_mentoring_given_usage", {
          p_mentor_id: m.mentor_user_id,
        });
        const usage = (usageRows as { limit_count: number | null; used_count: number }[] | null)?.[0];
        const atCapacity = !!usage && usage.limit_count !== null && usage.used_count >= usage.limit_count;
        return { ...m, atCapacity };
      })
    );
    setMentors(withCapacity);
  }, [user, t]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        className="mb-0"
        eyebrow={t("findMentor.eyebrow")}
        title={t("findMentor.titleLead")}
        emphasis={t("findMentor.titleEmphasis")}
        subtitle={t("findMentor.subtitle")}
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
            {t("findMentor.retry")}
          </Button>
        </Card>
      ) : mentors.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-12 text-center text-sm text-muted-foreground">
          <Handshake className="h-6 w-6 text-muted-foreground/60" />
          {t("findMentor.empty")}
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {mentors.map((m) => (
            <div
              key={m.mentor_user_id}
              className={cn(
                "surface-card flex flex-col gap-3 p-5",
                m.atCapacity ? "opacity-60" : "hover-lift"
              )}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary/15 text-sm font-bold text-secondary-foreground">
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt={m.full_name} className="h-11 w-11 rounded-full object-cover" />
                  ) : (
                    m.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{m.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{t("findMentor.mentorLabel")}</p>
                </div>
              </div>

              {m.bio && <p className="line-clamp-3 text-sm text-muted-foreground">{m.bio}</p>}

              {m.expertise_tags && m.expertise_tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {m.expertise_tags.slice(0, 4).map((tag) => (
                    <Badge key={tag} variant="secondary" className="rounded-full text-[10px] uppercase tracking-wider">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="mt-auto pt-1">
                {m.atCapacity ? (
                  <Button size="sm" className="w-full" disabled>
                    {t("findMentor.mentorFull")}
                  </Button>
                ) : (
                  <Button asChild size="sm" className="w-full">
                    <Link to={`/mentoring/mentors/${m.mentor_user_id}/book`}>{t("findMentor.book")}</Link>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
