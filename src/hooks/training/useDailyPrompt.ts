import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
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
  confidence_score: number | null;
}

/**
 * Today's daily prompt for the current user (via get_todays_prompt(), which
 * also re-checks the 'daily_prompt' module — see that migration's comment).
 * Marks opened_at on first render of an unopened prompt so DailyPromptCard
 * can be dropped into either dashboard unconditionally.
 */
export function useDailyPrompt() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["todays-prompt", user?.id];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_todays_prompt");
      if (error) throw error;
      return ((data ?? [])[0] as TodaysPrompt | undefined) ?? null;
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!user || !data || data.already_responded) return;
    supabase
      .from("daily_prompt_responses")
      .upsert(
        { user_id: user.id, daily_prompt_id: data.prompt_id, opened_at: new Date().toISOString() },
        { onConflict: "daily_prompt_id,user_id", ignoreDuplicates: false }
      )
      .then(({ error }) => {
        if (error) console.error("Failed to record prompt open", error);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, data?.prompt_id, data?.already_responded]);

  const respond = useCallback(
    async (responseText: string, confidenceScore: number) => {
      if (!user || !data) return;
      const { error } = await supabase.from("daily_prompt_responses").upsert(
        {
          user_id: user.id,
          daily_prompt_id: data.prompt_id,
          response_text: responseText || null,
          confidence_score: confidenceScore,
          responded_at: new Date().toISOString(),
        },
        { onConflict: "daily_prompt_id,user_id" }
      );
      if (error) {
        toast.error(error.message);
        return;
      }
      queryClient.invalidateQueries({ queryKey });
    },
    [user, data, queryClient, queryKey]
  );

  return { prompt: data ?? null, loading: !!user && isLoading, respond };
}
