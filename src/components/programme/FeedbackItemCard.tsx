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
    // Design (My Journey → Feedback): kind · person · context, rating chips, quote.
    <article data-testid="feedback-item" className="rounded-[13px] border border-[#efeae1] bg-white p-[15px]">
      <div className="text-[8.5px] font-extrabold uppercase tracking-[.14em] text-[#2c8fa8]">{feedbackTypeLabel(item, t)}</div>
      <h3 className="mt-[5px] font-serif text-[15px] font-normal text-[#062f3e]">{feedbackAuthorLabel(item, t)}</h3>
      <div className="mt-[3px] text-[10px] text-[#9a9287]">
        {[item.kind === "session_note" ? item.topic : null, formatProfileDate(item.submittedAt)].filter(Boolean).join(" · ")}
      </div>

      {item.kind === "peer_competency" && item.scores.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2.5">
          {item.scores.map((s) => (
            <div key={s.key} className="rounded-[10px] border border-[#efeae1] bg-[#fbf8f2] px-[11px] py-2">
              <p className="font-serif text-[16px] text-[#2c8fa8]">{s.score}</p>
              <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[.08em] text-[#7d7468]">{t(`practiceJourney.competencies.${s.key}`)}</p>
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
      {text && <p className="mt-3 whitespace-pre-wrap font-serif text-[13.5px] leading-[1.55] text-[#3f3a33]">“{text}”</p>}
      {path && (
        <Link to={path} className="mt-2 inline-block text-[10.5px] font-semibold text-[#2c8fa8] hover:underline">
          {t("learnerProfile.feedback.openSource")}
        </Link>
      )}
    </article>
  );
}
