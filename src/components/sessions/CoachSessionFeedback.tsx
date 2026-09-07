import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Star, Loader2, Save, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getFriendlyErrorMessage } from "@/lib/errors";
import type { EngagementLevel } from "@/hooks/sessions/useCoachSessionFeedback";
import type { useCoachSessionFeedback } from "@/hooks/sessions/useCoachSessionFeedback";

const ENGAGEMENT_LEVELS: EngagementLevel[] = ["high", "moderate", "low", "disengaged"];

interface Props {
  feedback: ReturnType<typeof useCoachSessionFeedback>;
}

/** Optional, private coach-only feedback on a completed coaching session —
 * a quality rating, the client's engagement level, and an admin flag for
 * sessions that need attention. Nothing here is ever shown to the coachee. */
export function CoachSessionFeedback({ feedback }: Props) {
  const { t } = useTranslation("sessions");
  const [rating, setRating] = useState(feedback.feedback.quality_rating);
  const [hover, setHover] = useState(0);
  const [engagement, setEngagement] = useState<EngagementLevel | null>(feedback.feedback.engagement_level);
  const [flagged, setFlagged] = useState(feedback.feedback.flag_for_admin);
  const [flagNotes, setFlagNotes] = useState(feedback.feedback.flag_notes);

  const save = async () => {
    const { error } = await feedback.save({
      quality_rating: rating,
      engagement_level: engagement,
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

      <div className="space-y-1.5">
        <p className="text-sm font-medium">{t("detail.coachFeedback.qualityRating")}</p>
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => {
            const active = (hover || rating || 0) >= n;
            return (
              <button
                key={n}
                type="button"
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                onClick={() => setRating(n)}
                className="p-0.5 transition-transform hover:scale-110"
                aria-label={t("detail.coachFeedback.rateStars", { count: n })}
              >
                <Star className={cn("h-5 w-5", active ? "fill-warning text-warning" : "text-muted-foreground")} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">{t("detail.coachFeedback.engagementLevel")}</p>
        <Select value={engagement ?? undefined} onValueChange={(v) => setEngagement(v as EngagementLevel)}>
          <SelectTrigger className="max-w-xs">
            <SelectValue placeholder={t("detail.coachFeedback.engagementPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {ENGAGEMENT_LEVELS.map((level) => (
              <SelectItem key={level} value={level}>
                {t(`detail.coachFeedback.engagementLevels.${level}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
