import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface InviteProgrammeOpt { id: string; name: string }
export interface InviteCohortOpt { id: string; name: string; programme_id: string | null }
export interface InviteOrganizationOpt { id: string; name: string }

/** Programme / cohort / organization choices for the admin add-person forms. */
export function useInviteOptions(enabled: boolean) {
  const [programmes, setProgrammes] = useState<InviteProgrammeOpt[]>([]);
  const [cohorts, setCohorts] = useState<InviteCohortOpt[]>([]);
  const [organizations, setOrganizations] = useState<InviteOrganizationOpt[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    Promise.all([
      supabase.from("programmes").select("id, name").eq("is_active", true).order("name"),
      supabase.from("cohorts").select("id, name, programme_id").order("name"),
      supabase.from("organizations").select("id, name").order("name"),
    ]).then(([p, c, o]) => {
      if (cancelled) return;
      setProgrammes(p.data ?? []);
      setCohorts(c.data ?? []);
      setOrganizations(o.data ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { programmes, cohorts, organizations };
}
