import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  formatProfileDate,
  journeyWindow,
  programmeLifecycle,
  type ProgrammeJourneyPoint,
} from "@/lib/programmeProfile";
import { ProfileLoadError, ProfileSection, ProfileSkeleton } from "./primitives";
import { checkpointStateColor, useModuleScopeLabel, useProfileText, type ProgrammeViewer } from "./profileTheme";

export interface ProgrammeJourneyProps {
  journey: ProgrammeJourneyPoint[];
  start: string | null;
  end: string | null;
  viewer: ProgrammeViewer;
  /** "full" = every checkpoint; "summary" = `maxVisible` checkpoints around the current position. */
  variant?: "full" | "summary";
  maxVisible?: number;
  loading?: boolean;
  error?: { text: string; retryLabel?: string; onRetry?: () => void } | null;
  /** Rendered next to the lifecycle chip (e.g. the Dashboard's "View full journey" link). */
  action?: ReactNode;
  /** When provided, checkpoints become selectable and this renders the selected checkpoint's detail. */
  renderDetail?: (point: ProgrammeJourneyPoint) => ReactNode;
  id?: string;
}

/**
 * THE Programme Journey — one component for Sponsor → Leader Detail,
 * Learner → Dashboard and Learner → My Journey. It renders the canonical
 * checkpoint list exactly as the backend returned it (sponsor_canonical_
 * leader_journey / learner_canonical_journey share one SQL construction):
 * programme dates, checkpoint order, due date, module scope, cumulative
 * programme units and state. Viewer differences are confined to wording
 * and optional learner detail; the checkpoints themselves are identical.
 */
