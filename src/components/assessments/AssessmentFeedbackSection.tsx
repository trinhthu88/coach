import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ProfileLoadError, ProfileSection, ProfileSectionTitle } from "@/components/programme/primitives";
import { useLearnerAssessmentFeedback } from "@/hooks/assessments/useLearnerAssessmentFeedback";
import { AssessmentFeedbackCard } from "./AssessmentFeedbackCard";

/**
 * My Journey -> Feedback & results (#feedback-results, where the release
 * notification and email land). Only released, approved feedback, from
 * learner_assessment_feedback. A programme without assessments shows nothing.
 */
export function AssessmentFeedbackSection({ enrollmentId }: { enrollmentId: string | null | undefined }) {
  const { t } = useTranslation("assessments");
  const { feedback, loading, error } = useLearnerAssessmentFeedback(enrollmentId);
  const { hash } = useLocation();
  const ready = !loading && (error || feedback.length > 0);

  // The section loads after the page, so the page's own hash scroll has
  // already run when a notification link (#feedback-results) arrives.
  useEffect(() => {
    if (ready && hash === "#feedback-results") {
      document.getElementById("feedback-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [ready, hash]);

  if (!ready) return null;

  return (
    <ProfileSection id="feedback-results" className="scroll-mt-4">
      <div data-testid="assessment-feedback-section">
        <ProfileSectionTitle title={t("feedback.sectionTitle")} aside={t("feedback.sectionAside")} />
        <p className="mt-1.5 text-[11.5px] text-[#9a938a]">{t("feedback.sectionSubtitle")}</p>
        <div className="mt-4 space-y-2.5">
          {error ? (
            <ProfileLoadError text={t("feedback.loadError")} />
          ) : (
            feedback.map((item) => <AssessmentFeedbackCard key={item.submissionId} item={item} />)
          )}
        </div>
      </div>
    </ProfileSection>
  );
}
