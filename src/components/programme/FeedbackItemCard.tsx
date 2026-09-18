import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { LearnerFeedbackItem } from "@/hooks/dashboard/useLearnerFeedback";
import { feedbackAuthorLabel, feedbackSourcePath, feedbackText, feedbackTypeLabel } from "@/lib/feedbackLabels";
import { formatProfileDate } from "@/lib/programmeProfile";

/**
 * One learner-visible feedback item in full (My Journey). Same item shape and
 * labels the Dashboard's Feedback & development summary uses.
 */
export function FeedbackItemCard({ item }: { item: LearnerFeedbackItem }) {
  const { t } = useTranslation("dashboard");
  const text = feedbackText(item);
  const path = feedbackSourcePath(item);

  return (
    <article data-testid="feedback-item" className="rounded-xl border border-[#eee8de] bg-[#f6f3ee] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-[#e4f3f7] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.12em] text-[#2c8fa8]">
          {feedbackTypeLabel(item, t)}
        </span>
        <span className="text-[10px] text-[#9a938a]">{formatProfileDate(item.submittedAt)}</span>
      </div>
      <h3 className="mt-1.5 text-[12.5px] font-semibold text-[#062f3e]">{feedbackAuthorLabel(item, t)}</h3>
      {item.kind === "session_note" && item.topic && <p className="mt-0.5 text-[10.5px] text-[#6a6560]">{item.topic}</p>}

      {item.kind === "peer_competency" && item.scores.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.scores.map((s) => (
            <div key={s.key} className="rounded-[10px] border border-[#e6e0d6] bg-white px-2.5 py-1.5">
              <p className="font-serif text-sm text-[#2c8fa8]">{s.score}</p>
              <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[.12em] text-[#9a938a]">{t(`practiceJourney.competencies.${s.key}`)}</p>
            </div>
          ))}
        </div>
      )}
      {item.kind === "mentoring" && item.competencies.length > 0 && (
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          {item.competencies.map((c) => (
            <div key={c.key}>
              <dt className="text-[9px] font-bold uppercase tracking-[.12em] text-[#9a938a]">{t(`practiceJourney.competencies.${c.key}`)}</dt>
              <dd className="mt-0.5 text-[11.5px] text-[#062f3e]">{c.note}</dd>
            </div>
          ))}
        </dl>
      )}
      {text && <p className="mt-2.5 whitespace-pre-wrap font-serif text-[13.5px] leading-relaxed text-[#062f3e]">{text}</p>}
      {path && (
        <Link to={path} className="mt-2 inline-block text-[10.5px] font-semibold text-[#2c8fa8] hover:underline">
          {t("learnerProfile.feedback.openSource")}
        </Link>
      )}
    </article>
  );
}
