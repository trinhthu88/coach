import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Loader2, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
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

  const answered = !!prompt?.already_responded;

  return (
    <Card className={cn("border-l-4 p-5", answered ? "border-l-success" : "border-l-primary")}>
      <div className="mb-3 flex items-center gap-2">
        {answered ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Sparkles className="h-4 w-4 text-primary" />}
        <p className={cn("text-2xs font-bold uppercase tracking-[0.2em]", answered ? "text-success" : "text-primary")}>
          {answered ? t("dailyPrompt.titleAnswered") : t("dailyPrompt.title")}
          {prompt?.week_number ? ` · ${t("dailyPrompt.weekN", { n: prompt.week_number })}` : ""}
        </p>
      </div>
      {promptLoading ? (
        <div className="h-16 animate-pulse rounded-lg bg-muted/50" />
      ) : !prompt ? (
        <p className="text-sm text-muted-foreground">{t("dailyPrompt.noPromptToday")}</p>
      ) : answered ? (
        <div>
          <p className="text-[15px] leading-relaxed text-foreground">{promptText}</p>
          {prompt.confidence_score != null && (
            <div className="mt-5 flex gap-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <span
                  key={n}
                  className={cn(
                    "grid h-6 flex-1 place-items-center rounded-md text-2xs font-bold",
                    n <= prompt.confidence_score! ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground"
                  )}
                >
                  {n}
                </span>
              ))}
            </div>
          )}
          <div className="mt-4 inline-flex items-center gap-2 text-[13px] font-semibold text-success">
            <CheckCircle2 className="h-4 w-4" />
            {t("dailyPrompt.confidence")}: {prompt.confidence_score}/10
          </div>
          {prompt.response_text && (
            <p className="mt-3 rounded-xl bg-muted/50 p-3.5 text-[13px] leading-relaxed text-muted-foreground">&ldquo;{prompt.response_text}&rdquo;</p>
          )}
        </div>
      ) : (
        <div>
          <p className="text-[15px] font-medium leading-relaxed text-foreground">{promptText}</p>
          <div className="mt-5">
            <span className="text-[12px] font-semibold text-foreground">{t("dailyPrompt.confidenceLabel")}</span>
            <div className="mt-2 flex items-center gap-3">
              <Slider value={[confidence]} min={1} max={10} step={1} onValueChange={(v) => setConfidence(v[0])} className="flex-1" />
              <span className="font-display w-8 text-right text-2xl text-primary">{confidence}</span>
            </div>
          </div>
          <Textarea
            className="mt-4"
            rows={3}
            placeholder={t("reflection.placeholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button size="sm" className="mt-4" onClick={handleRespond} disabled={submitting}>
            {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {t("dailyPrompt.respond")}
          </Button>
        </div>
      )}
    </Card>
  );
}
