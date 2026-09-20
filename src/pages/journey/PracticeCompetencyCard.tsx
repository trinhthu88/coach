import { useTranslation } from "react-i18next";
import { ProfileSection, ProfileSectionTitle, ProfileSkeleton } from "@/components/programme/primitives";
import { usePracticeAnalytics } from "@/hooks/journey/usePracticeAnalytics";

/**
 * The approved prototype's "Practice & competency" card — a plain list of
 * ICF competencies with a score, nothing else. Scores come only from
 * peer_session_competency_feedback (see usePracticeAnalytics's doc comment:
 * triad_reflections has no per-competency breakdown, only a single overall
 * satisfaction_rating, so it can't honestly contribute here). Renders
 * nothing once loaded if there's no competency feedback yet, matching the
 * prototype's own `showAnalytics` gate — never a card with fabricated rows.
 */
export function PracticeCompetencyCard({
  enrollmentId,
  userId,
}: {
  enrollmentId: string | undefined;
  userId: string | undefined;
}) {
  const { t } = useTranslation("journey");
  const { t: tDash } = useTranslation("dashboard");
  const { loading, competencyScores } = usePracticeAnalytics(enrollmentId, userId);

  if (loading) {
    return <ProfileSkeleton className="h-40" />;
  }

  const observed = competencyScores.filter((c) => c.score != null);
  if (observed.length === 0) return null;

  return (
    <ProfileSection>
      <ProfileSectionTitle title={t("practiceCompetencyCard.title")} />
      <p className="mt-1.5 text-[11.5px] text-[#9a938a]">{t("practiceCompetencyCard.subtitle")}</p>
      <div className="mt-4 space-y-3">
        {observed.map((c) => (
          <div key={c.key} className="grid grid-cols-[minmax(0,1fr)_96px_32px] items-center gap-3">
            <div className="min-w-0">
              <p className="truncate text-[11.5px] font-semibold">{tDash(`practiceJourney.competencies.${c.key}`)}</p>
              <p className="truncate text-[10px] text-[#9a938a]">{t("practiceCompetencyCard.source")}</p>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#eee8de]">
              <div className="h-full rounded-full bg-[#2c8fa8]" style={{ width: `${Math.max(0, Math.min(100, c.score ?? 0))}%` }} />
            </div>
            <p className="text-right text-[11.5px] font-bold">{c.score}</p>
          </div>
        ))}
      </div>
    </ProfileSection>
  );
}
