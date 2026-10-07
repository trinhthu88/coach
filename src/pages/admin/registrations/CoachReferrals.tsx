import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NewCoachingEngagementDialog, type EngagementStart } from "@/pages/admin/cohorts/NewCoachingEngagementDialog";

export interface CoachReferral {
  id: string;
  full_name: string;
  email: string;
  status: string;
  created_at: string;
  motivation: string | null;
  referred_by_coach_id: string;
  suggested_programme_id: string | null;
  referring_coach_name: string | null;
  suggested_programme_name: string | null;
  /** The learner account, once the referral is approved. */
  learner_id: string | null;
}

/**
 * A Coach's referrals (coach_refer_client -> access_requests with
 * referred_by_coach_id) in Admin -> Registrations: who referred them and the
 * programme they suggested. "New coaching engagement" starts from one --
 * approving it first when it is still pending (approve-access-request creates
 * the account) -- with the learner, the referring Coach and the suggested
 * programme filled in.
 */
export function CoachReferrals({ onChanged }: { onChanged?: () => void }) {
  const { t } = useTranslation("admin");
  const [rows, setRows] = useState<CoachReferral[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [start, setStart] = useState<EngagementStart | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("access_requests")
      .select("id, full_name, email, status, created_at, motivation, referred_by_coach_id, suggested_programme_id")
      .not("referred_by_coach_id", "is", null)
      .in("status", ["pending", "approved"])
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(getFriendlyErrorMessage(error, t));
      setRows([]);
      setLoading(false);
      return;
    }
    const referrals = data ?? [];
    const coachIds = [...new Set(referrals.map((r) => r.referred_by_coach_id).filter(Boolean))] as string[];
    const programmeIds = [...new Set(referrals.map((r) => r.suggested_programme_id).filter(Boolean))] as string[];
    const emails = [...new Set(referrals.filter((r) => r.status === "approved").map((r) => r.email.toLowerCase()))];
    const [coachesRes, programmesRes, learnersRes] = await Promise.all([
      coachIds.length ? supabase.from("profiles").select("id, full_name").in("id", coachIds) : Promise.resolve({ data: [] }),
      programmeIds.length ? supabase.from("programmes").select("id, name").in("id", programmeIds) : Promise.resolve({ data: [] }),
      emails.length ? supabase.from("profiles").select("id, email").in("email", emails) : Promise.resolve({ data: [] }),
    ]);
    const coachName = new Map((coachesRes.data ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name]));
    const programmeName = new Map((programmesRes.data ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));
    const learnerByEmail = new Map((learnersRes.data ?? []).map((p: { id: string; email: string | null }) => [String(p.email).toLowerCase(), p.id]));
    setRows(referrals.map((r) => ({
      ...r,
      referred_by_coach_id: r.referred_by_coach_id as string,
      referring_coach_name: coachName.get(r.referred_by_coach_id as string) ?? null,
      suggested_programme_name: r.suggested_programme_id ? programmeName.get(r.suggested_programme_id) ?? null : null,
      learner_id: r.status === "approved" ? learnerByEmail.get(r.email.toLowerCase()) ?? null : null,
    })));
    setLoading(false);
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const startEngagement = async (referral: CoachReferral) => {
    let learnerId = referral.learner_id;
    if (referral.status === "pending") {
      setBusyId(referral.id);
      try {
        const { data, error } = await supabase.functions.invoke("approve-access-request", { body: { request_id: referral.id } });
        if (error) throw error;
        const result = data as { error?: string } | null;
        if (result?.error) throw new Error(result.error);
        const { data: learner } = await supabase.from("profiles").select("id").eq("email", referral.email.toLowerCase()).maybeSingle();
        learnerId = learner?.id ?? null;
        toast.success(t("registrations.referrals.approved", { name: referral.full_name }));
        await load();
        onChanged?.();
      } catch (err) {
        toast.error(getFriendlyErrorMessage(err, t));
        setBusyId(null);
        return;
      }
      setBusyId(null);
    }
    setStart({ learnerId, coachId: referral.referred_by_coach_id, programmeId: referral.suggested_programme_id });
  };

  return (
    <Card className="p-4" data-testid="coach-referrals">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{t("registrations.referrals.title")}</h2>
        <span className="text-[11px] text-muted-foreground">{t("registrations.referrals.hint")}</span>
      </div>
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">{t("registrations.referrals.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">{t("registrations.referrals.name")}</th>
                <th className="px-3 py-2 text-left">{t("registrations.referrals.referredBy")}</th>
                <th className="px-3 py-2 text-left">{t("registrations.referrals.suggestedProgramme")}</th>
                <th className="px-3 py-2 text-left">{t("registrations.referrals.received")}</th>
                <th className="px-3 py-2 text-left">{t("registrations.referrals.status")}</th>
                <th className="px-3 py-2 text-right">{t("registrations.referrals.action")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t" data-testid={`referral-${r.id}`}>
                  <td className="px-3 py-2">
                    <p className="font-semibold">{r.full_name}</p>
                    <p className="text-[11px] text-muted-foreground">{r.email}</p>
                  </td>
                  <td className="px-3 py-2">{r.referring_coach_name ?? "—"}</td>
                  <td className="px-3 py-2">{r.suggested_programme_name ?? <span className="italic text-muted-foreground">{t("registrations.referrals.noProgramme")}</span>}</td>
                  <td className="px-3 py-2 text-muted-foreground">{format(new Date(r.created_at), "PP")}</td>
                  <td className="px-3 py-2">
                    <Badge variant={r.status === "approved" ? "default" : "secondary"}>{t(`registrations.referrals.statusLabels.${r.status}`)}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => startEngagement(r)}>
                      {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                      {r.status === "pending" ? t("registrations.referrals.approveAndStart") : t("cohorts.engagement.newEngagement")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NewCoachingEngagementDialog
        open={start != null}
        onOpenChange={(open) => { if (!open) setStart(null); }}
        onCreated={() => { setStart(null); onChanged?.(); }}
        initial={start ?? undefined}
      />
    </Card>
  );
}
