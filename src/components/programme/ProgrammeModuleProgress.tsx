import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  configuredLearningItems,
  formatRatio,
  programmeModuleRows,
  ratioPct,
  type ProgrammeLearningItem,
  type ProgrammeModuleKey,
  type ProgrammeProgressFacts,
} from "@/lib/programmeProfile";
import { MiniProgress, ProfileSection, ProfileSectionTitle, UnavailableNote } from "./primitives";
import { PROFILE_COLORS, checkpointStateColor, useProfileText, type ProgrammeViewer } from "./profileTheme";

const { NAVY, SKY, TEAL, GREEN, AMBER } = PROFILE_COLORS;

const MODULE_COLOR: Record<ProgrammeModuleKey, string> = {
  coaching: SKY,
  training: NAVY,
  peer: TEAL,
  mentoring: GREEN,
  triads: AMBER,
};

/**
 * Module progress in canonical order (Coaching, Training / Learning, Peer
 * coaching, Mentoring, Triads) with the Training & learning child breakdown.
 * Training / Learning's completed/required come from the child-aware
 * canonical_module_progress (selected, visible, required Skill Cards etc.),
 * so a learner and their sponsor always see the same value (e.g. 5/6).
 */
export function ProgrammeModuleProgress({
  facts,
  learningBreakdown,
  viewer,
  moduleAction,
  learningAction,
}: {
  facts: ProgrammeProgressFacts;
  learningBreakdown: ProgrammeLearningItem[];
  viewer: ProgrammeViewer;
  /** Learner self-view: a link per module (e.g. open Training). */
  moduleAction?: (key: ProgrammeModuleKey) => ReactNode;
  learningAction?: ReactNode;
}) {
  const { t } = useTranslation("sponsor");
  const text = useProfileText(viewer);
  const learningItems = configuredLearningItems(learningBreakdown);

  return (
    <ProfileSection>
      <ProfileSectionTitle title={text("moduleProgress")} aside={text("aggregateOnly")} />
      <div data-testid="module-progress" className="mt-5 flex flex-col gap-4">
        {programmeModuleRows(facts).map((module) => (
          <div key={module.key} data-testid={`module-${module.key}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11.5px] font-medium text-[#062f3e]">{t(`cohortDetail.modules.${module.key}`)}</span>
              <span className="text-[10.5px] text-[#6a6560]">{formatRatio(module.completed, module.required)}</span>
            </div>
            <MiniProgress pct={ratioPct(module.completed, module.required)} color={MODULE_COLOR[module.key]} />
            <div className="mt-1 flex items-baseline justify-between gap-2 text-[9.5px] text-[#9a938a]">
              <span>{module.due == null ? text("notAvailable") : text("dueUnits", { count: module.due })}</span>
              {moduleAction && (module.required ?? 0) > 0 && moduleAction(module.key)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 border-t border-[#eee8de] pt-4">
        <div className="flex items-baseline justify-between gap-2.5">
          <h3 className="text-[11.5px] font-semibold text-[#062f3e]">{text("learningBreakdown")}</h3>
          <span className="text-[10px] text-[#9a938a]">{text("privacySafe")}</span>
        </div>
        {learningItems.length === 0 ? (
          <UnavailableNote text={text("learningUnavailable")} locked={viewer === "sponsor"} />
        ) : (
          <div data-testid="learning-breakdown" className="mt-3 flex flex-col gap-3">
            {learningItems.map((item) => (
              <div key={item.key} data-testid={`learning-${item.key}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[10.5px] text-[#6a6560]">{item.label}</span>
                  <span className="text-[10px] text-[#6a6560]">{`${item.completed_units}/${item.required_units}`}</span>
                </div>
                <MiniProgress pct={ratioPct(item.completed_units, item.required_units)} color={SKY} />
                <div className="mt-1 flex items-baseline justify-between gap-2 text-[9.5px] text-[#9a938a]">
                  <span>
                    {text("dueUnits", { count: item.due_units })}
                    {(item.overdue_units ?? 0) > 0 && (
                      <span className="ml-1.5 text-[#b4532a]">· {text("overdueUnits", { count: item.overdue_units })}</span>
                    )}
                  </span>
                  {viewer === "learner" && item.status !== "unavailable" && (
                    <span className="font-bold uppercase tracking-[.12em]" style={{ color: checkpointStateColor(item.status) }}>
                      {t(`cohortDetail.journey.states.${item.status}`)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {learningAction}
      </div>
      <div className="mt-[18px] rounded-[10px] bg-[#e4f3f7] px-[15px] py-[13px] text-[11px] leading-relaxed text-[#6a6560]">{text("attendanceOnly")}</div>
    </ProfileSection>
  );
}