export function ProgrammeJourney({
  journey,
  start,
  end,
  viewer,
  variant = "full",
  maxVisible = 4,
  loading = false,
  error = null,
  action,
  renderDetail,
  id,
}: ProgrammeJourneyProps) {
  const { t } = useTranslation("sponsor");
  const text = useProfileText(viewer);
  const moduleLabel = useModuleScopeLabel();
  const status = programmeLifecycle(start, end);
  const window = journeyWindow(journey, variant === "summary" ? maxVisible : undefined);
  const [selected, setSelected] = useState<number | null>(null);
  const focusPoint = window.focusIndex >= 0 ? journey[window.focusIndex] : null;
  const selectedNumber = selected ?? focusPoint?.checkpoint_number ?? null;
  const selectedPoint = renderDetail ? journey.find((p) => p.checkpoint_number === selectedNumber) ?? null : null;

  return (
    <ProfileSection id={id} className="mt-4">
      <div data-testid="programme-journey" data-viewer={viewer} data-variant={variant} />
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-serif text-[19px] font-normal">{text("journeyTitle")}</h2>
          <p className="mt-1.5 text-[11.5px] text-[#9a938a]">{text("journeySubtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-[#e4f3f7] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.1em] text-[#2c8fa8]">
            {t(`cohortDetail.programmeDetails.status.${status}`)}
          </span>
          {action}
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <JourneyMeta label={t("cohortDetail.details.startEnd")} value={`${formatProfileDate(start)} – ${formatProfileDate(end)}`} />
        <JourneyMeta label={text("journeySource")} value={text("journeySourceValue")} />
      </div>

      {loading ? (
        <ProfileSkeleton className="h-[260px]" />
      ) : error ? (
        <ProfileLoadError text={error.text} onRetry={error.onRetry} retryLabel={error.retryLabel} />
      ) : journey.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-[#ddd6cc] bg-[#f6f3ee] px-4 py-4 text-[11px] leading-relaxed text-[#6a6560]">
          {text("journeyWithheld")}
        </p>
      ) : (
        <>
          <div className="mt-5 overflow-x-auto pb-2 [scrollbar-color:#cfc7bb_transparent]">
            <div className={cn("relative", window.points.length > 3 ? "min-w-[760px]" : "min-w-0")}>
              <ol className="relative grid auto-cols-[minmax(210px,1fr)] grid-flow-col items-stretch">
                {window.points.map((point) => (
                  <JourneyCheckpointCard
                    key={`${point.checkpoint_number}-${point.due_on}`}
                    point={point}
                    text={text}
                    moduleLabel={moduleLabel}
                    stateLabel={t(`cohortDetail.journey.states.${point.state}`)}
                    cumulativeLabel={t("cohortDetail.journey.cumulative")}
                    selected={renderDetail ? point.checkpoint_number === selectedNumber : false}
                    onSelect={renderDetail ? () => setSelected(point.checkpoint_number) : undefined}
                  />
                ))}
              </ol>
            </div>
          </div>
          {window.truncated && (
            <p className="mt-2 text-[10.5px] text-[#9a938a]">
              {text("journeyWindow", { first: window.firstShown, last: window.lastShown, total: window.total })}
            </p>
          )}
          {selectedPoint && renderDetail && <div className="mt-4">{renderDetail(selectedPoint)}</div>}
        </>
      )}
    </ProfileSection>
  );
}

export function JourneyCheckpointCard({
  point,
  text,
  moduleLabel,
  stateLabel,
  cumulativeLabel,
  selected = false,
  onSelect,
}: {
  point: ProgrammeJourneyPoint;
  text: (key: string, options?: Record<string, unknown>) => string;
  moduleLabel: (module: string) => string;
  stateLabel: string;
  cumulativeLabel: string;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const color = checkpointStateColor(point.state);
  const highlighted = point.state === "current" || selected;
  const body = (
    <div
      className={cn(
        "relative z-10 flex min-h-[260px] flex-1 flex-col rounded-xl border p-4 text-left transition-colors",
        highlighted ? "border-[#8bd3e3] bg-[#f1fbfd] shadow-[0_8px_24px_rgba(44,143,168,.1)]" : "border-[#eee8de] bg-[#f6f3ee]",
        onSelect && "cursor-pointer hover:border-[#8bd3e3]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[9px] font-bold uppercase tracking-[.15em]" style={{ color }}>
          {stateLabel}
        </span>
        <span className="shrink-0 text-right text-[10px] text-[#9a938a]">{formatProfileDate(point.due_on)}</span>
      </div>
      <div className="mt-3 min-h-[34px] break-words text-[12px] font-semibold leading-[1.35] text-[#062f3e]">
        {text("checkpoint", { number: point.checkpoint_number })}
      </div>
      <div className="mt-3 flex flex-wrap content-start gap-1.5">
        {point.module_scope.map((module) => (
          <span key={module} className="max-w-full rounded-full border border-[#d8e9ed] bg-white px-2 py-1 text-[9px] font-semibold leading-[1.25] text-[#2c8fa8]">
            {moduleLabel(module)}
          </span>
        ))}
      </div>
      <div className="mt-auto border-t border-[#e7e0d6] pt-3">
        <div className="text-[15px] font-semibold leading-none text-[#062f3e]">
          {point.completed_units} / {point.required_units}
        </div>
        <div className="mt-1 text-[9.5px] text-[#6a6560]">{cumulativeLabel}</div>
        {point.state === "current" && <div className="mt-1 text-[9.5px] font-semibold text-[#2c8fa8]">{text("youAreHere")}</div>}
      </div>
    </div>
  );

  return (
    <li data-testid="journey-checkpoint" data-state={point.state} className="relative flex min-w-0 flex-col px-1.5">
      {onSelect ? (
        <button type="button" onClick={onSelect} aria-pressed={selected} className="flex flex-1 flex-col">
          {body}
        </button>
      ) : (
        body
      )}
      <div className="relative mt-4 h-[36px] shrink-0">
        <span className="absolute left-0 right-1/2 top-1/2 h-px bg-[#dcd5ca]" aria-hidden="true" />
        <span className="absolute left-1/2 right-0 top-1/2 h-px bg-[#dcd5ca]" aria-hidden="true" />
        <span
          className="absolute left-1/2 top-1/2 z-20 grid h-4 w-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[3px] bg-white"
          style={{ borderColor: color }}
          aria-hidden="true"
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
        </span>
      </div>
    </li>
  );
}

function JourneyMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#eee8de] bg-[#f6f3ee] px-3.5 py-3">
      <div className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[#9a938a]">{label}</div>
      <div className="mt-1.5 text-[11.5px] font-semibold text-[#062f3e]">{value}</div>
    </div>
  );
}
