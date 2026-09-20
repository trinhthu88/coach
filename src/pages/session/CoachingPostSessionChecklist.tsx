import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCoachingSessionEvidence } from "@/hooks/coaching/useCanonicalCoaching";

/**
 * The mandatory post-session learning gate for one Coaching session.
 *
 * A held session is NOT a completed programme unit. This card makes that
 * distinction visible and reads every tick straight from
 * coaching_session_evidence() -- it never infers completion from the presence
 * of a note, a rating or anything else on screen.
 *
 * The Coach's private note and Admin flag are deliberately absent: they are
 * optional and never gate the unit.
 */
export function CoachingPostSessionChecklist({
  sessionId,
  className,
}: {
  sessionId: string;
  className?: string;
}) {
  const { t } = useTranslation("sessions");
  const { data: evidence, isLoading } = useCoachingSessionEvidence(sessionId);

  // Only meaningful once the Coach has marked the conversation held.
  if (isLoading || !evidence || !evidence.sessionCompleted) return null;

  const items = [
    { key: "reflection", done: evidence.hasReflection, required: true },
    // Section 20: the check-in gate only applies when the enrollment carries an
    // active goal. When it does not, the row is shown as not-required rather
    // than as an unsatisfiable outstanding item.
    { key: "goalCheckin", done: evidence.hasGoalCheckin, required: evidence.goalCheckinRequired },
    { key: "action", done: evidence.hasAction, required: true },
    { key: "satisfaction", done: evidence.hasSatisfaction, required: true },
  ];

  const applicable = items.filter((i) => i.required);
  const doneCount = applicable.filter((i) => i.done).length;

  return (
    <Card className={cn("surface-card space-y-4 p-4 sm:p-6", className)} data-testid="coaching-post-session">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-lg leading-tight">
            {t("postSession.title")}
          </h3>
          <p className="text-sm text-muted-foreground">{t("postSession.subtitle")}</p>
        </div>
        <Badge
          variant={evidence.unitComplete ? "default" : "secondary"}
          data-testid="coaching-unit-status"
        >
          {evidence.unitComplete
            ? t("postSession.unitComplete")
            : t("postSession.unitPending", { done: doneCount, total: applicable.length })}
        </Badge>
      </div>

      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.key}
            data-testid={`post-session-${item.key}`}
            data-done={item.done ? "true" : "false"}
            data-required={item.required ? "true" : "false"}
            className={cn(
              "flex items-center gap-2 text-sm",
              !item.required && "text-muted-foreground",
            )}
          >
            {item.done ? (
              <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
            ) : (
              <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className={cn(item.done && "text-muted-foreground line-through")}>
              {t(`postSession.items.${item.key}`)}
            </span>
            {!item.required && (
              <span className="text-xs">({t("postSession.notRequired")})</span>
            )}
          </li>
        ))}
      </ul>

      {!evidence.unitComplete && (
        <p className="text-xs text-muted-foreground">{t("postSession.footer")}</p>
      )}
    </Card>
  );
}

export default CoachingPostSessionChecklist;
