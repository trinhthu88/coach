import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { useTriadAlternativeProposals, useTriadSession } from "@/hooks/triads/useTriadSession";
import type { TriadGroupMembers, TriadMemberProfile } from "@/hooks/triads/useMyTriads";

interface AvailabilitySlot {
  slot_date: string;
  start_time: string;
}

export function TriadAlternativeProposal({
  sessionId,
  group,
  members,
  deadline,
  onDone,
}: {
  sessionId: string;
  group: TriadGroupMembers;
  members: TriadMemberProfile[];
  deadline: string;
  onDone: () => void;
}) {
  const { t } = useTranslation("triads");
  const { user } = useAuth();
  const { proposeAlternative, acceptAlternative, isPending } = useTriadSession();
  const { proposals } = useTriadAlternativeProposals(sessionId);

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [mySlots, setMySlots] = useState<AvailabilitySlot[]>([]);

  useEffect(() => {
    if (!user) return;
    const windowStart = format(new Date(new Date(`${deadline}T00:00:00Z`).getTime() - 7 * 86400000), "yyyy-MM-dd");
    supabase
      .from("coachee_availability")
      .select("slot_date, start_time")
      .eq("coachee_id", user.id)
      .eq("is_booked", false)
      .gte("slot_date", windowStart)
      .lte("slot_date", deadline)
      .order("slot_date", { ascending: true })
      .then(({ data }) => setMySlots((data ?? []) as AvailabilitySlot[]));
  }, [user, deadline]);

  const nameById = useMemo(() => new Map(members.map((m) => [m.id, m.full_name])), [members]);

  const handlePropose = async () => {
    if (!date || !time) {
      toast.error(t("alternative.dateRequired"));
      return;
    }
    const start = new Date(`${date}T${time}:00`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    try {
      await proposeAlternative({ sessionId, group, startTime: start.toISOString(), endTime: end.toISOString() });
      toast.success(t("alternative.successToast"));
      setDate("");
      setTime("");
      onDone();
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, t, { fallback: t("alternative.errorToast") }));
    }
  };

  const handleAccept = async (proposalId: string) => {
    try {
      await acceptAlternative({ proposalId, sessionId, group });
      toast.success(t("alternative.acceptSuccess"));
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, t, { fallback: t("alternative.acceptError") }));
    }
  };

  return (
    <div className="mt-4 space-y-4 rounded-[16px] border border-[#efeae1] bg-[#faf8f4] p-4">
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-muted-foreground">{t("alternative.title")}</p>

      {mySlots.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">{t("alternative.yourAvailability")}</p>
          <div className="flex flex-wrap gap-1.5">
            {mySlots.slice(0, 12).map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setDate(s.slot_date);
                  setTime(s.start_time.slice(0, 5));
                }}
                className={cn(
                  "rounded-full border border-[#dcd5c9] bg-card px-2.5 py-1 text-[11px] transition-colors hover:border-primary hover:text-primary",
                  date === s.slot_date && time === s.start_time.slice(0, 5) && "border-primary bg-primary-soft text-primary",
                )}
              >
                {format(new Date(`${s.slot_date}T00:00:00`), "MMM d")} · {s.start_time.slice(0, 5)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t("alternative.pickDate")} className="border-[#dcd5c9] bg-card" />
        <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label={t("alternative.pickTime")} className="border-[#dcd5c9] bg-card" />
      </div>
      <button
        type="button"
        onClick={handlePropose}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-xl bg-secondary px-[18px] py-[11px] text-xs font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-50"
      >
        {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {t("alternative.submit")}
      </button>

      {proposals.length > 0 && (
        <div className="space-y-2 border-t border-[#efeae1] pt-3">
          <p className="text-[11px] font-semibold text-muted-foreground">{t("alternative.pendingHeading")}</p>
          {proposals.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card px-3 py-2 text-sm">
              <div>
                <p className="font-semibold">{format(new Date(p.proposed_start_time), "EEE, MMM d 'at' p")}</p>
                <p className="text-xs text-muted-foreground">{t("alternative.proposedBy", { name: nameById.get(p.proposed_by) || "—" })}</p>
              </div>
              {p.proposed_by !== user?.id && (
                <button
                  type="button"
                  onClick={() => handleAccept(p.id)}
                  disabled={isPending}
                  className="rounded-xl border border-border bg-card px-[14px] py-2 text-xs font-semibold transition-colors hover:border-primary hover:text-[#2c8fa8] disabled:opacity-50"
                >
                  {t("alternative.accept")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
