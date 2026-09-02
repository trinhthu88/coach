import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useDailyPrompt } from "@/hooks/training/useDailyPrompt";

/**
 * Daily micro-nudge widget — shared between the coach and coachee dashboards,
 * same "renders nothing while loading / when the module is off" contract as
 * ThisWeekSkillCard so it's safe to drop into either dashboard unconditionally.
 */
export function DailyPromptCard() {
  const { t, i18n } = useTranslation("training");
  const { hasModule, loading: modulesLoading } = useProgrammeModules();
  const { prompt, loading: promptLoading, respond } = useDailyPrompt();
  const isVi = i18n.language?.startsWith("vi");

  const [text, setText] = useState("");
  const [confidence, setConfidence] = useState(5);
  const [submitting, setSubmitting] = useState(false);

  if (modulesLoading || !hasModule("daily_prompt")) return null;

  const promptText = prompt ? (isVi && prompt.prompt_text_vi) || prompt.prompt_text : null;

  const handleRespond = async () => {
    setSubmitting(true);
    await respond(text, confidence);
    setSubmitting(false);
  };

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("dailyPrompt.title")}</p>
      </div>
      {promptLoading ? (
        <div className="h-16 animate-pulse rounded-lg bg-muted/50" />
      ) : !prompt ? (
        <p className="text-sm text-muted-foreground">{t("dailyPrompt.noPromptToday")}</p>
      ) : prompt.already_responded ? (
        <div>
          <p className="text-sm text-foreground">{promptText}</p>
          {prompt.response_text && <p className="mt-2 text-sm italic text-muted-foreground">&ldquo;{prompt.response_text}&rdquo;</p>}
          {prompt.confidence_score != null && (
            <p className="mt-2 text-xs font-semibold text-primary">
              {t("dailyPrompt.confidence")}: {prompt.confidence_score}/10
            </p>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">{t("dailyPrompt.submitted")}</p>
        </div>
      ) : (
        <div>
          <p className="text-sm font-medium text-foreground">{promptText}</p>
          <Textarea
            className="mt-3"
            rows={3}
            placeholder={t("reflection.placeholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground">{t("dailyPrompt.confidenceLabel")}</span>
              <span className="text-xs font-semibold tabular-nums text-foreground">{confidence}</span>
            </div>
            <Slider value={[confidence]} min={1} max={10} step={1} onValueChange={(v) => setConfidence(v[0])} />
          </div>
          <Button size="sm" className="mt-4" onClick={handleRespond} disabled={submitting}>
            {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {t("dailyPrompt.respond")}
          </Button>
        </div>
      )}
    </Card>
  );
}
