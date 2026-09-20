import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Save, Flag } from "lucide-react";
import { toast } from "sonner";
import { getFriendlyErrorMessage } from "@/lib/errors";
import type { useCoachSessionFeedback } from "@/hooks/sessions/useCoachSessionFeedback";

interface Props {
  feedback: ReturnType<typeof useCoachSessionFeedback>;
}

/**
 * Optional, private Coach escalation on a Coaching session: flag it for Admin
 * with a note. Never shown to the learner or the Sponsor, and never an input
 * to programme progress.
 *
 * The session quality rating and learner engagement level were removed by the
 * 2026 Coaching redesign. The Coach does not grade the learner, and neither
 * value legitimately bore on whether a Coaching unit was complete.
 */
export function CoachSessionFeedback({ feedback }: Props) {
  const { t } = useTranslation("sessions");
  const [flagged, setFlagged] = useState(feedback.feedback.flag_for_admin);
  const [flagNotes, setFlagNotes] = useState(feedback.feedback.flag_notes);

  const save = async () => {
    // A flag with no explanation is not actionable for an Admin.
    if (flagged && flagNotes.trim().length === 0) {
      toast.error(t("detail.coachFeedback.flagNotesRequired"));
      return;
    }
    const { error } = await feedback.save({
      flag_for_admin: flagged,
      flag_notes: flagNotes,
    });
    if (error) {
      toast.error(getFriendlyErrorMessage(error, t));
      return;
    }
    toast.success(t("detail.coachFeedback.saved"));
  };

  return (
    <Card className="space-y-5 p-5 sm:p-8">
      <div>
        <p className="eyebrow text-primary">{t("detail.coachFeedback.title")}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t("detail.coachFeedback.intro")}</p>
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox checked={flagged} onCheckedChange={(v) => setFlagged(!!v)} />
          <Flag className="h-3.5 w-3.5 text-warning" /> {t("detail.coachFeedback.flagLabel")}
        </label>
        {flagged && (
          <Textarea
            rows={3}
            value={flagNotes}
            onChange={(e) => setFlagNotes(e.target.value)}
            placeholder={t("detail.coachFeedback.flagNotesPlaceholder")}
          />
        )}
      </div>

      <div className="flex justify-end">
        <Button className="rounded-full" onClick={save} disabled={feedback.saving}>
          {feedback.saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
          {feedback.feedback.existed ? t("detail.coachFeedback.update") : t("detail.coachFeedback.save")}
        </Button>
      </div>
    </Card>
  );
}
