import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

export interface ReflectionAssignment {
  id: string;
  training_week_id: string;
  title: string;
  title_vi: string | null;
  instructions: string | null;
  instructions_vi: string | null;
}

export function useReflection(assignmentId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["reflection", assignmentId, user?.id],
    queryFn: async () => {
      const [{ data: assignment, error: aError }, { data: submission, error: sError }] = await Promise.all([
        supabase
          .from("assignments")
          .select("id, training_week_id, title, title_vi, instructions, instructions_vi")
          .eq("id", assignmentId as string)
          .maybeSingle(),
        supabase
          .from("assignment_submissions")
          .select("reflection_text, submitted_at")
          .eq("assignment_id", assignmentId as string)
          .eq("user_id", user!.id)
          .maybeSingle(),
      ]);
      if (aError) throw aError;
      if (sError) throw sError;

      return {
        assignment: (assignment as ReflectionAssignment | null) ?? null,
        submission: submission ?? null,
      };
    },
    enabled: !!assignmentId && !!user,
  });

  const submit = useCallback(
    async (reflectionText: string) => {
      if (!assignmentId || !user) return;
      setSubmitting(true);
      const { error } = await supabase.from("assignment_submissions").upsert(
        {
          assignment_id: assignmentId,
          user_id: user.id,
          reflection_text: reflectionText,
        },
        { onConflict: "assignment_id,user_id" }
      );
      setSubmitting(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["reflection", assignmentId, user.id] });
      queryClient.invalidateQueries({ queryKey: ["assignments", data?.assignment?.training_week_id, user.id] });
    },
    [assignmentId, user, queryClient, data?.assignment?.training_week_id]
  );

  return {
    assignment: data?.assignment ?? null,
    submission: data?.submission ?? null,
    loading: isLoading,
    submitting,
    submit,
  };
}
