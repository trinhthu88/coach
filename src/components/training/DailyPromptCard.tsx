import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Loader2, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useDailyPrompt } from "@/hooks/training/useDailyPrompt";

/**
 * Daily micro-nudge widget — shared between the coach and coachee dashboards,
 * same "renders nothing while loading / when the module is off" contract as
 * ThisWeekSkillCard so it's safe to drop into either dashboard unconditionally.
 * Deliberately lightweight: prompt text + optional short response + Done.
 * No confidence score — that lives on reflections, see ReflectionView.tsx.
 */
export function DailyPromptCard() {
  const { t, i18n } = useTranslation("training");
  const { hasModule, loading: modulesLoading } = useProgrammeModules();
  const { prompt, loading: promptLoading, respond } = useDailyPrompt();
  const isVi = i18n.language?.startsWith("vi");

  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (modulesLoading || !hasModule("daily_prompt")) return null;

  const promptText = prompt ? (isVi && prompt.prompt_text_vi) || prompt.prompt_text : null;

  const handleRespond = async () => {
    setSubmitting(true);
    await respond(text);
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
          {prompt.response_text && (
            <p className="mt-3 rounded-xl bg-muted/50 p-3.5 text-[13px] leading-relaxed text-muted-foreground">&ldquo;{prompt.response_text}&rdquo;</p>
          )}
        </div>
      ) : (
        <div>
          <p className="text-[15px] font-medium leading-relaxed text-foreground">{promptText}</p>
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
