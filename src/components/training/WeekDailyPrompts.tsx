import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ListChecks, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";

export const WEEK_PROMPTS_ANCHOR = "daily-prompts";

interface WeekPrompt {
  id: string;
  prompt_text: string;
  prompt_text_vi: string | null;
  day_offset: number | null;
  responded: boolean;
  response_text: string | null;
}

/**
 * A Training week's Daily Prompts, each answerable here. Optional practice:
 * they never gate the week. The week list links to this section by anchor
 * (#daily-prompts), so it scrolls into view once the prompts have loaded.
 */
export function WeekDailyPrompts({
  weekId,
  userId,
  enrollmentId,
  isVi,
}: {
  weekId: string;
  userId: string | undefined;
  enrollmentId: string | undefined;
  isVi: boolean;
}) {
  const { t } = useTranslation("training");
  const location = useLocation();
  const queryClient = useQueryClient();
  const sectionRef = useRef<HTMLDivElement>(null);
  const queryKey = ["training-week-prompts", weekId, enrollmentId, userId];
  // Off in the programme's Training checklist: no prompts section at all.
  const { hasModule } = useProgrammeModules();
  const promptsOn = hasModule("daily_prompt");

  const { data: prompts = [], isLoading, isError } = useQuery({
    queryKey,
    enabled: promptsOn && !!weekId && !!enrollmentId,
    queryFn: async (): Promise<WeekPrompt[]> => {
      const { data, error } = await supabase
        .from("daily_prompts")
        .select("id, prompt_text, prompt_text_vi, day_offset")
        .eq("training_week_id", weekId)
        .eq("is_visible", true)
        .order("sort_order");
      if (error) throw error;
      const ids = (data ?? []).map((p) => p.id);
      if (!ids.length) return [];
      const { data: responses, error: responseError } = await supabase
        .from("daily_prompt_responses")
        .select("daily_prompt_id, response_text, responded_at")
        .eq("enrollment_id", enrollmentId!)
        .in("daily_prompt_id", ids);
      if (responseError) throw responseError;
      // A row can exist only because the prompt was opened: answered means responded_at.
      const byPrompt = new Map((responses ?? []).map((r) => [r.daily_prompt_id, r]));
      return (data ?? []).map((p) => ({
        ...p,
        responded: !!byPrompt.get(p.id)?.responded_at,
        response_text: byPrompt.get(p.id)?.response_text ?? null,
      }));
    },
  });

  const anchored = location.hash === `#${WEEK_PROMPTS_ANCHOR}`;
  useEffect(() => {
    if (anchored && !isLoading) sectionRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [anchored, isLoading]);

  const respond = async (promptId: string, text: string) => {
    if (!userId || !enrollmentId) return false;
    const { error } = await supabase.from("daily_prompt_responses").upsert(
      {
        user_id: userId,
        enrollment_id: enrollmentId,
        daily_prompt_id: promptId,
        response_text: text.trim() || null,
        // Marks the prompt answered; the server replaces the value with its own time.
        responded_at: new Date().toISOString(),
      },
      { onConflict: "enrollment_id,daily_prompt_id" }
    );
    if (error) {
      toast.error(error.message);
      return false;
    }
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ["programme-training-progress", enrollmentId] });
    queryClient.invalidateQueries({ queryKey: ["todays-prompt"] });
    return true;
  };

  if (!promptsOn) return null;
  // Nothing to show for a week without prompts, unless the learner came here for them.
  if (!isLoading && !isError && prompts.length === 0 && !anchored) return null;

  return (
    <Card
      ref={sectionRef}
      id={WEEK_PROMPTS_ANCHOR}
      data-testid="week-daily-prompts"
      className="scroll-mt-6 flex flex-col gap-3 rounded-[18px] border-[#e8e2d8] p-5 sm:col-span-2"
    >
      <div className="flex items-center gap-2.5">
        <ListChecks className="h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {t("dailyPromptsHeading")}
            <span className="rounded-full bg-[#f2eee6] px-2 py-0.5 text-[10px] font-semibold text-[#8a847d]">
              {t("dailyPromptsOptional")}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">{t("weekPrompts.intro")}</p>
        </div>
      </div>
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      ) : isError || prompts.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("weekPrompts.error")}</p>
      ) : (
        <ul className="space-y-2">
          {prompts.map((prompt) => (
            <PromptItem key={prompt.id} prompt={prompt} isVi={isVi} onRespond={respond} t={t} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function PromptItem({
  prompt,
  isVi,
  onRespond,
  t,
}: {
  prompt: WeekPrompt;
  isVi: boolean;
  onRespond: (promptId: string, text: string) => Promise<boolean>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    if (await onRespond(prompt.id, text)) setText("");
    setSaving(false);
  };

  return (
    <li data-testid="week-prompt" data-state={prompt.responded ? "done" : "open"} className="rounded-xl bg-[#f7f4ee] px-3 py-2.5 text-sm">
      <div className="flex items-start justify-between gap-3">
        <span>
          {prompt.day_offset != null && (
            <span className="mr-1.5 text-[10.5px] font-bold uppercase tracking-[.08em] text-muted-foreground">
              {t("weekPrompts.dayN", { n: prompt.day_offset })}
            </span>
          )}
          {(isVi && prompt.prompt_text_vi) || prompt.prompt_text}
        </span>
        {prompt.responded ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> {t("dailyPromptAnswered")}
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-[#f2eee6] px-2 py-0.5 text-[10px] font-semibold text-[#8a847d]">
            {t("dailyPromptOptional")}
          </span>
        )}
      </div>
      {prompt.responded ? (
        prompt.response_text && <p className="mt-1.5 text-xs italic text-muted-foreground">{prompt.response_text}</p>
      ) : (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("weekPrompts.placeholder")}
            aria-label={(isVi && prompt.prompt_text_vi) || prompt.prompt_text}
            className="min-h-[60px] bg-background text-sm"
          />
          <Button size="sm" variant="outline" onClick={save} disabled={saving} className="shrink-0">
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {t("weekPrompts.markDone")}
          </Button>
        </div>
      )}
    </li>
  );
}
