import { useEffect, useState, useCallback } from "react";
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

type SlotType = "coaching" | "peer";

interface Slot {
  id: string;
  slot_date: string; // yyyy-MM-dd
  start_time: string; // HH:mm:ss
  end_time: string;
  is_booked: boolean;
  slot_type: SlotType;
}

export default function CoachAvailability() {
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
      toast({ title: "Failed to load", description: error.message, variant: "destructive" });
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
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    } else {
      toast({
        title: checked ? "Peer coaching enabled" : "Peer coaching disabled",
        description: checked
          ? "Other coaches can now book your peer slots."
          : "Your peer slots are hidden from peers.",
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
        title: "Invalid time",
        description: "End time must be after start time.",
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
      toast({ title: "Add failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Slot added" });
      await load();
    }
    setAdding(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("coach_availability").delete().eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Slot removed" });
      await load();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Coach</p>
          <h1 className="text-3xl font-semibold tracking-tight">My availability</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Set the time slots when coachees can book sessions with you.
          </p>
        </div>
        <Button onClick={() => setBulkOpen(true)} className="shadow-glow">
          <CalendarRange className="mr-1 h-4 w-4" /> Set weekly template
        </Button>
      </div>

      <BulkAvailabilityDialog open={bulkOpen} onOpenChange={setBulkOpen} onCreated={load} />

      {/* Peer coaching opt-in */}
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10 text-success">
            <MessagesSquare className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold">Available for peer coaching</p>
            <p className="text-xs text-muted-foreground">
              When on, other coaches can book your <strong>peer</strong> slots to be coached by you.
              Your coaching slots stay reserved for coachees.
            </p>
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
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div
                  key={d}
                  className="px-2 py-1 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
                >
                  {d}
                </div>
              ))}
              {days.map((d) => {
                const key = format(d, "yyyy-MM-dd");
                const count = slotsByDate[key]?.length ?? 0;
                const inMonth = isSameMonth(d, month);
                const isSelected = selectedDate && isSameDay(d, selectedDate);
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedDate(d)}
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
                      <span
                        className={cn(
                          "text-[10px] font-semibold",
                          isSelected ? "text-primary-foreground/80" : "text-primary"
                        )}
                      >
                        {count} slot{count > 1 ? "s" : ""}
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
            <h3 className="font-semibold">
              {selectedDate ? format(selectedDate, "EEEE, MMM d") : "Pick a day"}
            </h3>
          </div>

          {!selectedDate ? (
            <p className="text-sm text-muted-foreground">
              Select a day on the calendar to manage time slots.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                {selectedSlots.length === 0 && (
                  <p className="text-sm text-muted-foreground">No slots yet for this day.</p>
                )}
                {selectedSlots.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between rounded-lg border p-2.5"
                  >
                    <div className="text-sm">
                      {s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)}
                      {s.is_booked && (
                        <Badge variant="secondary" className="ml-2 text-[10px]">
                          Booked
                        </Badge>
                      )}
                    </div>
                    {!s.is_booked && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(s.id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              <div className="space-y-2 border-t pt-4">
                <Label>Add a slot</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className="w-28"
                  />
                  <span className="text-muted-foreground">–</span>
                  <Input
                    type="time"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    className="w-28"
                  />
                  <Button size="sm" onClick={handleAddSlot} disabled={adding}>
                    {adding ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Add
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
