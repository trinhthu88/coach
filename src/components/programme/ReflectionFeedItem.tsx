import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Lock, Trash2 } from "lucide-react";
import type { LearnerReflection } from "@/hooks/journey/useLearnerReflectionFeed";
import { sessionDetailPathFor } from "@/lib/sessionPaths";
import { formatProfileDate } from "@/lib/programmeProfile";
import { cn } from "@/lib/utils";

const TRIAD_PARTS = ["learned_as_coach", "will_use_as_coach", "learned_as_coachee", "will_use_as_coachee", "learned_as_observer", "will_use_as_observer"] as const;

/** Where the learner can open the original record behind a reflection. */
function sourcePath(item: LearnerReflection): string | null {
  if (item.linkedSessionTable && item.linkedSessionId) return sessionDetailPathFor(item.linkedSessionTable, item.linkedSessionId);
  if (item.sourceType === "goal_checkin" && item.linkedGoalId) return `/coachee/journey#goal-${item.linkedGoalId}`;
  if (item.sourceType === "training_reflection" || item.sourceType === "quiz_reflection" || item.sourceType === "daily_prompt_response") return "/training";
  return null;
}

/**
 * One entry of the canonical learner reflection feed (learner_reflection_feed)
 * — the same component for My Journey → Reflections (full) and the Dashboard's
 * Feedback & development (compact). The text shown is the original record's
 * text; this only labels where it came from.
 */
export function ReflectionFeedItem({
  item,
  compact = false,
  onDelete,
}: {
  item: LearnerReflection;
  compact?: boolean;
  onDelete?: (item: LearnerReflection) => void;
}) {
  const { t } = useTranslation("dashboard");
  const path = sourcePath(item);
  const answers = Array.isArray(item.details.answers) ? (item.details.answers as { question?: string; answer?: string }[]) : [];
  const triadParts = TRIAD_PARTS.filter((key) => typeof item.details[key] === "string");
  const structured = !compact && (answers.length > 0 || triadParts.length > 0);

  return (
    <article data-testid="reflection-item" data-source={item.sourceType} className="rounded-xl border border-[#eee8de] bg-[#f6f3ee] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-[#e4f3f7] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.12em] text-[#2c8fa8]">
          {t(`learnerProfile.reflections.sources.${item.sourceType}`)}
        </span>
        <span className="flex items-center gap-2 text-[10px] text-[#9a938a]">
          {item.isPrivate && (
            <span className="inline-flex items-center gap-1">
              <Lock className="h-3 w-3" /> {t("learnerProfile.reflections.onlyYou")}
            </span>
          )}
          {formatProfileDate(item.occurredAt)}
        </span>
      </div>

      {item.title && <p className="mt-1.5 text-[12px] font-semibold text-[#062f3e]">{item.title}</p>}

      {item.sourceType === "goal_checkin" && item.rating != null && (
        <p className="mt-1 text-[11px] text-[#6a6560]">
          {item.previousRating != null
            ? t("learnerProfile.reflections.ratingChange", { from: item.previousRating, to: item.rating })
            : t("learnerProfile.reflections.ratingNow", { to: item.rating })}
        </p>
      )}
      {(item.sourceType === "coaching_session_rating" || item.sourceType === "peer_session_rating" || item.sourceType === "triad_reflection") &&
        item.rating != null && <p className="mt-1 text-[11px] text-[#6a6560]">{t("learnerProfile.reflections.outOfFive", { value: item.rating })}</p>}
      {typeof item.details.mood === "string" && <p className="mt-1 text-[11px] text-[#6a6560]">{t("learnerProfile.reflections.mood", { mood: item.details.mood })}</p>}

      {structured ? (
        <dl className="mt-2.5 space-y-2">
          {answers.map((a, idx) => (
            <div key={idx}>
              <dt className="text-[9.5px] font-bold uppercase tracking-[.12em] text-[#9a938a]">{a.question}</dt>
              <dd className="mt-0.5 whitespace-pre-wrap font-serif text-[13.5px] leading-relaxed text-[#062f3e]">{a.answer}</dd>
            </div>
          ))}
          {triadParts.map((key) => (
            <div key={key}>
              <dt className="text-[9.5px] font-bold uppercase tracking-[.12em] text-[#9a938a]">{t(`learnerProfile.reflections.triad.${key}`)}</dt>
              <dd className="mt-0.5 whitespace-pre-wrap font-serif text-[13.5px] leading-relaxed text-[#062f3e]">{item.details[key] as string}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className={cn("mt-2 whitespace-pre-wrap font-serif text-[13.5px] leading-relaxed text-[#062f3e]", compact && "line-clamp-2 text-[12.5px] text-[#6a6560]")}>
          {compact ? `“${item.body}”` : item.body}
        </p>
      )}

      {(path || onDelete) && (
        <div className="mt-2 flex items-center justify-between gap-2">
          {path ? (
            <Link to={path} className="text-[10.5px] font-semibold text-[#2c8fa8] hover:underline">
              {t(`learnerProfile.reflections.open.${item.sourceType === "goal_checkin" ? "goal" : item.linkedSessionId ? "session" : "training"}`)}
            </Link>
          ) : (
            <span />
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(item)}
              aria-label={t("learnerProfile.reflections.delete")}
              className="text-[#9a938a] hover:text-[#a8341c]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </article>
  );
}
