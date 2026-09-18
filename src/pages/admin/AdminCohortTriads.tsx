import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { AdminPageHeader } from "./_shared";
import { AdminTriadRequirementCard } from "./AdminTriadRequirementCard";
import { useAdminCohortTriads } from "@/hooks/triads/useAdminTriads";

/**
 * Admin -> Cohort -> Triads. The number of rounds is the programme's Triad
 * requirement; each round's due date is the cohort requirement schedule.
 * Neither is entered here — edit them in the programme / cohort schedule.
 */
export default function AdminCohortTriads() {
  const { t } = useTranslation("admin");
  const { cohortId } = useParams<{ cohortId: string }>();
  const { requirements, loading, error } = useAdminCohortTriads(cohortId);
  const cohort = useQuery({
    queryKey: ["admin-cohort-name", cohortId],
    queryFn: async () => {
      const { data, error: cohortError } = await supabase.from("cohorts").select("id, name").eq("id", cohortId as string).maybeSingle();
      if (cohortError) throw cohortError;
      return data;
    },
    enabled: !!cohortId,
  });
  const required = requirements[0]?.requiredUnits ?? 0;

  return (
    <div>
      <Link to="/admin/triads" className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> {t("triads.backToCohorts")}
      </Link>
      <AdminPageHeader
        eyebrow={cohort.data?.name ?? t("triads.eyebrow")}
        title={t("triads.title")}
        subtitle={loading ? undefined : t("triads.requiredSubtitle", { count: required })}
      />

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : error ? (
        <Card className="p-12 text-center text-sm text-destructive">{t("triads.loadError")}</Card>
      ) : requirements.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">{t("triads.noRequirements")}</Card>
      ) : (
        <div className="space-y-4">
          {requirements.map((requirement) => (
            <AdminTriadRequirementCard key={requirement.requirementId} cohortId={cohortId as string} requirement={requirement} />
          ))}
        </div>
      )}
    </div>
  );
}
