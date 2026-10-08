import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import type { EnrollmentDisplayState } from "@/lib/enrollments";
import { cn } from "@/lib/utils";

/**
 * Shown on a learner page whose enrollment is not current
 * (learner_display_enrollment: is_current = false). The page stays readable;
 * its Book / Submit / Schedule / Resubmit actions are hidden, and the server
 * refuses them anyway (learner_current_enrollment). The state is the
 * server's -- this component never works out "ended" or "paused" itself.
 */
export function ProgrammeReadOnlyBanner({
  isCurrent,
  displayState,
  className,
}: {
  isCurrent: boolean | null | undefined;
  displayState: EnrollmentDisplayState | string | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation("common");
  if (isCurrent !== false || !displayState || displayState === "current") return null;
  return (
    <div
      role="status"
      data-testid="programme-read-only-banner"
      data-state={displayState}
      className={cn("flex items-start gap-3 rounded-[12px] border border-[#e8dcc4] bg-[#fbf6ec] px-4 py-3 text-[#5c4a26]", className)}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="space-y-0.5">
        <p className="text-[13px] font-semibold">{t(`programmeReadOnly.${displayState}.title`)}</p>
        <p className="text-[12px] leading-relaxed">{t(`programmeReadOnly.${displayState}.body`)}</p>
      </div>
    </div>
  );
}
