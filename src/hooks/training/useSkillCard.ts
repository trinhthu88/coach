import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

export type SkillCardElementType = "expandable_example" | "try_this_prompt" | "key_concept" | "video_link" | "tip";

export interface SkillCardElement {
  id: string;
  element_type: SkillCardElementType;
  title: string;
  title_vi: string | null;
  content: string;
  content_vi: string | null;
  sort_order: number;
}

export interface TrainingWeekDetail {
  id: string;
  programme_id: string;
  week_number: number;
  title: string;
  title_vi: string | null;
  subtitle: string | null;
  subtitle_vi: string | null;
  skill_card_html: string | null;
  skill_card_html_vi: string | null;
  pdf_storage_path: string | null;
  pdf_storage_path_vi: string | null;
}

/**
 * A single training week's skill card content + this user's progress on it.
 * Records a view (upsert viewed_at) once the week has loaded, exposes
 * markComplete() and downloadPdf() for the two progress-affecting actions.
 * training_weeks/skill_card_elements RLS (not this hook) is what actually
 * withholds content for a locked week — a direct query here for a week the
 * user can't yet see just comes back null/empty, same as any other RLS miss.
 */
export function useSkillCard(weekId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [completing, setCompleting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["skill-card", weekId],
    queryFn: async () => {
      const [{ data: week, error: weekError }, { data: elements, error: elementsError }] = await Promise.all([
        supabase
          .from("training_weeks")
          .select(
            "id, programme_id, week_number, title, title_vi, subtitle, subtitle_vi, skill_card_html, skill_card_html_vi, pdf_storage_path, pdf_storage_path_vi"
          )
          .eq("id", weekId as string)
          .maybeSingle(),
        supabase
          .from("skill_card_elements")
          .select("id, element_type, title, title_vi, content, content_vi, sort_order")
          .eq("training_week_id", weekId as string)
          .order("sort_order"),
      ]);
      if (weekError) throw weekError;
      if (elementsError) throw elementsError;
      return {
        week: (week as TrainingWeekDetail | null) ?? null,
        elements: (elements ?? []) as SkillCardElement[],
      };
    },
    enabled: !!weekId,
  });

  const progressKey = ["training-progress", weekId, user?.id];
  const { data: progress } = useQuery({
    queryKey: progressKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_progress")
        .select("viewed_at, completed_at, pdf_downloaded_at")
        .eq("training_week_id", weekId as string)
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!weekId && !!user,
  });

  const weekLoaded = !!data?.week;
  useEffect(() => {
    if (!weekId || !user || !weekLoaded) return;
    supabase
      .from("training_progress")
      .upsert(
        { user_id: user.id, training_week_id: weekId, viewed_at: new Date().toISOString() },
        { onConflict: "user_id,training_week_id" }
      )
      .then(({ error }) => {
        if (error) console.error("Failed to record training week view", error);
        else queryClient.invalidateQueries({ queryKey: progressKey });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekId, user?.id, weekLoaded]);

  const markComplete = useCallback(async () => {
    if (!weekId || !user) return;
    setCompleting(true);
    const { error } = await supabase
      .from("training_progress")
      .upsert(
        { user_id: user.id, training_week_id: weekId, completed_at: new Date().toISOString() },
        { onConflict: "user_id,training_week_id" }
      );
    setCompleting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: progressKey });
    queryClient.invalidateQueries({ queryKey: ["training-weeks", user.id] });
  }, [weekId, user, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  const downloadPdf = useCallback(
    async (path: string) => {
      const { data: signed, error } = await supabase.storage.from("training-pdfs").createSignedUrl(path, 60 * 10);
      if (error || !signed) {
        toast.error("Could not generate link");
        return;
      }
      window.open(signed.signedUrl, "_blank");
      if (weekId && user) {
        supabase
          .from("training_progress")
          .upsert(
            { user_id: user.id, training_week_id: weekId, pdf_downloaded_at: new Date().toISOString() },
            { onConflict: "user_id,training_week_id" }
          )
          .then(({ error: upErr }) => {
            if (upErr) console.error("Failed to record PDF download", upErr);
          });
      }
    },
    [weekId, user]
  );

  return {
    week: data?.week ?? null,
    elements: data?.elements ?? [],
    progress: progress ?? null,
    loading: isLoading,
    completing,
    markComplete,
    downloadPdf,
  };
}
