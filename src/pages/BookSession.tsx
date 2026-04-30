import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronRightCircle,
  AlertCircle,
  Loader2,
  Globe,
  ShieldCheck,
  Info,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { addDays, format, startOfDay } from "date-fns";
import { toast } from "sonner";

interface CoachDetail {
  id: string;
  title: string | null;
  specialties: string[] | null;
  years_experience: number | null;
  country_based: string | null;
  nationality: string | null;
  rating_avg: number;
  sessions_completed: number;
  diplomas_certifications: string[] | null;
  profiles: {
    full_name: string;
    avatar_url: string | null;
    bio: string | null;
  } | null;
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

export default function BookSession() {
  const { coachId } = useParams<{ coachId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [coach, setCoach] = useState<CoachDetail | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);

  const [duration, setDuration] = useState<number>(45);
  const [weekStart, setWeekStart] = useState<Date>(() => startOfDay(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [usage, setUsage] = useState<{ monthly_limit: number; used_this_month: number } | null>(
    null
  );

  useEffect(() => {
    if (!coachId) return;
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [{ data: coachData }, { data: slotData }] = await Promise.all([
        supabase
          .from("coach_profiles")
          .select(
            "id, title, specialties, years_experience, country_based, nationality, rating_avg, sessions_completed, diplomas_certifications, profiles!inner(full_name, avatar_url, bio)"
          )
          .eq("id", coachId)
          .maybeSingle(),
        supabase
          .from("coach_availability")
          .select("id, slot_date, start_time, end_time")
          .eq("coach_id", coachId)
          .eq("is_booked", false)
          .gte("slot_date", today)
          .order("slot_date")
          .order("start_time"),
      ]);
      setCoach(coachData as unknown as CoachDetail | null);
      setSlots((slotData as Slot[]) || []);

      if (user) {
        const { data: u } = await supabase.rpc("get_coachee_session_usage", {
          _coachee_id: user.id,
        });
        if (u && u.length) setUsage(u[0]);
      }
      setLoading(false);
    })();
  }, [coachId, user]);

  const datesWithSlots = useMemo(() => new Set(slots.map((s) => s.slot_date)), [slots]);
  const week = useMemo(
    () => Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i)),
    [weekStart]
  );

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

  useEffect(() => setSelectedStart(null), [selectedDate, duration]);

  const overLimit = usage ? usage.used_this_month >= usage.monthly_limit : false;
  const canSubmit = !!selectedDate && !!selectedStart && topic.trim().length > 0 && !overLimit;

  const handleBook = async () => {
    if (!user || !coach || !selectedDate || !selectedStart || !topic.trim()) return;
    const opt = startOptions.find((o) => o.start === selectedStart);
    if (!opt) return;
    setSubmitting(true);
    const ds = dateKey(selectedDate);
    const startISO = new Date(`${ds}T${selectedStart}:00`).toISOString();

    const { error } = await supabase.from("sessions").insert({
      coach_id: coach.id,
      coachee_id: user.id,
      topic: topic.trim(),
      start_time: startISO,
      duration_minutes: duration,
      status: "pending_coach_approval",
      slot_id: opt.slotId,
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    toast.success("Session requested. Awaiting coach confirmation.");
    navigate("/sessions");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!coach) {
    return (
      <Card className="p-12 text-center">
        <h2 className="text-xl font-semibold">Coach not found</h2>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/coaches">Back to coaches</Link>
        </Button>
      </Card>
    );
  }

  const initials = (coach.profiles?.full_name || "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="space-y-6">
      <Link
        to={`/coaches/${coach.id}`}
        className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Back to coach
      </Link>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Coach summary card */}
        <Card className="h-fit space-y-5 p-6">
          <div className="flex h-44 items-center justify-center overflow-hidden rounded-2xl bg-primary-soft text-6xl font-bold text-primary">
            {coach.profiles?.avatar_url ? (
              <img
                src={coach.profiles.avatar_url}
                alt={coach.profiles.full_name}
                className="h-full w-full object-cover"
              />
            ) : (
              initials
            )}
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{coach.profiles?.full_name}</h2>
            <p className="text-sm font-medium text-primary">{coach.title || "Coach"}</p>
          </div>
          <div className="grid grid-cols-3 gap-2 border-y py-4">
            <MiniStat
              label="Rating"
              value={
                <span className="inline-flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 fill-warning text-warning" />
                  {Number(coach.rating_avg).toFixed(1)}
                </span>
              }
            />
            <MiniStat label="Experience" value={`${coach.years_experience ?? 0} yrs`} />
            <MiniStat label="Sessions" value={String(coach.sessions_completed)} />
          </div>
          {coach.country_based && (
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Globe className="h-4 w-4 text-primary" />
              {coach.nationality ? `${coach.nationality} (Based in ${coach.country_based})` : coach.country_based}
            </p>
          )}
          <Badge className="bg-success/10 text-success hover:bg-success/10">
            <ShieldCheck className="mr-1 h-3 w-3" /> Verified expert
          </Badge>
          {usage && (
            <div className="flex items-start gap-2 rounded-xl bg-muted/40 p-3 text-xs">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                Booking a session uses <strong>1 coaching credit</strong> from your monthly balance.
                ({usage.used_this_month}/{usage.monthly_limit} used)
              </span>
            </div>
          )}
        </Card>

        {/* Booking panel */}
        <Card className="space-y-6 p-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Book Your Session</h1>
            <p className="text-sm text-muted-foreground">
              Select your preferred duration and time to get started.
            </p>
          </div>

          {overLimit && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              Monthly session limit reached ({usage?.used_this_month}/{usage?.monthly_limit}).
            </div>
          )}

          <Step number={1} label="Select duration">
            <div className="mt-3 grid grid-cols-3 gap-3">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDuration(d)}
                  className={cn(
                    "rounded-2xl border px-4 py-3.5 text-sm font-semibold transition-colors",
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
                      "rounded-2xl border py-3 text-sm font-semibold transition-colors",
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
        </Card>
      </div>
    </div>
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

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="text-center">
      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}
