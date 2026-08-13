import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ProgrammeInfo, SessionUsage } from "./types";

interface JourneyProgrammeData {
  programme: ProgrammeInfo | null;
  usage: SessionUsage | null;
}

async function fetchJourneyProgramme(coacheeId: string): Promise<JourneyProgrammeData> {
  const [{ data: u }, { data: enr }] = await Promise.all([
    supabase.rpc("get_coachee_session_usage", { _coachee_id: coacheeId }),
    supabase
      .from("programme_enrollments")
      .select("id, start_date, end_date, programme_id, programmes(name, coachee_session_limit, duration_months)")
      .eq("coachee_id", coacheeId)
      .eq("status", "active")
      .order("start_date", { ascending: false })
      .limit(1),
  ]);
  const usageRow = Array.isArray(u) ? u[0] : u;

  const e = (enr || [])[0];
  const programme: ProgrammeInfo | null =
    e && e.programmes
      ? {
          enrollmentId: e.id,
          programmeName: e.programmes.name,
          startDate: e.start_date,
          endDate: e.end_date,
          sessionsAllowed: e.programmes.coachee_session_limit ?? 0,
          durationMonths: e.programmes.duration_months ?? 0,
        }
      : null;

  return { programme, usage: usageRow ?? null };
}

/**
 * Owns the active programme enrollment + monthly session usage quota for a
 * coachee. Shared between the coachee and coach "my journey" views.
 */
export function useJourneyProgramme(coacheeId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["journey-programme", coacheeId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchJourneyProgramme(coacheeId as string),
    enabled: !!coacheeId,
    staleTime: 30_000,
  });

  return {
    programme: data?.programme ?? null,
    usage: data?.usage ?? null,
    loading: isLoading,
    refresh: () => queryClient.invalidateQueries({ queryKey }),
  };
}
