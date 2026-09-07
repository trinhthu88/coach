import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
    <div className="rounded-[18px] bg-primary-soft p-5 sm:p-[22px]">
      <p className="text-[9.5px] font-bold uppercase tracking-[.22em] text-[#2c8fa8]">
        {answered ? t("dailyPrompt.titleAnswered") : t("dailyPrompt.title")}
        {prompt?.week_number ? ` · ${t("dailyPrompt.weekN", { n: prompt.week_number })}` : ""}
      </p>
      {promptLoading ? (
        <div className="mt-3 h-16 animate-pulse rounded-lg bg-white/50" />
      ) : !prompt ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("dailyPrompt.noPromptToday")}</p>
      ) : answered ? (
        <div className="mt-2">
          <p className="max-w-[60ch] text-[15.5px] leading-[1.5] text-foreground">{promptText}</p>
          <div className="mt-3 flex items-center gap-2">
            <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-success text-white">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </span>
            <p className="text-[13px] font-semibold text-success">{t("dailyPrompt.submitted")}</p>
          </div>
          {prompt.response_text && (
            <p className="mt-2 rounded-xl bg-white/60 p-3.5 text-[13px] leading-relaxed text-muted-foreground">&ldquo;{prompt.response_text}&rdquo;</p>
          )}
        </div>
      ) : (
        <div className="mt-2">
          <p className="max-w-[60ch] text-[15.5px] font-medium leading-[1.5] text-foreground">{promptText}</p>
          <Textarea
            className="mt-4 rounded-[14px] border-[#dcd5c9] bg-white text-[13px]"
            rows={3}
            placeholder={t("reflection.placeholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button
            size="sm"
            className="mt-4 rounded-[12px] bg-secondary px-5 text-[12px] font-semibold text-secondary-foreground hover:bg-secondary/90"
            onClick={handleRespond}
            disabled={submitting}
          >
            {submitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
            {t("dailyPrompt.respond")}
          </Button>
        </div>
      )}
    </div>
  );
}
