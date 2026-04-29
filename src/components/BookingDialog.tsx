import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Clock, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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

export default function BookingDialog({ coachId, coachName, open, onOpenChange, onBooked }: BookingDialogProps) {
  const { user } = useAuth();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [duration, setDuration] = useState<number>(60);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [usage, setUsage] = useState<{ monthly_limit: number; used_this_month: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
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

  const datesWithSlots = useMemo(() => {
    const set = new Set(slots.map((s) => s.slot_date));
    return set;
  }, [slots]);

  // Generate possible start times for selected date that fit the chosen duration inside an availability window
  const startOptions = useMemo(() => {
    if (!selectedDate) return [] as { start: string; slotId: string }[];
    const dateStr = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`;
    const daySlots = slots.filter((s) => s.slot_date === dateStr);
    const opts: { start: string; slotId: string }[] = [];
    for (const s of daySlots) {
      const startMin = timeToMinutes(s.start_time);
      const endMin = timeToMinutes(s.end_time);
      // 15-minute granularity
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

  const handleBook = async () => {
    if (!user || !selectedDate || !selectedStart || !topic.trim()) return;
    const opt = startOptions.find((o) => o.start === selectedStart);
    if (!opt) return;
    setSubmitting(true);
    const dateStr = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`;
    const startISO = new Date(`${dateStr}T${selectedStart}:00`).toISOString();

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
    setTopic("");
    setSelectedDate(undefined);
    setSelectedStart(null);
    onBooked?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Book a session with {coachName}</DialogTitle>
          <DialogDescription>
            Pick a duration, then choose a date and time from {coachName}'s availability.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-5">
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

            <div>
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Duration
              </Label>
              <div className="mt-2 flex gap-2">
                {DURATIONS.map((d) => (
                  <Button
                    key={d}
                    type="button"
                    variant={duration === d ? "default" : "outline"}
                    onClick={() => setDuration(d)}
                    className="flex-1"
                  >
                    <Clock className="mr-1 h-4 w-4" /> {d} min
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Date
                </Label>
                <div className="mt-2 rounded-lg border">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={setSelectedDate}
                    disabled={(date) => {
                      const ds = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
                      return !datesWithSlots.has(ds) || date < new Date(new Date().toDateString());
                    }}
                  />
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Time
                  </Label>
                  {!selectedDate ? (
                    <p className="mt-2 text-sm text-muted-foreground">Pick a date first.</p>
                  ) : startOptions.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      No {duration}-minute window available on this day.
                    </p>
                  ) : (
                    <div className="mt-2 grid max-h-56 grid-cols-2 gap-2 overflow-y-auto pr-1">
                      {startOptions.map((o) => (
                        <Button
                          key={`${o.slotId}-${o.start}`}
                          type="button"
                          size="sm"
                          variant={selectedStart === o.start ? "default" : "outline"}
                          onClick={() => setSelectedStart(o.start)}
                        >
                          {fmtTime(o.start)}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="topic" className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
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
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleBook}
            disabled={
              submitting ||
              loading ||
              overLimit ||
              !selectedDate ||
              !selectedStart ||
              !topic.trim()
            }
          >
            {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Request session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
