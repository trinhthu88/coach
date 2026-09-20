import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AdminPageHeader } from "./_shared";
import { AdminTriadGroupManagement } from "./AdminTriadGroupManagement";
import { useAdminCohortTriadRequirement, type AdminTriadRequirement } from "@/hooks/triads/useAdminTriads";

/**
 * Admin -> Cohort -> Triads.
 *
 * EVERY REQUIRED TRIAD HAS ITS OWN GROUP ASSIGNMENT: below the requirement,
 * one card per Triad requirement (Triad 1, Triad 2, …, each with its own
 * deadline, groups, sessions and actions). The requirement (programme
 * required count + the cohort's Triad deadlines) is read on its own, so its
 * states never mix with the operational data:
 *   A  requirement loaded, required = 0 -> "0 required · No Triads configured"
 *   B  required > 0, groups/learners loaded -> full management
 *   C  required > 0, groups/learners failed -> required + schedule + operational error
 *   D  requirement failed -> requirement error (never "0 required")
 * Dates are read-only here (edited in the Cohort requirement schedule).
 */
export default function AdminCohortTriads() {
  const { t } = useTranslation("admin");
  const { cohortId } = useParams<{ cohortId: string }>();
  const requirement = useAdminCohortTriadRequirement(cohortId);
  const cohort = useQuery({
    queryKey: ["admin-cohort-name", cohortId],
    queryFn: async () => {
      const { data, error: cohortError } = await supabase.from("cohorts").select("id, name").eq("id", cohortId as string).maybeSingle();
      if (cohortError) throw cohortError;
      return data;
    },
    enabled: !!cohortId,
  });

  const requiring = (requirement.requirements ?? []).filter((r) => r.requiredUnits > 0);
  const primaryRequired = requiring[0]?.requiredUnits ?? 0;

  return (
    <div>
      <Link to="/admin/triads" className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> {t("triads.backToCohorts")}
      </Link>
      <AdminPageHeader
        eyebrow={cohort.data?.name ?? t("triads.eyebrow")}
        title={requirement.requirements ? t("triads.requiredTitle", { count: primaryRequired }) : t("triads.title")}
        subtitle={requiring.length > 1 ? requiring.map((r) => t("triads.requiredFor", { programme: r.programmeName, count: r.requiredUnits })).join(" · ") : undefined}
      />

      {requirement.loading ? (
        <div className="flex justify-center py-12" data-testid="admin-triads-loading">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : requirement.error || !requirement.requirements ? (
        // STATE D — the requirement itself failed: never show a number.
        <Card className="flex flex-col items-center gap-3 p-12 text-center text-sm" role="alert" data-testid="admin-triads-requirement-error">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <p className="text-destructive">{t("triads.requirementLoadError")}</p>
          <Button size="sm" variant="outline" onClick={() => requirement.refetch()}>{t("triads.retry")}</Button>
        </Card>
      ) : requiring.length === 0 ? (
        // STATE A — loaded, and the programme requires no Triads.
        <Card className="p-12 text-center text-sm text-muted-foreground" data-testid="admin-triads-none">{t("triads.noneConfigured")}</Card>
      ) : (
        // STATE B / C
        <div className="space-y-4">
          {requiring.map((r) => (
            <TriadScheduleWarning key={r.programmeId} requirement={r} showProgramme={requiring.length > 1} />
          ))}
          <AdminTriadGroupManagement
            cohortId={cohortId as string}
            programmeNames={Object.fromEntries(requiring.map((r) => [r.programmeId, r.programmeName]))}
          />
        </div>
      )}
    </div>
  );
}

/** Missing Triad deadlines: a Triad without a cohort date gets no card. */
function TriadScheduleWarning({ requirement, showProgramme }: { requirement: AdminTriadRequirement; showProgramme: boolean }) {
  const { t } = useTranslation("admin");
  const scheduled = requirement.schedule.filter((m) => m.milestone <= requirement.requiredUnits);
  if (scheduled.length >= requirement.requiredUnits) return null;
  return (
    <Card className="p-4 text-xs text-warning" role="status" data-testid="admin-triad-schedule-missing">
      {showProgramme ? `${requirement.programmeName}: ` : ""}
      {t("triads.scheduleMissing", { scheduled: scheduled.length, required: requirement.requiredUnits })}
    </Card>
  );
}
