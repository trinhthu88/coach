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
import { useTriadSession } from "@/hooks/triads/useTriadSession";
import type { TriadGroupEntry } from "@/hooks/triads/useMyTriads";

interface AvailabilitySlot {
  slot_date: string;
  start_time: string;
}

/**
 * Propose / accept candidate times for the group's current session. A
 * candidate never changes the session until every member accepts it (server
 * rule); the learner's own availability is offered up to the unit's
 * canonical due date.
 */
export function TriadAlternativeProposal({
  entry,
  onDone,
  listOnly = false,
}: {
  entry: TriadGroupEntry;
  onDone: () => void;
  listOnly?: boolean;
}) {
  const { t } = useTranslation("triads");
  const { user } = useAuth();
  const { proposeAlternative, acceptAlternative, isPending } = useTriadSession();
  const session = entry.session;
  const proposals = session?.pendingAlternatives ?? [];

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [mySlots, setMySlots] = useState<AvailabilitySlot[]>([]);

  useEffect(() => {
    if (!user || listOnly) return;
    let query = supabase
      .from("coachee_availability")
      .select("slot_date, start_time")
      .eq("coachee_id", user.id)
      .eq("is_booked", false)
      .gte("slot_date", format(new Date(), "yyyy-MM-dd"))
      .order("slot_date", { ascending: true });
    if (entry.dueOn) query = query.lte("slot_date", entry.dueOn);
    query.then(({ data }) => setMySlots((data ?? []) as AvailabilitySlot[]));
  }, [user, entry.dueOn, listOnly]);

  const nameBySlot = useMemo(() => new Map(entry.members.map((m) => [m.slot, m.isSelf ? t("you") : m.full_name])), [entry.members, t]);

  if (!session) return null;

  const handlePropose = async () => {
    if (!date || !time) {
      toast.error(t("alternative.dateRequired"));
      return;
    }
    const start = new Date(`${date}T${time}:00`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    try {
      await proposeAlternative({ sessionId: session.id, startTime: start.toISOString(), endTime: end.toISOString() });
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
      await acceptAlternative(proposalId);
      toast.success(t("alternative.acceptSuccess"));
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, t, { fallback: t("alternative.acceptError") }));
    }
  };

  return (
    <div className="space-y-4 rounded-[16px] border border-[#efeae1] bg-[#faf8f4] p-4">
      {!listOnly && (
        <>
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
        </>
      )}

      {proposals.length > 0 && (
        <div className={cn("space-y-2", !listOnly && "border-t border-[#efeae1] pt-3")}>
          <p className="text-[11px] font-semibold text-muted-foreground">{t("alternative.pendingHeading")}</p>
          {proposals.map((p) => (
            <div key={p.id} data-testid="triad-alternative" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card px-3 py-2 text-sm">
              <div>
                <p className="font-semibold">{format(new Date(p.startTime), "EEE, MMM d 'at' p")}</p>
                <p className="text-xs text-muted-foreground">{t("alternative.proposedBy", { name: (p.proposedBySlot != null && nameBySlot.get(p.proposedBySlot)) || "—" })}</p>
              </div>
              {p.myResponse !== "accepted" && (
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
