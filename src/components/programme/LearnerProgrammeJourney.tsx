import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLearnerCanonicalProgress } from "@/hooks/useLearnerCanonicalProgress";
import { formatProfileDate, ratioPct, type ProgrammeJourneyPoint } from "@/lib/programmeProfile";
import { MiniProgress } from "./primitives";
import { ProgrammeJourney } from "./ProgrammeJourney";
import { LEARNER_MODULE_PATH, PROFILE_COLORS, checkpointStateColor, useModuleScopeLabel } from "./profileTheme";

/**
 * The learner's Programme Journey: the shared <ProgrammeJourney> fed from
 * learner_canonical_journey. Dashboard renders `variant="summary"`, My
 * Journey renders `variant="full"` with checkpoint detail — same query
 * (same react-query cache entry), same checkpoints, same states, same
 * cumulative units; only the amount of detail differs.
 */
export function LearnerProgrammeJourney({
  enrollmentId,
  variant,
  action,
  id,
}: {
  enrollmentId: string | null | undefined;
  variant: "summary" | "full";
  action?: ReactNode;
  id?: string;
}) {
  const { t } = useTranslation("dashboard");
  const { progress, journey, loading, error, retry } = useLearnerCanonicalProgress(enrollmentId ?? undefined);

  return (
    <ProgrammeJourney
      id={id}
      journey={journey}
      start={progress?.programme_start_date ?? null}
      end={progress?.programme_end_date ?? null}
      viewer="learner"
      variant={variant}
      loading={loading}
      error={error ? { text: t("learnerProfile.errors.journey"), retryLabel: t("learnerProfile.errors.retry"), onRetry: retry } : null}
      action={action}
      renderDetail={variant === "full" ? (point) => <LearnerCheckpointDetail point={point} /> : undefined}
    />
  );
}

/** My Journey's expanded detail for one canonical checkpoint (no extra calculation). */
function LearnerCheckpointDetail({ point }: { point: ProgrammeJourneyPoint }) {
  const { t } = useTranslation("dashboard");
  const { t: tSponsor } = useTranslation("sponsor");
  const moduleLabel = useModuleScopeLabel();
  const color = checkpointStateColor(point.state);

  return (
    <div data-testid="checkpoint-detail" className="rounded-xl border border-[#eee8de] bg-[#f6f3ee] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[#9a938a]">
            {tSponsor("leaderDrawer.reference.checkpoint", { number: point.checkpoint_number })}
          </div>
          {point.label && <p className="mt-1 font-serif text-[16px] text-[#062f3e]">{point.label}</p>}
          <p className="mt-1 text-[11px] text-[#6a6560]">{t("learnerProfile.journey.dueOn", { date: formatProfileDate(point.due_on) })}</p>
        </div>
        <span className="text-[9.5px] font-bold uppercase tracking-[.15em]" style={{ color }}>
          {tSponsor(`cohortDetail.journey.states.${point.state}`)}
        </span>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between gap-2 text-[11px] text-[#6a6560]">
            <span>{tSponsor("cohortDetail.journey.cumulative")}</span>
            <span className="font-semibold text-[#062f3e]">
              {point.completed_units} / {point.required_units}
            </span>
          </div>
          <MiniProgress pct={ratioPct(point.completed_units, point.required_units)} color={color} />
          <p className="mt-2 text-[10.5px] text-[#6a6560]">
            {t(`learnerProfile.journey.stateNote.${point.state}`)}
          </p>
        </div>
        <div>
          <div className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[#9a938a]">{t("learnerProfile.journey.inScope")}</div>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {point.module_scope.map((module) => (
              <li key={module}>
                {LEARNER_MODULE_PATH[module] ? (
                  <Link
                    to={LEARNER_MODULE_PATH[module]}
                    className="inline-flex rounded-full border border-[#d8e9ed] bg-white px-2.5 py-1 text-[10px] font-semibold text-[#2c8fa8] hover:border-[#8bd3e3]"
                  >
                    {moduleLabel(module)} →
                  </Link>
                ) : (
                  <span className="inline-flex rounded-full border border-[#d8e9ed] bg-white px-2.5 py-1 text-[10px] font-semibold text-[#2c8fa8]">
                    {moduleLabel(module)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-3 text-[10px] leading-relaxed" style={{ color: PROFILE_COLORS.FAINT }}>
        {t("learnerProfile.journey.detailNote")}
      </p>
    </div>
  );
}
