import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowRight, Calendar, CheckCircle2, Clock } from "lucide-react";
import { deriveNextUpList, type NextUpItem, type NextUpKind } from "@/lib/nextUp";
import type { EnrollmentActionRow } from "@/hooks/dashboard/useEnrollmentActionsSummary";
import { formatProfileDate, type ProgrammeJourneyPoint, type ProgrammeLearningItem } from "@/lib/programmeProfile";
import { ProfileLoadError, ProfileSection, ProfileSkeleton } from "@/components/programme/primitives";

const ICON_BY_KIND: Record<NextUpKind, typeof AlertTriangle> = {
  overdue_requirement: AlertTriangle,
  overdue_action: AlertTriangle,
  current_requirement: Clock,
  upcoming_session: Calendar,
  upcoming_requirement: Calendar,
};

const ATTENTION_LIMIT = 5;

/** Where each item is actioned. A learning-item requirement carries no checkpoint date (see lib/nextUp). */
function pathFor(item: NextUpItem) {
  if (item.kind === "overdue_action") return "/coachee/journey#goals";
  if (item.kind === "upcoming_session") return "/sessions";
  if (item.kind === "overdue_requirement" || item.kind === "current_requirement") {
    return item.dueOn ? "/coachee/journey#programme-journey" : "/training";
  }
  return "/coachee/journey#programme-journey";
}

/**
 * The learner's "Needs your attention" — the same position as Sponsor's
 * Attention section, populated by the existing Next Up derivation
 * (lib/nextUp.ts over canonical journey, learning breakdown, overdue
 * enrollment_actions and the next booked session). Each item links to where
 * the learner can act on it; nothing is invented when nothing is due.
 */
export function LearnerAttention({
  journey,
  learningBreakdown,
  overdueActions,
  nextSessionAt,
  loading,
  error,
}: {
  journey: ProgrammeJourneyPoint[];
  learningBreakdown: ProgrammeLearningItem[];
  overdueActions: EnrollmentActionRow[];
  nextSessionAt: string | null;
  loading: boolean;
  error: string | null;
}) {
  const { t } = useTranslation("dashboard");
  const items = loading || error ? [] : deriveNextUpList({ journey, learningBreakdown, overdueActions, nextSessionAt }, ATTENTION_LIMIT);

  return (
    <ProfileSection className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-serif text-[17px] font-normal">{t("learnerProfile.attention.title")}</h2>
        {!loading && !error && (
          <span className="rounded-full bg-[#fbeade] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.1em] text-[#a8541c]">
            {t("coacheeDashboard.nextUp.itemsCount", { count: items.length })}
          </span>
        )}
      </div>
      {loading ? (
        <ProfileSkeleton className="h-16" />
      ) : error ? (
        <ProfileLoadError text={t("learnerProfile.errors.attention")} />
      ) : items.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-[11px] text-[#6a6560]">
          <CheckCircle2 className="h-3.5 w-3.5 text-[#17663f]" />
          {t("coacheeDashboard.nextUp.empty")}
        </p>
      ) : (
        <ul data-testid="learner-attention" className="mt-4 flex flex-col gap-2.5">
          {items.map((item, idx) => {
            const Icon = ICON_BY_KIND[item.kind];
            const overdue = item.kind === "overdue_requirement" || item.kind === "overdue_action";
            return (
              <li key={`${item.kind}-${item.label}-${idx}`}>
                <Link
                  to={pathFor(item)}
                  className={`flex items-center gap-3.5 rounded-[10px] border px-4 py-3.5 transition-colors hover:border-[#8bd3e3] ${
                    overdue ? "border-[#f0d5cc] bg-[#fdf6f2]" : "border-[#eee8de] bg-[#f6f3ee]"
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${overdue ? "text-[#a8341c]" : "text-[#2c8fa8]"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{item.label}</div>
                    <div className="mt-0.5 text-[10.5px] text-[#6a6560]">
                      {t(`coacheeDashboard.nextUp.kinds.${item.kind}`)}
                      {item.dueOn && ` · ${formatProfileDate(item.dueOn)}`}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-[#9a938a]" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </ProfileSection>
  );
}
