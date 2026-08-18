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
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Trash2,
  CalendarDays,
  CalendarRange,
  MessagesSquare,
} from "lucide-react";
import BulkAvailabilityDialog from "@/components/BulkAvailabilityDialog";
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

type SlotType = "coaching" | "peer" | "mentoring";

interface Slot {
  id: string;
  slot_date: string; // yyyy-MM-dd
  start_time: string; // HH:mm:ss
  end_time: string;
  is_booked: boolean;
  slot_type: SlotType;
}

export default function CoachAvailability() {
  const { t } = useTranslation("dashboard");
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(new Date());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [slotType, setSlotType] = useState<SlotType>("coaching");
  const [adding, setAdding] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [peerOptIn, setPeerOptIn] = useState(false);
  const [savingOptIn, setSavingOptIn] = useState(false);
  // Only active mentors (admin-set via mentor_profiles, see AdminMentoring.tsx) may
  // open mentoring slots — unlike peer coaching, this isn't a self-service opt-in.
  const [isMentor, setIsMentor] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const from = format(startOfMonth(month), "yyyy-MM-dd");
    const to = format(endOfMonth(month), "yyyy-MM-dd");
    const { data, error } = await supabase
      .from("coach_availability")
      .select("*")
      .eq("coach_id", user.id)
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
  }, [user, month]);

  useEffect(() => {
    load();
  }, [load]);

  // Load peer opt-in setting
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("coach_profiles")
        .select("peer_coaching_opt_in")
        .eq("id", user.id)
        .maybeSingle();
      setPeerOptIn(!!data?.peer_coaching_opt_in);
    })();
  }, [user]);

  // Load mentor status
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("mentor_profiles")
        .select("is_active")
        .eq("coach_user_id", user.id)
        .maybeSingle();
      setIsMentor(!!data?.is_active);
    })();
  }, [user]);

  const handleTogglePeer = async (checked: boolean) => {
    if (!user) return;
    setSavingOptIn(true);
    setPeerOptIn(checked);
    const { error } = await supabase
      .from("coach_profiles")
      .update({ peer_coaching_opt_in: checked })
      .eq("id", user.id);
    setSavingOptIn(false);
    if (error) {
      setPeerOptIn(!checked);
      toast({ title: t("availability.toast.updateFailedTitle"), description: getFriendlyErrorMessage(error, t), variant: "destructive" });
    } else {
      toast({
        title: checked ? t("availability.toast.peerEnabledTitle") : t("availability.toast.peerDisabledTitle"),
        description: checked
          ? t("availability.toast.peerEnabledDescription")
          : t("availability.toast.peerDisabledDescription"),
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

  const selectedSlots = selectedDate
    ? slotsByDate[format(selectedDate, "yyyy-MM-dd")] ?? []
    : [];

  const handleAddSlot = async () => {
    if (!user || !selectedDate) return;
    if (start >= end) {
      toast({
        title: t("availability.toast.invalidTimeTitle"),
        description: t("availability.toast.invalidTimeDescription"),
        variant: "destructive",
      });
      return;
    }
    // Same-day overlap check — the DB doesn't enforce this, so it has to happen
    // here before insert (a coach silently creating overlapping slots only used
    // to surface later as a booking-race error to a coachee, not to the coach).
    const overlaps = selectedSlots.some(
      (s) => start < s.end_time.slice(0, 5) && s.start_time.slice(0, 5) < end
    );
    if (overlaps) {
      toast({
        title: t("availability.toast.overlapTitle"),
        description: t("availability.toast.overlapDescription"),
        variant: "destructive",
      });
      return;
    }
    setAdding(true);
    const { error } = await supabase.from("coach_availability").insert({
      coach_id: user.id,
      slot_date: format(selectedDate, "yyyy-MM-dd"),
      start_time: start + ":00",
      end_time: end + ":00",
      slot_type: slotType,
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
    const { error } = await supabase.from("coach_availability").delete().eq("id", id);
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
        eyebrow={t("availability.eyebrow")}
        title={t("availability.titleLead")}
        emphasis={t("availability.titleEmphasis")}
        subtitle={t("availability.subtitle")}
        actions={
          <Button onClick={() => setBulkOpen(true)} className="rounded-xl shadow-glow">
            <CalendarRange className="mr-1 h-4 w-4" /> {t("availability.setWeeklyTemplate")}
          </Button>
        }
      />

      <BulkAvailabilityDialog open={bulkOpen} onOpenChange={setBulkOpen} onCreated={load} />

      {/* Peer coaching opt-in */}
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <MessagesSquare className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold">{t("availability.peerOptIn.title")}</p>
            <p className="text-xs text-muted-foreground">
              {t("availability.peerOptIn.bodyPrefix")} <strong>{t("availability.peerOptIn.bodyBold")}</strong> {t("availability.peerOptIn.bodySuffix")}
            </p>
          </div>
        </div>
        <Switch checked={peerOptIn} onCheckedChange={handleTogglePeer} disabled={savingOptIn} />
      </Card>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-card/40 px-4 py-2.5 text-xs text-muted-foreground">
        <span className="font-bold uppercase tracking-widest text-[10px]">{t("availability.legend.label")}</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-primary" /> {t("availability.legend.coachingSlot")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-accent" /> {t("availability.legend.peerSlot")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-secondary" /> {t("availability.legend.mentoringSlot")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-muted-foreground/30" /> {t("availability.legend.booked")}
        </span>
      </div>

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
                <div
                  key={d}
                  className="px-2 py-1 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
                >
                  {t(`availability.weekdays.${d}`)}
                </div>
              ))}
              {days.map((d) => {
                const key = format(d, "yyyy-MM-dd");
                const daySlots = slotsByDate[key] ?? [];
                const count = daySlots.length;
                const coachingCount = daySlots.filter((s) => s.slot_type === "coaching").length;
                const peerCount = daySlots.filter((s) => s.slot_type === "peer").length;
                const mentoringCount = daySlots.filter((s) => s.slot_type === "mentoring").length;
                const inMonth = isSameMonth(d, month);
                const isSelected = selectedDate && isSameDay(d, selectedDate);
                const typesPresent = [coachingCount, peerCount, mentoringCount].filter((n) => n > 0).length;
                const onlyPeer = peerCount > 0 && typesPresent === 1;
                const onlyMentoring = mentoringCount > 0 && typesPresent === 1;
                const mixed = typesPresent > 1;
                const dayLabel =
                  count > 0
                    ? t("availability.dayLabelWithSlots", {
                        date: format(d, "MMMM d"),
                        coaching: coachingCount,
                        peer: peerCount,
                        mentoring: mentoringCount,
                      })
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
                        : onlyPeer
                        ? "border-accent/40 bg-accent/10 hover:bg-accent/15"
                        : onlyMentoring
                        ? "border-secondary/40 bg-secondary/10 hover:bg-secondary/15"
                        : count > 0
                        ? "border-primary/40 bg-primary-soft hover:bg-primary-soft/80"
                        : "border-border hover:bg-muted"
                    )}
                  >
                    <span>{format(d, "d")}</span>
                    {count > 0 && (
                      <>
                        <span
                          className={cn(
                            "text-[10px] font-semibold",
                            isSelected
                              ? "text-primary-foreground/80"
                              : onlyPeer
                              ? "text-accent"
                              : onlyMentoring
                              ? "text-secondary"
                              : "text-primary"
                          )}
                        >
                          {t("availability.slotCount", { count })}
                        </span>
                        {mixed && !isSelected && (
                          <div className="mt-0.5 flex gap-0.5">
                            {coachingCount > 0 && <span className="h-1 w-1.5 rounded-full bg-primary" />}
                            {peerCount > 0 && <span className="h-1 w-1.5 rounded-full bg-accent" />}
                            {mentoringCount > 0 && <span className="h-1 w-1.5 rounded-full bg-secondary" />}
                          </div>
                        )}
                      </>
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
            <h3 className="font-semibold">
              {selectedDate ? format(selectedDate, "EEEE, MMM d") : t("availability.pickADay")}
            </h3>
          </div>

          {!selectedDate ? (
            <p className="text-sm text-muted-foreground">
              {t("availability.selectDayPrompt")}
            </p>
          ) : (
            <>
              <div className="space-y-2">
                {selectedSlots.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t("availability.noSlotsForDay")}</p>
                )}
                {selectedSlots.map((s) => (
                  <div
                    key={s.id}
                    className={cn(
                      "flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5",
                      s.slot_type === "peer"
                        ? "border-accent/40 bg-accent/5"
                        : s.slot_type === "mentoring"
                        ? "border-secondary/40 bg-secondary/5"
                        : "border-primary/30 bg-primary-soft/40"
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-1.5 text-sm sm:gap-2">
                      <span>
                        {s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)}
                      </span>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px]",
                          s.slot_type === "peer"
                            ? "bg-accent/20 text-accent-foreground"
                            : s.slot_type === "mentoring"
                            ? "bg-secondary/20 text-secondary-foreground"
                            : "bg-primary/15 text-primary"
                        )}
                      >
                        {s.slot_type === "peer"
                          ? t("availability.slotTypePeer")
                          : s.slot_type === "mentoring"
                          ? t("availability.slotTypeMentoring")
                          : t("availability.slotTypeCoaching")}
                      </Badge>
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
                <Label id="slot-type-label">{t("availability.addASlot")}</Label>
                <div role="radiogroup" aria-labelledby="slot-type-label" className="flex gap-2">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={slotType === "coaching"}
                    onClick={() => setSlotType("coaching")}
                    className={cn(
                      "flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                      slotType === "coaching"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:border-primary/40"
                    )}
                  >
                    {t("availability.slotTypeCoaching")}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={slotType === "peer"}
                    onClick={() => setSlotType("peer")}
                    disabled={!peerOptIn}
                    className={cn(
                      "flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                      slotType === "peer"
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-border hover:border-accent/40",
                      !peerOptIn && "cursor-not-allowed opacity-50"
                    )}
                    title={!peerOptIn ? t("availability.enablePeerFirst") : undefined}
                  >
                    {t("availability.slotTypePeer")}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={slotType === "mentoring"}
                    onClick={() => setSlotType("mentoring")}
                    disabled={!isMentor}
                    className={cn(
                      "flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                      slotType === "mentoring"
                        ? "border-secondary bg-secondary text-secondary-foreground"
                        : "border-border hover:border-secondary/40",
                      !isMentor && "cursor-not-allowed opacity-50"
                    )}
                    title={!isMentor ? t("availability.notAMentor") : undefined}
                  >
                    {t("availability.slotTypeMentoring")}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="time"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className="w-24 sm:w-28"
                  />
                  <span className="text-muted-foreground">–</span>
                  <Input
                    type="time"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    className="w-24 sm:w-28"
                  />
                  <Button size="sm" onClick={handleAddSlot} disabled={adding} className="shrink-0">
                    {adding ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
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
