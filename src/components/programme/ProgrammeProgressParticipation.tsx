import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  canonicalCompletionPct,
  clampPct,
  formatCount,
  formatPercent,
  formatProfileDateTime,
  formatRatio,
  ratioPct,
  type ProgrammeCoachingUtilisation,
  type ProgrammeJourneyPoint,
  type ProgrammeProgressFacts,
} from "@/lib/programmeProfile";
import { ProfileSection, ProgressRow, SmallMetric, UnavailableNote } from "./primitives";
import { PROFILE_COLORS, useProfileText, type ProgrammeViewer } from "./profileTheme";

const { NAVY, TEAL, GREEN, RED } = PROFILE_COLORS;

/**
 * Progress & participation: completed required activities, due-to-date
 * adherence, required/due/overdue counts, coaching utilisation and the
 * checkpoint participation trend — all straight from the canonical progress
 * row and journey. `children` lets the learner self-view add its own
 * actions (book a session, upcoming bookings) inside the same card.
 */
export function ProgrammeProgressParticipation({
  facts,
  journey,
  coachingUtilisation,
  viewer,
  children,
}: {
  facts: ProgrammeProgressFacts;
  journey: ProgrammeJourneyPoint[];
  coachingUtilisation: ProgrammeCoachingUtilisation | null;
  viewer: ProgrammeViewer;
  children?: ReactNode;
}) {
  const { t } = useTranslation("sponsor");
  const text = useProfileText(viewer);
  const completion = canonicalCompletionPct(facts.full_completion_pct) ?? 0;
  const adherence = clampPct(facts.due_adherence_pct ?? 0);

  return (
    <ProfileSection>
      <span className="sr-only">{t("leaderDrawer.participation.title")}</span>
      <h2 className="font-serif text-[17px] font-normal">{text("progressTitle")}</h2>
      <div className="mt-[18px] flex flex-col gap-3.5">
        <ProgressRow label={t("leaderDrawer.progress.completedRequired")} value={`${facts.completed_units} / ${facts.required_units}`} pct={completion} color={NAVY} />
        <ProgressRow
          label={t("leaderDrawer.progress.adherence")}
          value={facts.due_adherence_pct == null ? "—" : formatPercent(adherence)}
          pct={adherence}
          color={TEAL}
          empty={facts.due_adherence_pct == null}
        />
      </div>
      <div className="mt-[18px] flex flex-wrap gap-7 border-t border-[#eee8de] pt-4">
        <SmallMetric value={String(facts.required_units)} label={text("requiredActivities")} />
        <SmallMetric value={String(facts.due_units)} label={text("activitiesDue")} />
        <SmallMetric value={String(facts.overdue_units)} label={text("overdueRequired")} color={RED} />
      </div>
      <p className="mt-3 text-[10.5px] leading-relaxed text-[#9a938a]">{text("extraActivityNote")}</p>
      <div className="mt-[18px] border-t border-[#eee8de] pt-4">
        <h3 className="mb-3 text-[9.5px] font-bold uppercase tracking-[.16em] text-[#9a938a]">{text("coachingUtilisation")}</h3>
        <div data-testid="coaching-utilisation" className="flex flex-wrap gap-7">
          <SmallMetric value={formatCount(facts.coaching_required_units)} label={text("allocated")} />
          <SmallMetric value={formatRatio(facts.coaching_completed_units, facts.coaching_required_units)} label={text("completed")} color={GREEN} />
          <SmallMetric
            value={String(Math.max((facts.coaching_required_units ?? 0) - (facts.coaching_completed_units ?? 0), 0))}
            label={text("remaining")}
            color={TEAL}
          />
          <SmallMetric value={String(coachingUtilisation?.booked_units ?? facts.coaching_booked_units ?? 0)} label={text("booked")} />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#f6f3ee] px-3 py-2.5 text-[10.5px] text-[#6a6560]">
          <span className="font-semibold text-[#062f3e]">{text("nextSession")}</span>
          <span>{coachingUtilisation?.next_session_at ? formatProfileDateTime(coachingUtilisation.next_session_at) : text("noSessionBooked")}</span>
        </div>
        {children}
      </div>
      <div className="mt-[18px] border-t border-[#eee8de] pt-4">
        <div className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[#9a938a]">{text("trendTitle")}</div>
        {journey.length === 0 ? <UnavailableNote text={text("trendWithheld")} locked={viewer === "sponsor"} /> : <CheckpointTrend journey={journey} />}
      </div>
    </ProfileSection>
  );
}

/** Cumulative completion at each canonical checkpoint (the individual participation trend). */
function CheckpointTrend({ journey }: { journey: ProgrammeJourneyPoint[] }) {
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-[#eee8de] bg-[#f6f3ee] px-3 pb-2.5 pt-3">
      <div className="flex min-w-0 gap-2">
        <div className="flex h-[142px] w-7 shrink-0 flex-col justify-between pb-5 text-right text-[8px] text-[#9a938a]" aria-hidden="true">
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[117px]" aria-hidden="true">
            <span className="absolute inset-x-0 top-0 border-t border-[#e1d9ce]" />
            <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-[#e1d9ce]" />
            <span className="absolute inset-x-0 bottom-0 border-t border-[#d7cec1]" />
          </div>
          <div className="relative grid h-[142px] min-w-0 gap-1" style={{ gridTemplateColumns: `repeat(${journey.length}, minmax(0, 1fr))` }}>
            {journey.map((point) => {
              const pct = ratioPct(point.completed_units, point.required_units);
              const label = `CP${point.checkpoint_number}`;
              return (
                <div key={point.checkpoint_number} className="flex min-w-0 flex-col items-center justify-end">
                  <span className="mb-1 text-[8px] font-semibold text-[#6a6560]">{pct == null ? "—" : formatPercent(pct)}</span>
                  <div className="flex h-[104px] w-full items-end justify-center">
                    <div
                      role="img"
                      aria-label={`${label}: ${pct == null ? "not available" : formatPercent(pct)}`}
                      className={`w-[min(22px,65%)] rounded-t-[4px] transition-[height] ${point.state === "current" ? "bg-[#3db4d0]" : "bg-[#2c8fa8]"}`}
                      style={{ height: `${pct ?? 0}%` }}
                    />
                  </div>
                  <span className="mt-1.5 max-w-full truncate text-[8.5px] font-bold uppercase tracking-[.08em] text-[#6a6560]">{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
