import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const ADMIN_PEER_DYADS_KEY = "admin-peer-dyads";

export interface PeerDyadEnrollment {
  id: string;
  userId: string;
  displayName: string;
  status: string;
}

export interface AdminPeerDyad {
  id: string;
  status: "active" | "closed";
  members: PeerDyadEnrollment[];
}

interface EnrollmentRow {
  id: string;
  user_id: string;
  status: string;
}

export function useAdminPeerDyads(cohortId: string | undefined) {
  return useQuery({
    queryKey: [ADMIN_PEER_DYADS_KEY, cohortId],
    enabled: !!cohortId,
    queryFn: async (): Promise<{ enrollments: PeerDyadEnrollment[]; dyads: AdminPeerDyad[] }> => {
      // The generated Supabase type file predates this forward migration.
      // Keep the new table access isolated until generated types are refreshed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = supabase as any;
      const { data: cohort, error: cohortError } = await client
        .from("cohorts")
        .select("programme_id")
        .eq("id", cohortId!)
        .maybeSingle();
      if (cohortError) throw cohortError;
      if (!cohort?.programme_id) return { enrollments: [], dyads: [] };

      const { data: enrollmentRows, error: enrollmentError } = await client
        .from("programme_enrollments")
        .select("id, user_id, status")
        .eq("cohort_id", cohortId!)
        .eq("programme_id", cohort.programme_id)
        .in("status", ["active", "at_risk"])
        .order("start_date");
      if (enrollmentError) throw enrollmentError;

      const rows = (enrollmentRows ?? []) as EnrollmentRow[];
      const userIds = [...new Set(rows.map((row) => row.user_id))];
      const { data: profiles, error: profileError } = userIds.length
        ? await client.from("profiles").select("id, full_name").in("id", userIds)
        : { data: [], error: null };
      if (profileError) throw profileError;
      const names = new Map((profiles ?? []).map((profile: { id: string; full_name: string | null }) => [profile.id, profile.full_name ?? "Unnamed learner"]));
      const enrollments = rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        displayName: names.get(row.user_id) ?? "Unnamed learner",
        status: row.status,
      }));
      const byId = new Map(enrollments.map((row) => [row.id, row]));

      const { data: dyadRows, error: dyadError } = await client
        .from("peer_dyads")
        .select("id, status, peer_dyad_members(enrollment_id, status)")
        .eq("cohort_id", cohortId!)
        .eq("programme_id", cohort.programme_id)
        .order("created_at");
      if (dyadError) throw dyadError;
      const dyads = (dyadRows ?? []).map((dyad: { id: string; status: "active" | "closed"; peer_dyad_members?: { enrollment_id: string; status: string }[] }) => ({
        id: dyad.id,
        status: dyad.status,
        members: (dyad.peer_dyad_members ?? [])
          .filter((member) => member.status === "active")
          .map((member) => byId.get(member.enrollment_id))
          .filter((member): member is PeerDyadEnrollment => !!member),
      }));
      return { enrollments, dyads };
    },
  });
}

export function useCreatePeerDyad(cohortId: string | undefined, programmeId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ leftEnrollmentId, rightEnrollmentId }: { leftEnrollmentId: string; rightEnrollmentId: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("admin_create_peer_dyad", {
        p_cohort_id: cohortId,
        p_programme_id: programmeId,
        p_left_enrollment_id: leftEnrollmentId,
        p_right_enrollment_id: rightEnrollmentId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ADMIN_PEER_DYADS_KEY, cohortId] });
      queryClient.invalidateQueries({ queryKey: ["eligible-peer-partners"] });
    },
  });
}
