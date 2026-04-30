import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ChevronLeft, ChevronRight, ChevronRightCircle, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { addDays, format, startOfDay } from "date-fns";

interface BookingDialogProps {
  coachId: string;
  coachName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBooked?: () => void;
}

interface Slot {
  id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
}

const DURATIONS = [30, 45, 60] as const;

function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function minutesToTime(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function fmtTime(t: string) {
  const [h, m] = t.split(":");
  const hh = Number(h);
  const ampm = hh >= 12 ? "PM" : "AM";
  const display = hh % 12 || 12;
  return `${display}:${m} ${ampm}`;
}
function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function BookingDialog({ coachId, coachName, open, onOpenChange, onBooked }: BookingDialogProps) {
  const { user } = useAuth();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [duration, setDuration] = useState<number>(45);
  const [weekStart, setWeekStart] = useState<Date>(() => startOfDay(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [usage, setUsage] = useState<{ monthly_limit: number; used_this_month: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelectedDate(undefined);
    setSelectedStart(null);
    setTopic("");
    setWeekStart(startOfDay(new Date()));
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from("coach_availability")
        .select("id, slot_date, start_time, end_time")
        .eq("coach_id", coachId)
        .eq("is_booked", false)
        .gte("slot_date", today)
        .order("slot_date")
        .order("start_time");
      setSlots((data as Slot[]) || []);
      if (user) {
        const { data: u } = await supabase.rpc("get_coachee_session_usage", { _coachee_id: user.id });
        if (u && u.length) setUsage(u[0]);
      }
      setLoading(false);
    })();
  }, [open, coachId, user]);

  const datesWithSlots = useMemo(() => new Set(slots.map((s) => s.slot_date)), [slots]);

  const week = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const startOptions = useMemo(() => {
    if (!selectedDate) return [] as { start: string; slotId: string }[];
    const ds = dateKey(selectedDate);
    const daySlots = slots.filter((s) => s.slot_date === ds);
    const opts: { start: string; slotId: string }[] = [];
    for (const s of daySlots) {
      const startMin = timeToMinutes(s.start_time);
      const endMin = timeToMinutes(s.end_time);
      for (let m = startMin; m + duration <= endMin; m += 15) {
        opts.push({ start: minutesToTime(m), slotId: s.id });
      }
    }
    return opts;
  }, [selectedDate, slots, duration]);

  useEffect(() => {
    setSelectedStart(null);
  }, [selectedDate, duration]);

  const overLimit = usage ? usage.used_this_month >= usage.monthly_limit : false;
  const canSubmit = !!selectedDate && !!selectedStart && topic.trim().length > 0 && !overLimit;

  const handleBook = async () => {
    if (!user || !selectedDate || !selectedStart || !topic.trim()) return;
    const opt = startOptions.find((o) => o.start === selectedStart);
    if (!opt) return;
    setSubmitting(true);
    const ds = dateKey(selectedDate);
    const startISO = new Date(`${ds}T${selectedStart}:00`).toISOString();

    const { error } = await supabase.from("sessions").insert({
      coach_id: coachId,
      coachee_id: user.id,
      topic: topic.trim(),
      start_time: startISO,
      duration_minutes: duration,
      status: "pending_coach_approval",
      slot_id: opt.slotId,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Session requested. Awaiting coach confirmation.");
    onOpenChange(false);
    onBooked?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Book Your Session</DialogTitle>
          <DialogDescription>
            Select your preferred duration and time with {coachName} to get started.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-6">
            {usage && (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                  overLimit
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-border bg-muted/40 text-muted-foreground"
                )}
              >
                {overLimit && <AlertCircle className="h-4 w-4" />}
                <span>
                  This month: <strong>{usage.used_this_month}</strong> / {usage.monthly_limit} sessions
                </span>
              </div>
            )}

            {/* Step 1: Duration */}
            <Step number={1} label="Select duration">
              <div className="mt-3 grid grid-cols-3 gap-3">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuration(d)}
                    className={cn(
                      "rounded-full border px-4 py-3 text-sm font-semibold transition-colors",
                      duration === d
                        ? "border-primary bg-primary text-primary-foreground shadow-glow"
                        : "border-border bg-card hover:border-primary/40"
                    )}
                  >
                    {d} Minutes
                  </button>
                ))}
              </div>
            </Step>

            {/* Step 2: Date strip */}
            <Step number={2} label="Select date">
              <div className="mt-3 flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setWeekStart(addDays(weekStart, -7))}
                  disabled={weekStart <= startOfDay(new Date())}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="grid flex-1 grid-cols-7 gap-2">
                  {week.map((d) => {
                    const ds = dateKey(d);
                    const has = datesWithSlots.has(ds);
                    const isPast = d < startOfDay(new Date());
                    const disabled = !has || isPast;
                    const isSelected = selectedDate && dateKey(selectedDate) === ds;
                    return (
                      <button
                        key={ds}
                        type="button"
                        disabled={disabled}
                        onClick={() => setSelectedDate(d)}
                        className={cn(
                          "rounded-2xl border py-3 text-center transition-colors",
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground shadow-glow"
                            : disabled
                            ? "border-border bg-muted/30 text-muted-foreground/50"
                            : "border-border bg-card hover:border-primary/40"
                        )}
                      >
                        <div className="text-[10px] font-bold uppercase tracking-widest opacity-80">
                          {format(d, "EEE")}
                        </div>
                        <div className="text-xl font-semibold">{format(d, "d")}</div>
                      </button>
                    );
                  })}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setWeekStart(addDays(weekStart, 7))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </Step>

            {/* Step 3: Time */}
            <Step
              number={3}
              label={`Select time (${Intl.DateTimeFormat().resolvedOptions().timeZone})`}
            >
              {!selectedDate ? (
                <p className="mt-3 text-sm text-muted-foreground">Pick a date above to see times.</p>
              ) : startOptions.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  No {duration}-minute window available on this day.
                </p>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {startOptions.map((o) => (
                    <button
                      key={`${o.slotId}-${o.start}`}
                      type="button"
                      onClick={() => setSelectedStart(o.start)}
                      className={cn(
                        "rounded-xl border py-2.5 text-sm font-medium transition-colors",
                        selectedStart === o.start
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card hover:border-primary/40"
                      )}
                    >
                      {fmtTime(o.start)}
                    </button>
                  ))}
                </div>
              )}
            </Step>

            {/* Topic */}
            <div>
              <Label
                htmlFor="topic"
                className="text-xs font-bold uppercase tracking-widest text-muted-foreground"
              >
                Coaching topic
              </Label>
              <Textarea
                id="topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="What would you like to focus on in this session?"
                className="mt-2"
                rows={3}
              />
            </div>

            {/* Footer summary */}
            <div className="flex flex-col items-start justify-between gap-3 border-t pt-4 sm:flex-row sm:items-center">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Selected schedule
                </p>
                <p className="mt-1 flex items-center gap-2 font-semibold">
                  {selectedDate && selectedStart
                    ? `${format(selectedDate, "EEE, MMM d")} · ${fmtTime(selectedStart)}`
                    : "Select a time slot"}
                  <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-success">
                    {duration} min
                  </span>
                </p>
              </div>
              <Button
                onClick={handleBook}
                disabled={!canSubmit || submitting}
                size="lg"
                className="shadow-glow"
              >
                {submitting ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <ChevronRightCircle className="mr-1 h-4 w-4" />
                )}
                Confirm Booking
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Step({
  number,
  label,
  children,
}: {
  number: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary">
          {number}
        </span>
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}
