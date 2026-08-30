import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  ChevronLeft,
  ChevronRight,
  ChevronRightCircle,
  AlertCircle,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { addDays, format, startOfDay } from "date-fns";
import { toast } from "sonner";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { computeStartOptions } from "./bookingSlots";

interface MentorDetail {
  coach_user_id: string;
  bio: string | null;
  expertise_tags: string[] | null;
  profiles: { full_name: string; avatar_url: string | null } | null;
}

interface Slot {
  id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
}

const DURATIONS = [30, 45, 60] as const;

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

export default function MentoringBookSession() {
  const { t } = useTranslation("mentoring");
  const { mentorId } = useParams<{ mentorId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [mentor, setMentor] = useState<MentorDetail | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const [duration, setDuration] = useState<number>(45);
  const [weekStart, setWeekStart] = useState<Date>(() => startOfDay(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [bookerBusy, setBookerBusy] = useState<{ start: number; end: number }[]>([]);
  // Authoritative "can I book this mentor" answer from
  // can_book_mentoring_session_reason(), the same function the
  // mentoring_sessions INSERT RLS policy's boolean wrapper calls.
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [ineligibleReason, setIneligibleReason] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ limit_count: number | null; used_count: number } | null>(null);

  useEffect(() => {
    if (!mentorId) return;
    setLoading(true);
    setLoadError(false);
    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const slotQuery = supabase
          .from("coach_availability")
          .select("id, slot_date, start_time, end_time")
          .eq("coach_id", mentorId)
          .eq("is_booked", false)
          .eq("slot_type", "mentoring")
          .gte("slot_date", today)
          .order("slot_date")
          .order("start_time");

        const [{ data: mentorData }, { data: slotData }] = await Promise.all([
          supabase
            .from("mentor_profiles")
            .select("coach_user_id, bio, expertise_tags, profiles!inner(full_name, avatar_url)")
            .eq("coach_user_id", mentorId)
            .maybeSingle(),
          slotQuery,
        ]);
        setMentor(mentorData as unknown as MentorDetail | null);
        setSlots(((slotData as Slot[]) || []).map((s) => ({ ...s })));

        if (user) {
          const horizonStart = new Date();
          horizonStart.setHours(0, 0, 0, 0);
          const horizonEnd = new Date();
          horizonEnd.setDate(horizonEnd.getDate() + 90);

          const [{ data: mySess }, { data: myPeer }, { data: myMentoring }] = await Promise.all([
            supabase
              .from("sessions")
              .select("start_time, duration_minutes, status, coach_id, coachee_id")
              .or(`coach_id.eq.${user.id},coachee_id.eq.${user.id}`)
              .in("status", ["pending_coach_approval", "confirmed"])
              .gte("start_time", horizonStart.toISOString())
              .lte("start_time", horizonEnd.toISOString()),
            supabase
              .from("peer_sessions")
              .select("start_time, duration_minutes, status, peer_coach_id, peer_coachee_id")
              .or(`peer_coach_id.eq.${user.id},peer_coachee_id.eq.${user.id}`)
              .in("status", ["pending_coach_approval", "confirmed"])
              .gte("start_time", horizonStart.toISOString())
              .lte("start_time", horizonEnd.toISOString()),
            supabase
              .from("mentoring_sessions")
              .select("start_time, duration_minutes, status, mentor_id, mentee_id")
              .or(`mentor_id.eq.${user.id},mentee_id.eq.${user.id}`)
              .in("status", ["pending_coach_approval", "confirmed"])
              .gte("start_time", horizonStart.toISOString())
              .lte("start_time", horizonEnd.toISOString()),
          ]);
          const toBusy = (rows: { start_time: string; duration_minutes: number }[] | null) =>
            (rows || []).map((r) => {
              const s = new Date(r.start_time).getTime();
              return { start: s, end: s + r.duration_minutes * 60_000 };
            });
          setBookerBusy([...toBusy(mySess), ...toBusy(myPeer), ...toBusy(myMentoring)]);

          const [{ data: reason }, { data: usageRows }] = await Promise.all([
            supabase.rpc("check_can_book_mentoring_session_reason", { p_mentor_id: mentorId }),
            supabase.rpc("check_mentoring_session_usage"),
          ]);
          setEligible((reason ?? "forbidden") === "ok");
          setIneligibleReason(reason ?? null);
          setUsage((usageRows as { limit_count: number | null; used_count: number }[] | null)?.[0] ?? null);
        }
        setLoading(false);
      } catch (err) {
        console.error("Failed to load mentoring booking data:", err);
        setLoadError(true);
        setLoading(false);
      }
    })();
  }, [mentorId, user, retryKey]);

  const datesWithSlots = useMemo(() => new Set(slots.map((s) => s.slot_date)), [slots]);
  const week = useMemo(() => Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i)), [weekStart]);

  const startOptions = useMemo(() => {
    if (!selectedDate) return [] as { start: string; slotId: string }[];
    return computeStartOptions({
      dateKey: dateKey(selectedDate),
      slots,
      durationMinutes: duration,
      busy: bookerBusy,
    });
  }, [selectedDate, slots, duration, bookerBusy]);

  useEffect(() => setSelectedStart(null), [selectedDate, duration]);

  const canSubmit = !!selectedDate && !!selectedStart && topic.trim().length > 0 && eligible !== false;

  const handleBook = async () => {
    if (!user || !mentor || !selectedDate || !selectedStart || !topic.trim()) return;
    const opt = startOptions.find((o) => o.start === selectedStart);
    if (!opt) return;
    setSubmitting(true);
    const ds = dateKey(selectedDate);
    const startISO = new Date(`${ds}T${selectedStart}:00`).toISOString();

    const { data, error } = await supabase
      .from("mentoring_sessions")
      .insert({
        mentor_id: mentor.coach_user_id,
        mentee_id: user.id,
        topic: topic.trim(),
        start_time: startISO,
        duration_minutes: duration,
        status: "pending_coach_approval",
        slot_id: opt.slotId,
      })
      .select("id")
      .single();
    setSubmitting(false);
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        setSlots((prev) => prev.filter((s) => s.id !== opt.slotId));
        setSelectedStart(null);
        toast.error(t("bookSession.toast.slotTaken"));
        return;
      }
      if ((error as { code?: string }).code === "42501") {
        toast.error(t("bookSession.toast.notEligible"));
        return;
      }
      return toast.error(getFriendlyErrorMessage(error, t));
    }
    toast.success(t("bookSession.toast.success"));
    navigate(data ? `/mentoring/sessions/${data.id}` : "/sessions");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (loadError) {
    return (
      <Card className="p-12 text-center">
        <h2 className="text-xl font-semibold">{t("bookSession.loadError.title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("bookSession.loadError.body")}</p>
        <Button variant="outline" className="mt-6" onClick={() => setRetryKey((k) => k + 1)}>
          {t("bookSession.loadError.retry")}
        </Button>
      </Card>
    );
  }
  if (!mentor) {
    return (
      <Card className="p-12 text-center">
        <h2 className="text-xl font-semibold">{t("bookSession.mentorNotFound.title")}</h2>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/mentoring">{t("bookSession.mentorNotFound.back")}</Link>
        </Button>
      </Card>
    );
  }

  const fullName = mentor.profiles?.full_name || "?";
  const initials = fullName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="space-y-6">
      <Link
        to="/mentoring"
        className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> {t("bookSession.backToMentors")}
      </Link>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Mentor summary card */}
        <Card className="h-fit space-y-5 p-4 sm:p-6">
          <div className="flex h-44 items-center justify-center overflow-hidden rounded-2xl bg-secondary/15 text-6xl font-bold text-secondary-foreground">
            {mentor.profiles?.avatar_url ? (
              <img src={mentor.profiles.avatar_url} alt={fullName} className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{fullName}</h2>
            <p className="text-sm font-medium text-secondary-foreground">{t("bookSession.mentorLabel")}</p>
          </div>
          {mentor.bio && <p className="text-sm text-muted-foreground">{mentor.bio}</p>}
          {mentor.expertise_tags && mentor.expertise_tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {mentor.expertise_tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="rounded-full text-[10px] uppercase tracking-wider">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
          <Badge className="bg-success/10 text-success hover:bg-success/10">
            <ShieldCheck className="mr-1 h-3 w-3" /> {t("bookSession.verifiedMentor")}
          </Badge>
        </Card>

        {/* Booking panel */}
        <Card className="space-y-6 p-4 sm:p-6">
          <div>
            <h1 className="font-display text-[1.5rem] leading-[1.1] tracking-tight sm:text-[1.9rem]">
              {t("bookSession.title")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("bookSession.subtitle")}</p>
            {usage && (
              <p className="mt-1 text-xs text-muted-foreground">
                {usage.limit_count === null
                  ? t("bookSession.usage.usedUnlimited", { used: usage.used_count })
                  : t("bookSession.usage.used", { used: usage.used_count, limit: usage.limit_count })}
              </p>
            )}
          </div>

          {eligible === false && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {ineligibleReason === "received_limit_reached" || ineligibleReason === "given_limit_reached"
                ? t(`bookSession.ineligibleReasons.${ineligibleReason}`)
                : t("bookSession.ineligible")}
            </div>
          )}

          <Step number={1} label={t("bookSession.steps.duration")}>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={duration === d}
                  onClick={() => setDuration(d)}
                  className={cn(
                    "rounded-2xl border px-4 py-3.5 text-sm font-semibold transition-colors",
                    duration === d
                      ? "border-primary bg-primary text-primary-foreground shadow-glow"
                      : "border-border bg-card hover:border-primary/40"
                  )}
                >
                  {t("bookSession.steps.durationOption", { n: d })}
                </button>
              ))}
            </div>
          </Step>

          <Step number={2} label={t("bookSession.steps.date")}>
            <div className="mt-3 flex items-center gap-1.5 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0 sm:h-10 sm:w-10"
                onClick={() => setWeekStart(addDays(weekStart, -7))}
                disabled={weekStart <= startOfDay(new Date())}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="grid min-w-0 flex-1 grid-cols-7 gap-1 sm:gap-2">
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
                      aria-pressed={!!isSelected}
                      disabled={disabled}
                      onClick={() => setSelectedDate(d)}
                      className={cn(
                        "rounded-xl border px-0.5 py-2 text-center transition-colors sm:rounded-2xl sm:py-3",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground shadow-glow"
                          : disabled
                          ? "border-border bg-muted/30 text-muted-foreground/50"
                          : "border-border bg-card hover:border-primary/40"
                      )}
                    >
                      <div className="text-[9px] font-bold uppercase tracking-widest opacity-80 sm:text-[10px]">
                        {format(d, "EEE")}
                      </div>
                      <div className="text-sm font-semibold sm:text-xl">{format(d, "d")}</div>
                    </button>
                  );
                })}
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0 sm:h-10 sm:w-10"
                onClick={() => setWeekStart(addDays(weekStart, 7))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </Step>

          <Step number={3} label={t("bookSession.steps.time", { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}>
            {!selectedDate ? (
              <p className="mt-3 text-sm text-muted-foreground">{t("bookSession.pickDatePrompt")}</p>
            ) : startOptions.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">{t("bookSession.noWindowAvailable", { duration })}</p>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {startOptions.map((o) => (
                  <button
                    key={`${o.slotId}-${o.start}`}
                    type="button"
                    aria-pressed={selectedStart === o.start}
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
            <Label htmlFor="topic" className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {t("bookSession.topicLabel")}
            </Label>
            <Textarea
              id="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={t("bookSession.topicPlaceholder")}
              className="mt-2"
              rows={3}
            />
          </div>

          <div className="flex flex-col items-start justify-between gap-3 border-t pt-4 sm:flex-row sm:items-center">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("bookSession.selectedScheduleLabel")}
              </p>
              <p className="mt-1 flex items-center gap-2 font-semibold">
                {selectedDate && selectedStart
                  ? `${format(selectedDate, "EEE, MMM d")} · ${fmtTime(selectedStart)}`
                  : t("bookSession.selectATimeSlot")}
                <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-success">
                  {t("bookSession.durationBadge", { n: duration })}
                </span>
              </p>
            </div>
            <Button onClick={handleBook} disabled={!canSubmit || submitting} size="lg" className="shadow-glow">
              {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ChevronRightCircle className="mr-1 h-4 w-4" />}
              {t("bookSession.confirmButton")}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Step({ number, label, children }: { number: number; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary">
          {number}
        </span>
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      </div>
      {children}
    </div>
  );
}
