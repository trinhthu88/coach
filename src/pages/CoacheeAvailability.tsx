import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, Loader2, Plus, Trash2, CalendarDays, MessagesSquare } from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
} from "date-fns";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { getFriendlyErrorMessage } from "@/lib/errors";

interface Slot {
  id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  is_booked: boolean;
}

/**
 * Coachee equivalent of CoachAvailability.tsx — same calendar/add/delete
 * mechanics, simplified since this pool only ever has one slot "type"
 * (peer practice), so there's no slot_type selector or legend.
 */
export default function CoacheeAvailability() {
  const { t } = useTranslation("dashboard");
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(new Date());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [adding, setAdding] = useState(false);
  const [peerOptIn, setPeerOptIn] = useState(false);
  const [savingOptIn, setSavingOptIn] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const from = format(startOfMonth(month), "yyyy-MM-dd");
    const to = format(endOfMonth(month), "yyyy-MM-dd");
    const { data, error } = await supabase
      .from("coachee_availability")
      .select("*")
      .eq("coachee_id", user.id)
      .gte("slot_date", from)
      .lte("slot_date", to)
      .order("slot_date")
      .order("start_time");
    if (error) {
      toast({ title: t("availability.toast.loadFailedTitle"), description: getFriendlyErrorMessage(error, t), variant: "destructive" });
    } else {
      setSlots((data ?? []) as Slot[]);
    }
    setLoading(false);
  }, [user, month, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("profiles").select("peer_coaching_opt_in").eq("id", user.id).maybeSingle();
      setPeerOptIn(!!data?.peer_coaching_opt_in);
    })();
  }, [user]);

  const handleTogglePeer = async (checked: boolean) => {
    if (!user) return;
    setSavingOptIn(true);
    setPeerOptIn(checked);
    const { error } = await supabase.from("profiles").update({ peer_coaching_opt_in: checked }).eq("id", user.id);
    setSavingOptIn(false);
    if (error) {
      setPeerOptIn(!checked);
      toast({ title: t("availability.toast.updateFailedTitle"), description: getFriendlyErrorMessage(error, t), variant: "destructive" });
    } else {
      toast({
        title: checked ? t("availability.toast.peerEnabledTitle") : t("availability.toast.peerDisabledTitle"),
        description: checked ? t("availability.toast.peerEnabledDescription") : t("availability.toast.peerDisabledDescription"),
      });
    }
  };

  const days: Date[] = [];
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);

  const slotsByDate = slots.reduce<Record<string, Slot[]>>((acc, s) => {
    (acc[s.slot_date] = acc[s.slot_date] ?? []).push(s);
    return acc;
  }, {});

  const selectedSlots = selectedDate ? slotsByDate[format(selectedDate, "yyyy-MM-dd")] ?? [] : [];

  const handleAddSlot = async () => {
    if (!user || !selectedDate) return;
    if (start >= end) {
      toast({ title: t("availability.toast.invalidTimeTitle"), description: t("availability.toast.invalidTimeDescription"), variant: "destructive" });
      return;
    }
    const overlaps = selectedSlots.some((s) => start < s.end_time.slice(0, 5) && s.start_time.slice(0, 5) < end);
    if (overlaps) {
      toast({ title: t("availability.toast.overlapTitle"), description: t("availability.toast.overlapDescription"), variant: "destructive" });
      return;
    }
    setAdding(true);
    const { error } = await supabase.from("coachee_availability").insert({
      coachee_id: user.id,
      slot_date: format(selectedDate, "yyyy-MM-dd"),
      start_time: start + ":00",
      end_time: end + ":00",
    });
    if (error) {
      toast({ title: t("availability.toast.addFailedTitle"), description: getFriendlyErrorMessage(error, t), variant: "destructive" });
    } else {
      toast({ title: t("availability.toast.slotAddedTitle") });
      await load();
    }
    setAdding(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("coachee_availability").delete().eq("id", id);
    if (error) {
      toast({ title: t("availability.toast.deleteFailedTitle"), description: getFriendlyErrorMessage(error, t), variant: "destructive" });
    } else {
      toast({ title: t("availability.toast.slotRemovedTitle") });
      await load();
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("coacheeAvailability.eyebrow")}
        title={t("coacheeAvailability.titleLead")}
        emphasis={t("coacheeAvailability.titleEmphasis")}
        subtitle={t("coacheeAvailability.subtitle")}
      />

      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <MessagesSquare className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold">{t("coacheeAvailability.peerOptIn.title")}</p>
            <p className="text-xs text-muted-foreground">{t("coacheeAvailability.peerOptIn.body")}</p>
          </div>
        </div>
        <Switch checked={peerOptIn} onCheckedChange={handleTogglePeer} disabled={savingOptIn} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => setMonth(subMonths(month, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h2 className="text-lg font-semibold">{format(month, "MMMM yyyy")}</h2>
            <Button variant="ghost" size="sm" onClick={() => setMonth(addMonths(month, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {(["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map((d) => (
                <div key={d} className="px-2 py-1 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t(`availability.weekdays.${d}`)}
                </div>
              ))}
              {days.map((d) => {
                const key = format(d, "yyyy-MM-dd");
                const daySlots = slotsByDate[key] ?? [];
                const count = daySlots.length;
                const inMonth = isSameMonth(d, month);
                const isSelected = selectedDate && isSameDay(d, selectedDate);
                const dayLabel =
                  count > 0
                    ? t("coacheeAvailability.dayLabelWithSlots", { date: format(d, "MMMM d"), count })
                    : t("availability.dayLabelEmpty", { date: format(d, "MMMM d") });
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedDate(d)}
                    aria-label={dayLabel}
                    aria-pressed={!!isSelected}
                    className={cn(
                      "flex aspect-square flex-col items-center justify-center rounded-lg border text-sm transition-colors",
                      inMonth ? "" : "opacity-40",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : count > 0
                        ? "border-primary/40 bg-primary-soft hover:bg-primary-soft/80"
                        : "border-border hover:bg-muted"
                    )}
                  >
                    <span>{format(d, "d")}</span>
                    {count > 0 && (
                      <span className={cn("text-[10px] font-semibold", isSelected ? "text-primary-foreground/80" : "text-primary")}>
                        {t("availability.slotCount", { count })}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">{selectedDate ? format(selectedDate, "EEEE, MMM d") : t("availability.pickADay")}</h3>
          </div>

          {!selectedDate ? (
            <p className="text-sm text-muted-foreground">{t("availability.selectDayPrompt")}</p>
          ) : (
            <>
              <div className="space-y-2">
                {selectedSlots.length === 0 && <p className="text-sm text-muted-foreground">{t("availability.noSlotsForDay")}</p>}
                {selectedSlots.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent/40 bg-accent/5 p-2.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm sm:gap-2">
                      <span>
                        {s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)}
                      </span>
                      {s.is_booked && (
                        <Badge variant="secondary" className="text-[10px]">
                          {t("availability.bookedBadge")}
                        </Badge>
                      )}
                    </div>
                    {!s.is_booked && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(s.id)}
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive sm:h-9 sm:w-9"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              <div className="space-y-3 border-t pt-4">
                <Label>{t("availability.addASlot")}</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-24 sm:w-28" />
                  <span className="text-muted-foreground">–</span>
                  <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-24 sm:w-28" />
                  <Button size="sm" onClick={handleAddSlot} disabled={adding} className="shrink-0">
                    {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    {t("availability.add")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
