import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { formatProfileDate } from "@/lib/programmeProfile";
import { useMarkFeedbackViewed, type LearnerAssessmentFeedback } from "@/hooks/assessments/useLearnerAssessmentFeedback";
import { AssessmentFileLink } from "./AssessmentFileLink";

/**
 * One released piece of assessor feedback, exactly as
 * learner_assessment_feedback returns it. Showing it records the learner's
 * first view (learner_mark_feedback_viewed), which Admin sees in the queue.
 */
export function AssessmentFeedbackCard({ item, className }: { item: LearnerAssessmentFeedback; className?: string }) {
  const { t } = useTranslation("assessments");
  const markViewed = useMarkFeedbackViewed();
  const marked = useRef(false);

  useEffect(() => {
    if (item.viewedAt || marked.current) return;
    marked.current = true;
    markViewed.mutate(item.submissionId);
  }, [item.viewedAt, item.submissionId, markViewed]);

  const title =
    item.kind === "triad"
      ? t("feedback.triadTitle", { n: item.requirementOrdinal })
      : item.attemptNo > 1
        ? t("feedback.finalAttemptTitle", { n: item.attemptNo })
        : t("feedback.finalTitle");

  return (
    <article
      data-testid="assessment-feedback-card"
      data-kind={item.kind}
      className={cn("rounded-xl border border-[#e6e0d6] bg-white p-4", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-serif text-[16px] font-normal text-[#062f3e]">{title}</h3>
        {!item.viewedAt && (
          <span className="rounded-full bg-[#e4f1f5] px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[.08em] text-[#226d80]">
            {t("feedback.new")}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[11px] text-[#9a938a]">
        {t("feedback.byAssessor", { name: item.assessorName, date: formatProfileDate(item.releasedAt) })}
      </p>

      {item.kind === "final_assessment" && (item.outcome || item.quizTotal != null) && (
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[12px]">
          {item.outcome && (
            <div>
              <dt className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[#9a938a]">{t("feedback.result")}</dt>
              <dd
                data-testid="assessment-feedback-outcome"
                className={cn(
                  "mt-0.5 font-semibold",
                  item.outcome === "pass" ? "text-[#17663f]" : item.outcome === "not_pass" ? "text-[#a8541c]" : "text-[#4a463f]",
                )}
              >
                {t(`outcome.${item.outcome}`)}
              </dd>
            </div>
          )}
          {item.quizTotal != null && (
            <div>
              <dt className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[#9a938a]">{t("feedback.quiz")}</dt>
              <dd className="mt-0.5 text-[#4a463f]" data-testid="assessment-feedback-quiz">
                {t("feedback.quizScore", {
                  correct: item.quizCorrect ?? 0,
                  total: item.quizTotal,
                  pct: Math.round(item.quizScorePct ?? 0),
                })}
              </dd>
            </div>
          )}
        </dl>
      )}

      {item.feedbackText && (
        <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-[#4a463f]" data-testid="assessment-feedback-text">
          {item.feedbackText}
        </p>
      )}
      {item.files.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {item.files.map((f) => (
            <li key={f.storagePath}>
              <AssessmentFileLink path={f.storagePath} label={t("feedback.attachment")} />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
