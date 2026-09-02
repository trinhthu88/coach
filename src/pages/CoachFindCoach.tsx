import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Star, Loader2, Info, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/ui/page-header";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";

interface CoachRow {
  id: string;
  title: string | null;
  specialties: string[] | null;
  rating_avg: number;
  profiles: { full_name: string; avatar_url: string | null } | null;
}

export default function CoachFindCoach() {
  const { user } = useAuth();
  const { t } = useTranslation("coaches");
  const { getConfig, loading: modulesLoading } = useProgrammeModules();
  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Coaching module's receive_limit — null/absent = unlimited. Comes from
  // the coach's active programme's programme_modules config, not the
  // deprecated coach_programme_enrollments/coach_programmes tables.
  const receiveLimit = (getConfig("coaching").receive_limit as number | null | undefined) ?? null;

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const { data: allowlist, error: allowlistError } = await supabase
      .from("coach_as_coachee_allowlist")
      .select("selectable_coach_id")
      .eq("coach_user_id", user.id);
    if (allowlistError) {
      setError(getFriendlyErrorMessage(allowlistError, t));
      setLoading(false);
      return;
    }
    const ids = (allowlist || []).map((r: { selectable_coach_id: string }) => r.selectable_coach_id);
    if (ids.length) {
      const { data, error: coachesError } = await supabase
        .from("coach_profiles")
        .select("id, title, specialties, rating_avg, profiles!inner(full_name, avatar_url)")
        .in("id", ids)
        .eq("approval_status", "active");
      if (coachesError) {
        setError(getFriendlyErrorMessage(coachesError, t));
        setLoading(false);
        return;
      }
      setCoaches((data as unknown as CoachRow[]) || []);
    } else {
      setCoaches([]);
    }
    setLoading(false);
  }, [user, t]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
            className="mb-0"
            eyebrow={t("findCoach.eyebrow")}
            title={t("findCoach.titleLead")}
            emphasis={t("findCoach.titleEmphasis")}
            subtitle={t("findCoach.subtitle")}
          />

      <Card className="flex items-start gap-2 border-warning/30 bg-warning/5 p-4 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div>
          {t("findCoach.notice")}
          {!modulesLoading && receiveLimit === null && (
            <> {t("findCoach.allowancePrefix")} <strong>{t("findCoach.unlimitedValue")}</strong> {t("findCoach.allowanceSuffix")}</>
          )}
          {!modulesLoading && typeof receiveLimit === "number" && (
            <> {t("findCoach.allowancePrefix")} <strong>{receiveLimit}</strong> {t("findCoach.allowanceSuffix")}</>
          )}
        </div>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : error ? (
        <Card className="flex flex-col items-center gap-3 border-destructive/30 bg-destructive/5 p-12 text-center text-sm">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <p className="text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" onClick={load}>
            {t("findCoach.retry")}
          </Button>
        </Card>
      ) : coaches.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          {t("findCoach.empty")}
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
                  <p className="truncate text-xs text-muted-foreground">{c.title || t("findCoach.defaultTitle")}</p>
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
                  <Link to={`/coaches/${c.id}`}>{t("findCoach.view")}</Link>
                </Button>
                <Button asChild size="sm" className="flex-1">
                  <Link to={`/coaches/${c.id}/book`}>{t("findCoach.book")}</Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
