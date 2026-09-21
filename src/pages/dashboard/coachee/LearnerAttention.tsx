import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowRight, Calendar, CheckCircle2, Clock } from "lucide-react";
import { deriveAttentionList, overdueUnitCount, type AttentionItem } from "@/lib/nextUp";
import type { EnrollmentActionRow } from "@/hooks/dashboard/useEnrollmentActionsSummary";
import type { LearnerOverdueItem } from "@/hooks/useLearnerCanonicalProgress";
import { formatProfileDate, type ProgrammeJourneyPoint } from "@/lib/programmeProfile";
import { LEARNER_MODULE_PATH, useModuleScopeLabel } from "@/components/programme/profileTheme";
import { ProfileLoadError, ProfileSection, ProfileSkeleton } from "@/components/programme/primitives";

const ICON_BY_KIND: Record<AttentionItem["kind"], typeof AlertTriangle> = {
  overdue_module: AlertTriangle,
  overdue_action: AlertTriangle,
  current_requirement: Clock,
  upcoming_session: Calendar,
  upcoming_requirement: Calendar,
};

/** Where each item is actioned — every item is a real link. */
function attentionPath(item: AttentionItem): string {
  switch (item.kind) {
    case "overdue_module":
      return LEARNER_MODULE_PATH[item.module] ?? "/coachee/journey#programme-journey";
    case "overdue_action":
      return "/coachee/journey#goals";
    case "upcoming_session":
      return "/sessions";
    default:
      return "/coachee/journey#programme-journey";
  }
}

/**
 * The learner's "Needs your attention" — the same position as Sponsor's
 * Attention section. Overdue items come from learner_canonical_overdue_items
 * (canonical_module_progress across every module), so the overdue count
 * shown here is the dashboard's Overdue KPI; nothing is capped, and nothing
 * is invented when nothing is due. Each item links to where the learner can
 * act on it.
 */
export function LearnerAttention({
  overdueModules,
  journey,
  overdueActions,
  nextSessionAt,
  loading,
  error,
}: {
  overdueModules: LearnerOverdueItem[];
  journey: ProgrammeJourneyPoint[];
  overdueActions: EnrollmentActionRow[];
  nextSessionAt: string | null;
  loading: boolean;
  error: string | null;
}) {
  const { t } = useTranslation("dashboard");
  const moduleLabel = useModuleScopeLabel();
  const items = loading || error ? [] : deriveAttentionList({ overdueModules, overdueActions, journey, nextSessionAt });
  const overdue = overdueUnitCount(items);

  const labelFor = (item: AttentionItem) => {
    switch (item.kind) {
      case "overdue_module":
        return moduleLabel(item.module);
      case "upcoming_session":
        return t("coacheeDashboard.nextUp.nextSession");
      default:
        return item.label;
    }
  };
  const detailFor = (item: AttentionItem) =>
    item.kind === "overdue_module"
      ? t("coacheeDashboard.nextUp.overdueUnits", { count: item.overdueUnits })
      : t(`coacheeDashboard.nextUp.kinds.${item.kind}`);

  return (
    <ProfileSection className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-serif text-[17px] font-normal">{t("learnerProfile.attention.title")}</h2>
        {!loading && !error && (
          <span
            data-testid="learner-attention-overdue-count"
            className="rounded-full bg-[#fbeade] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.1em] text-[#a8541c]"
          >
            {t("coacheeDashboard.nextUp.overdueCount", { count: overdue })}
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
            const isOverdue = item.kind === "overdue_module" || item.kind === "overdue_action";
            return (
              <li key={`${item.kind}-${idx}`}>
                <Link
                  to={attentionPath(item)}
                  className={`flex items-center gap-3.5 rounded-[10px] border px-4 py-3.5 transition-colors hover:border-[#8bd3e3] ${
                    isOverdue ? "border-[#f0d5cc] bg-[#fdf6f2]" : "border-[#eee8de] bg-[#f6f3ee]"
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${isOverdue ? "text-[#a8341c]" : "text-[#2c8fa8]"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{labelFor(item)}</div>
                    <div className="mt-0.5 text-[10.5px] text-[#6a6560]">
                      {detailFor(item)}
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
