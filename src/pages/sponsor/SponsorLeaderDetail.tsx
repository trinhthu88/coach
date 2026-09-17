import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useSponsorLeaderData } from "@/hooks/sponsor/useSponsorLeaderData";
import { SponsorLeaderProfile } from "./SponsorLeaderDrawer";

export default function SponsorLeaderDetail() {
  const { cohortId = "", enrollmentId = "" } = useParams<{ cohortId: string; enrollmentId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation("sponsor");
  const { leader, journey, experience, loading } = useSponsorLeaderData(enrollmentId);

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
          <ArrowLeft className="h-3.5 w-3.5" /> {t("cohortDetail.header.title")}
        </Link>
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <p className="font-display text-2xl">{t("leaderDrawer.notFound")}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t("leaderDrawer.notFoundDescription")}</p>
        </div>
      </div>
    );
  }

  return (
    <SponsorLeaderProfile
      leader={leader}
      journey={journey}
      experience={experience}
      onBack={() => navigate(`/sponsor/cohorts/${cohortId}`)}
    />
  );
}