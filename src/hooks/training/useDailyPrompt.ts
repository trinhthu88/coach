import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import { toast } from "sonner";

export interface TodaysPrompt {
  prompt_id: string;
  prompt_text: string;
  prompt_text_vi: string | null;
  week_number: number;
  week_title: string;
  week_title_vi: string | null;
  already_responded: boolean;
  response_text: string | null;
}

/**
 * Today's daily prompt for the current user (via get_todays_prompt(), which
 * also re-checks the 'daily_prompt' module — see that migration's comment).
 * Marks opened_at on first render of an unopened prompt so DailyPromptCard
 * can be dropped into either dashboard unconditionally. No confidence score
 * here — that lives on reflection submissions (see useReflections.ts).
 */
export function useDailyPrompt() {
  const { user } = useAuth();
  const { selectedEnrollment } = useEnrollmentContext(user?.id);
  const enrollmentId = selectedEnrollment?.id;
  const queryClient = useQueryClient();
  const queryKey = ["todays-prompt", user?.id, enrollmentId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_todays_prompt");
      if (error) throw error;
      return ((data ?? [])[0] as TodaysPrompt | undefined) ?? null;
    },
    enabled: !!user && !!enrollmentId,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!user || !data || data.already_responded || !enrollmentId) return;
    supabase
      .from("daily_prompt_responses")
      .upsert(
        { user_id: user.id, enrollment_id: enrollmentId, daily_prompt_id: data.prompt_id, opened_at: new Date().toISOString() },
        { onConflict: "enrollment_id,daily_prompt_id", ignoreDuplicates: false }
      )
      .then(({ error }) => {
        if (error) console.error("Failed to record prompt open", error);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, data?.prompt_id, data?.already_responded, enrollmentId]);

  const respond = useCallback(
    async (responseText: string) => {
      if (!user || !data || !enrollmentId) return;
      const { error } = await supabase.from("daily_prompt_responses").upsert(
        {
          user_id: user.id,
          enrollment_id: enrollmentId,
          daily_prompt_id: data.prompt_id,
          response_text: responseText || null,
          responded_at: new Date().toISOString(),
        },
        { onConflict: "enrollment_id,daily_prompt_id" }
      );
      if (error) {
        toast.error(error.message);
        return;
      }
      queryClient.invalidateQueries({ queryKey });
    },
    [user, data, enrollmentId, queryClient, queryKey]
  );

  return { prompt: data ?? null, loading: !!user && isLoading, respond };
}
