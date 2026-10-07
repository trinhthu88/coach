import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Star, Loader2, Info, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/ui/page-header";
import { useActiveEnrollment } from "@/hooks/useActiveEnrollment";
import { useLearnerModuleProgress } from "@/hooks/useLearnerModuleProgress";
import { useCohortCoachPool } from "@/hooks/coaching/useCanonicalCoaching";
import { supabase } from "@/integrations/supabase/client";
import { getFriendlyErrorMessage } from "@/lib/errors";

interface CoachCardDetails {
  id: string;
  title: string | null;
  specialties: string[] | null;
  rating_avg: number | null;
}

/**
 * A Coach's own Coach (as a learner) is their cohort's Coach pool
 * (enrollment_coaching_coach_pool), exactly as for every learner -- the
 * retired coach_as_coachee_allowlist plays no part. The pool decides who is
 * listed; coach_profiles only adds what the card shows.
 */
export default function CoachFindCoach() {
  const { t } = useTranslation("coaches");
  const { enrollmentId } = useActiveEnrollment();
  const pool = useCohortCoachPool(enrollmentId);
  const poolIds = (pool.data ?? []).map((c) => c.id);
  const details = useQuery({
    queryKey: ["coach-find-coach-details", poolIds],
    enabled: poolIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coach_profiles")
        .select("id, title, specialties, rating_avg")
        .in("id", poolIds);
      if (error) throw error;
      return (data ?? []) as CoachCardDetails[];
    },
  });
  const detailsById = new Map((details.data ?? []).map((d) => [d.id, d]));
  const coaches = (pool.data ?? []).map((c) => ({ ...c, ...detailsById.get(c.id) }));
  const loading = (!!enrollmentId && pool.isLoading) || (poolIds.length > 0 && details.isLoading);
  const failure = pool.error ?? details.error;
  const error = failure ? getFriendlyErrorMessage(failure, t) : null;
  const load = () => {
    void pool.refetch();
    void details.refetch();
  };

  // The canonical Coaching module row of the Coach's own enrollment
  // (learner_module_progress) -- never a module-config allowance.
  const coachingRow = useLearnerModuleProgress(enrollmentId).byModule.coaching;

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
          {coachingRow && (
            <>
              {" "}
              <span data-testid="coaching-requirement-progress">
                {t("findCoach.requirementProgress", {
                  done: coachingRow.completed_units + coachingRow.booked_units,
                  required: coachingRow.required_units,
                })}
              </span>
            </>
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
                  {(c.fullName || "?")
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{c.fullName}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.title || t("findCoach.defaultTitle")}</p>
                </div>
                {c.rating_avg != null && (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-foreground">
                    <Star className="h-3 w-3 fill-warning text-warning" />
                    {Number(c.rating_avg).toFixed(1)}
                  </span>
                )}
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
