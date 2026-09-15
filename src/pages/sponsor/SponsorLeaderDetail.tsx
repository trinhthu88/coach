import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { useSponsorCohortData } from "@/hooks/sponsor/useSponsorCohortData";
import { SponsorLeaderProfile } from "./SponsorLeaderDrawer";

export default function SponsorLeaderDetail() {
  const { cohortId = "", enrollmentId = "" } = useParams<{ cohortId: string; enrollmentId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation("sponsor");
  const { roster, cohortLabel, loading } = useSponsorCohortData(cohortId);
  const leader = roster.find((row) => row.enrollment_id === enrollmentId);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!leader) {
    return (
      <div className="space-y-5">
        <Link to={`/sponsor/cohorts/${cohortId}`} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> {cohortLabel || t("cohortDetail.header.title")}
        </Link>
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <p className="font-display text-2xl">{t("leaderDrawer.notFound")}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t("leaderDrawer.notFoundDescription")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link to={`/sponsor/cohorts/${cohortId}`} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> {cohortLabel || t("cohortDetail.header.title")}
      </Link>
      <main className="overflow-hidden rounded-[28px] border border-[#e6dfd4] shadow-[0_18px_50px_-32px_rgba(8,28,38,.45)]">
        <SponsorLeaderProfile leader={leader} onBack={() => navigate(`/sponsor/cohorts/${cohortId}`)} />
      </main>
      <div className="flex items-start gap-2 rounded-xl bg-muted/40 px-4 py-3 text-[11px] text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        {t("cohorts.privacyNote")}
      </div>
    </div>
  );
}