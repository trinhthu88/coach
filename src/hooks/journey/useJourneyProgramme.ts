import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ProgrammeInfo, SessionUsage } from "./types";

/**
 * Owns the active programme enrollment + monthly session usage quota for a
 * coachee. Shared between the coachee and coach "my journey" views.
 */
export function useJourneyProgramme(coacheeId: string | undefined) {
  const [programme, setProgramme] = useState<ProgrammeInfo | null>(null);
  const [usage, setUsage] = useState<SessionUsage | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!coacheeId) return;
    setLoading(true);
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
    setUsage(usageRow ?? null);

    const e = (enr || [])[0];
    if (e && e.programmes) {
      setProgramme({
        enrollmentId: e.id,
        programmeName: e.programmes.name,
        startDate: e.start_date,
        endDate: e.end_date,
        sessionsAllowed: e.programmes.coachee_session_limit ?? 0,
        durationMonths: e.programmes.duration_months ?? 0,
      });
    } else {
      setProgramme(null);
    }
    setLoading(false);
  }, [coacheeId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { programme, usage, loading, refresh };
}
