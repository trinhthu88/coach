import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export interface ProfileGoal {
  id: string;
  title: string;
  start_rating: number;
  current_rating: number;
  target_rating: number;
}

export interface ProfileSession {
  id: string;
  topic: string;
  start_time: string;
  status: string;
}

export interface ProfileDetail {
  bio: string | null;
  job_title: string | null;
  industry: string | null;
  location: string | null;
  phone: string | null;
  timezone: string | null;
  goals: string | null;
}

export interface EnrollmentHistoryRow {
  id: string;
  programme_name: string;
  cohort_name: string | null;
  status: string;
  start_date: string;
  end_date: string | null;
}

/**
 * Loads the read-only detail data (profile fields, goal ratings, recent
 * sessions) shown in the admin coachee profile drawer — none of this is
 * already present in the coachees list row.
 */
export function useCoacheeProfileDetail(coacheeId: string | undefined) {
  const [loading, setLoading] = useState(false);
  const [goals, setGoals] = useState<ProfileGoal[]>([]);
  const [sessions, setSessions] = useState<ProfileSession[]>([]);
  const [profileData, setProfileData] = useState<ProfileDetail | null>(null);
  const [enrollments, setEnrollments] = useState<EnrollmentHistoryRow[]>([]);

  useEffect(() => {
    if (!coacheeId) return;
    (async () => {
      setLoading(true);
      const [{ data: gs }, { data: rs }, { data: ss }, { data: prof }, { data: cprof }, { data: enr }] = await Promise.all([
        supabase.from("coachee_goals").select("id, title").eq("coachee_id", coacheeId).eq("status", "active").order("sort_order"),
        supabase.from("coachee_goal_ratings").select("goal_id, start_rating, current_rating, target_rating").eq("coachee_id", coacheeId),
        supabase.from("sessions").select("id, topic, start_time, status").eq("coachee_id", coacheeId).order("start_time", { ascending: false }).limit(10),
        supabase.from("profiles").select("bio").eq("id", coacheeId).maybeSingle(),
        supabase.from("coachee_profiles").select("job_title, industry, location, phone, timezone, goals").eq("id", coacheeId).maybeSingle(),
        // Full enrollment history — Part 2 of the enrollment-cardinality fix
        // (RULES.md §3 note): a coachee can now have multiple rows over time
        // (one active + any number completed), so this must list all of
        // them, not just whichever one a plain unordered query returns first.
        supabase
          .from("programme_enrollments")
          .select("id, status, start_date, end_date, programmes(name), cohorts(name)")
          .eq("coachee_id", coacheeId)
          .order("start_date", { ascending: false }),
      ]);
      const ratingByGoal = new Map((rs || []).map((r) => [r.goal_id, r]));
      setGoals(
        (gs || []).map((g) => {
          const r = ratingByGoal.get(g.id) || ({} as Partial<Tables<"coachee_goal_ratings">>);
          return {
            id: g.id,
            title: g.title,
            start_rating: r.start_rating ?? 30,
            current_rating: r.current_rating ?? 30,
            target_rating: r.target_rating ?? 80,
          };
        })
      );
      setSessions((ss || []) as ProfileSession[]);
      setProfileData({
        bio: prof?.bio ?? null,
        job_title: cprof?.job_title ?? null,
        industry: cprof?.industry ?? null,
        location: cprof?.location ?? null,
        phone: cprof?.phone ?? null,
        timezone: cprof?.timezone ?? null,
        goals: cprof?.goals ?? null,
      });
      setEnrollments(
        (enr || []).map((e) => ({
          id: e.id,
          programme_name: (e.programmes as { name: string } | null)?.name ?? "—",
          cohort_name: (e.cohorts as { name: string } | null)?.name ?? null,
          status: e.status,
          start_date: e.start_date,
          end_date: e.end_date,
        }))
      );
      setLoading(false);
    })();
  }, [coacheeId]);

  return { loading, goals, sessions, profileData, enrollments };
}
