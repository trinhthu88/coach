import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useCoachingReflection,
  useCoachingSessionEvidence,
  useSubmitCoachingReflection,
} from "@/hooks/coaching/useCanonicalCoaching";

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
 *
 * The reflection gate also owns its WRITER here. The other three gates are
 * satisfied elsewhere in the product by surfaces that already existed (goal
 * check-in by SessionGoalRatings, follow-up action by the session action list,
 * satisfaction by the rating control on Sessions). The reflection gate had
 * none, which left session_learning_reflections with no INSERT path anywhere
 * in the app and left the reflection permanently outstanding. It is
 * placed on the gate it satisfies so there is exactly one way to write it.
 */
export function CoachingPostSessionChecklist({
  sessionId,
  enrollmentId,
  canSubmitReflection = false,
  className,
}: {
  sessionId: string;
  /** Required to write the reflection; it is the row's owning scope. */
  enrollmentId?: string | null;
  /** Only the learner whose session this is may write their own reflection. */
  canSubmitReflection?: boolean;
  className?: string;
}) {
  const { t } = useTranslation("sessions");
  const { data: evidence, isLoading } = useCoachingSessionEvidence(sessionId);
  const composerEnabled = canSubmitReflection && !!enrollmentId;
  const { data: existing } = useCoachingReflection(
    composerEnabled ? enrollmentId : null,
    composerEnabled ? sessionId : null,
  );
  const submit = useSubmitCoachingReflection();

  const [draft, setDraft] = useState("");
  const [touched, setTouched] = useState(false);
  // Adopt the stored reflection once it arrives, but never clobber an edit in
  // progress.
  useEffect(() => {
    if (!touched && existing !== undefined) setDraft(existing?.body ?? "");
  }, [existing, touched]);

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

  const trimmed = draft.trim();
  const unchanged = trimmed === (existing?.body ?? "").trim();
  const canSave = trimmed.length > 0 && !unchanged && !submit.isPending;

  const handleSave = async () => {
    if (!canSave || !enrollmentId) return;
    try {
      await submit.mutateAsync({ enrollmentId, sessionId, body: trimmed });
      setTouched(false);
      toast.success(t("postSession.reflection.saved"));
    } catch (error) {
      toast.error((error as { message?: string }).message ?? t("postSession.reflection.saveFailed"));
    }
  };

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
          variant={evidence.evidenceComplete ? "default" : "secondary"}
          data-testid="coaching-evidence-status"
        >
          {evidence.evidenceComplete
            ? t("postSession.evidenceComplete")
            : t("postSession.evidencePending", { done: doneCount, total: applicable.length })}
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

      {composerEnabled && (
        <div className="space-y-2 border-t pt-4" data-testid="coaching-reflection-composer">
          <Label htmlFor="coaching-reflection">
            {t("postSession.reflection.label")}
          </Label>
          <p className="text-xs text-muted-foreground">{t("postSession.reflection.help")}</p>
          <Textarea
            id="coaching-reflection"
            rows={4}
            value={draft}
            placeholder={t("postSession.reflection.placeholder")}
            onChange={(e) => {
              setTouched(true);
              setDraft(e.target.value);
            }}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={handleSave} disabled={!canSave} data-testid="coaching-reflection-save">
              {submit.isPending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
              {evidence.hasReflection
                ? t("postSession.reflection.update")
                : t("postSession.reflection.save")}
            </Button>
          </div>
        </div>
      )}

      {!evidence.evidenceComplete && (
        <p className="text-xs text-muted-foreground">{t("postSession.footer")}</p>
      )}
    </Card>
  );
}

export default CoachingPostSessionChecklist;
