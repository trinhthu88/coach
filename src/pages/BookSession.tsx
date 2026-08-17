import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
  Globe,
  ShieldCheck,
  Info,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { addDays, format, startOfDay } from "date-fns";
import { toast } from "sonner";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { canSubmitBooking, isOverSessionLimit } from "./bookingEligibility";
import { computeStartOptions } from "./bookingSlots";

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
const CONTACT_EMAIL = "contact@clariva.club";

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
  const { t } = useTranslation("sessions");
  const { coachId } = useParams<{ coachId: string }>();
  const [searchParams] = useSearchParams();
  const mode = (searchParams.get("mode") === "peer" ? "peer" : "coaching") as "peer" | "coaching";
  const { user, role } = useAuth();
  const navigate = useNavigate();

  const [coach, setCoach] = useState<CoachDetail | null>(null);
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
  const [usage, setUsage] = useState<{ monthly_limit: number | null; used_this_month: number } | null>(
    null
  );
  const [bookerBusy, setBookerBusy] = useState<{ start: number; end: number }[]>([]);
  // Authoritative "can I book this coach" answer from public.can_book_session(), the same
  // function the `sessions` INSERT RLS policies call — see RULES.md and
  // supabase/migrations/20260810150000_can_book_session_rpc.sql. null = not checked yet
  // (peer mode isn't gated by this function; loading state before the RPC resolves).
  const [eligible, setEligible] = useState<boolean | null>(null);

  useEffect(() => {
    if (!coachId) return;
    setLoading(true);
    setLoadError(false);
    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const slotQuery = supabase
          .from("coach_availability")
          .select("id, slot_date, start_time, end_time, slot_type")
          .eq("coach_id", coachId)
          .eq("is_booked", false)
          .eq("slot_type", mode === "peer" ? "peer" : "coaching")
          .gte("slot_date", today)
          .order("slot_date")
          .order("start_time");

        const [{ data: coachData }, { data: slotData }] = await Promise.all([
          supabase
            .from("coach_profiles")
            .select(
              "id, title, specialties, years_experience, country_based, nationality, rating_avg, sessions_completed, diplomas_certifications, peer_coaching_opt_in, profiles!inner(full_name, avatar_url, bio)"
            )
            .eq("id", coachId)
            .maybeSingle(),
          slotQuery,
        ]);
        setCoach(coachData as unknown as CoachDetail | null);

        // --- Conflict filtering: hide booker's own existing sessions overlap ---
        let bookerBusy: { start: number; end: number }[] = [];
        if (user) {
          const horizonStart = new Date();
          horizonStart.setHours(0, 0, 0, 0);
          const horizonEnd = new Date();
          horizonEnd.setDate(horizonEnd.getDate() + 90);

          const [{ data: mySess }, { data: myPeer }] = await Promise.all([
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
          ]);
          const toBusy = (rows: { start_time: string; duration_minutes: number }[] | null) =>
            (rows || []).map((r) => {
              const s = new Date(r.start_time).getTime();
              return { start: s, end: s + r.duration_minutes * 60_000 };
            });
          bookerBusy = [...toBusy(mySess), ...toBusy(myPeer)];
        }
        setBookerBusy(bookerBusy);
        setSlots(((slotData as Slot[]) || []).map((s) => ({ ...s })));

        if (user) {
          if (mode === "peer") {
            // Peer mode: use new RPC for peer-only monthly limit. This is relationship 3
            // (open opt-in pool, see RULES.md) — not covered by can_book_session(), which
            // only governs the two curated-allowlist relationships on `sessions`.
            const { data: u } = await supabase.rpc("get_coach_peer_session_usage", {
              _coach_id: user.id,
            });
            const row = Array.isArray(u) ? u[0] : u;
            // null = unlimited (coach's programme has no peer_received_limit set) —
            // only fall back to 4 when the RPC returned no row at all.
            const peerLimit: number | null = row ? row.peer_monthly_limit : 4;
            const peerUsed = row?.used_this_month ?? 0;
            setUsage({ monthly_limit: peerLimit, used_this_month: peerUsed });
            // Not covered by can_book_session() (see comment above) — gate on the
            // usage numbers directly instead of leaving `eligible` unset.
            setEligible(peerLimit === null || peerUsed < peerLimit);
          } else {
            if (role === "coach") {
              // Coach booking a regular coaching session (coach-as-coachee allowlist path).
              // These numbers are display-only now — resolve via the coach's
              // coach_programme_enrollments -> coach_programmes join, the same source
              // can_book_session() and enforce_coach_as_coachee_limit() use, so the
              // banner can't show a different limit than what's actually enforced.
              // null mentee_sessions_limit = unlimited; no enrollment row at all falls
              // back to 4, matching the old default.
              const [{ data: enrollment }, coachCount] = await Promise.all([
                supabase
                  .from("coach_programme_enrollments")
                  .select("coach_programme:coach_programmes(mentee_sessions_limit)")
                  .eq("coach_id", user.id)
                  .maybeSingle(),
                supabase
                  .from("sessions")
                  .select("id", { count: "exact", head: true })
                  .eq("coachee_id", user.id)
                  .eq("status", "completed"),
              ]);
              const monthlyLimit: number | null = enrollment
                ? enrollment.coach_programme?.mentee_sessions_limit ?? null
                : 4;
              setUsage({
                monthly_limit: monthlyLimit,
                used_this_month: coachCount.count || 0,
              });
            } else {
              const [{ data: u }, { count }] = await Promise.all([
                supabase.rpc("get_coachee_session_usage", { _coachee_id: user.id }),
                supabase
                  .from("sessions")
                  .select("id", { count: "exact", head: true })
                  .eq("coachee_id", user.id)
                  .eq("status", "completed"),
              ]);
              const limit = u && u.length ? u[0].monthly_limit : 4;
              setUsage({ monthly_limit: limit, used_this_month: count || 0 });
            }

            // Authoritative eligibility gate (allowlist + limit + status), regardless of
            // mode above — see can_book_session() in
            // supabase/migrations/20260810150000_can_book_session_rpc.sql.
            const { data: canBook } = await supabase.rpc("check_can_book_session", {
              p_coach_id: coachId,
            });
            setEligible(canBook ?? false);
          }
        }
        setLoading(false);
      } catch (err) {
        console.error("Failed to load booking data:", err);
        setLoadError(true);
        setLoading(false);
      }
    })();
  }, [coachId, user, mode, role, retryKey]);

  const datesWithSlots = useMemo(() => new Set(slots.map((s) => s.slot_date)), [slots]);
  const week = useMemo(
    () => Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i)),
    [weekStart]
  );

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

  const overLimit = isOverSessionLimit(usage);
  const canSubmit = canSubmitBooking({ selectedDate, selectedStart, topic, eligible });
  // eligible === false but the numbers don't show overLimit: something other than the
  // session cap is blocking (allowlist changed, status changed) — the usage-based banner
  // below wouldn't explain it, so show a distinct message instead of nothing.
  const ineligibleForOtherReason = eligible === false && !overLimit;

  const handleBook = async () => {
    if (!user || !coach || !selectedDate || !selectedStart || !topic.trim()) return;
    const opt = startOptions.find((o) => o.start === selectedStart);
    if (!opt) return;
    setSubmitting(true);
    const ds = dateKey(selectedDate);
    const startISO = new Date(`${ds}T${selectedStart}:00`).toISOString();

    let error;
    if (mode === "peer") {
      ({ error } = await supabase.from("peer_sessions").insert({
        peer_coach_id: coach.id,
        peer_coachee_id: user.id,
        topic: topic.trim(),
        start_time: startISO,
        duration_minutes: duration,
        status: "pending_coach_approval",
        slot_id: opt.slotId,
      }));
    } else {
      ({ error } = await supabase.from("sessions").insert({
        coach_id: coach.id,
        coachee_id: user.id,
        topic: topic.trim(),
        start_time: startISO,
        duration_minutes: duration,
        status: "pending_coach_approval",
        slot_id: opt.slotId,
      }));
    }
    setSubmitting(false);
    if (error) {
      // Unique-violation: someone else booked this exact slot a moment earlier.
      if ((error as { code?: string }).code === "23505") {
        setSlots((prev) => prev.filter((s) => s.id !== opt.slotId));
        setSelectedStart(null);
        toast.error(t("bookSession.toast.slotTaken"));
        return;
      }
      // Belt-and-suspenders: the pre-submit eligible check above should already have
      // caught this, but eligibility can change between that check and submit (e.g. an
      // admin edits the allowlist mid-session). 42501 = RLS policy rejection.
      if ((error as { code?: string }).code === "42501") {
        toast.error(t("bookSession.toast.notEligible"));
        return;
      }
      return toast.error(getFriendlyErrorMessage(error, t));
    }
    toast.success(
      mode === "peer"
        ? t("bookSession.toast.successPeer")
        : t("bookSession.toast.successCoaching")
    );
    navigate("/sessions");
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
        <p className="mt-2 text-sm text-muted-foreground">
          {t("bookSession.loadError.body")}
        </p>
        <Button variant="outline" className="mt-6" onClick={() => setRetryKey((k) => k + 1)}>
          {t("bookSession.loadError.retry")}
        </Button>
      </Card>
    );
  }
  if (!coach) {
    return (
      <Card className="p-12 text-center">
        <h2 className="text-xl font-semibold">{t("bookSession.coachNotFound.title")}</h2>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/coaches">{t("bookSession.coachNotFound.backToCoaches")}</Link>
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
        <ChevronLeft className="h-4 w-4" /> {t("bookSession.backToCoach")}
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
            <p className="text-sm font-medium text-primary">{coach.title || t("bookSession.coachSummary.defaultTitle")}</p>
          </div>
          <div className="grid grid-cols-3 gap-2 border-y py-4">
            <MiniStat
              label={t("bookSession.coachSummary.ratingLabel")}
              value={
                <span className="inline-flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 fill-warning text-warning" />
                  {Number(coach.rating_avg).toFixed(1)}
                </span>
              }
            />
            <MiniStat label={t("bookSession.coachSummary.experienceLabel")} value={t("bookSession.coachSummary.experienceValue", { years: coach.years_experience ?? 0 })} />
            <MiniStat label={t("bookSession.coachSummary.sessionsLabel")} value={String(coach.sessions_completed)} />
          </div>
          {coach.country_based && (
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Globe className="h-4 w-4 text-primary" />
              {coach.nationality ? t("bookSession.coachSummary.basedIn", { nationality: coach.nationality, country: coach.country_based }) : coach.country_based}
            </p>
          )}
          <Badge className="bg-success/10 text-success hover:bg-success/10">
            <ShieldCheck className="mr-1 h-3 w-3" /> {t("bookSession.coachSummary.verifiedExpert")}
          </Badge>
          {usage && (
            <div className="flex items-start gap-2 rounded-xl bg-muted/40 p-3 text-xs">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                {t("bookSession.coachSummary.usagePrefix")} <strong>{usage.used_this_month}</strong> {t("bookSession.coachSummary.usageOfYour")}{" "}
                <strong>{usage.monthly_limit === null ? t("bookSession.coachSummary.unlimited") : usage.monthly_limit}</strong>{" "}
                {mode === "peer" ? t("bookSession.modeWord.peer") : t("bookSession.modeWord.coaching")} {t("bookSession.coachSummary.usageSuffix")}
              </span>
            </div>
          )}
        </Card>

        {/* Booking panel */}
        <Card className="space-y-6 p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-[1.9rem] leading-[1.1] tracking-tight">
                {mode === "peer" ? t("bookSession.title.peer") : t("bookSession.title.coaching")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {mode === "peer"
                  ? t("bookSession.subtitle.peer")
                  : t("bookSession.subtitle.coaching")}
              </p>
            </div>
            {mode === "peer" && (
              <Badge className="bg-success/15 text-success hover:bg-success/15">{t("bookSession.peerBadge")}</Badge>
            )}
          </div>

          {overLimit && (mode === "peer" || role === "coach") ? (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {t("bookSession.freePlanNotice.prefix", { limit: usage?.monthly_limit, modeWord: mode === "peer" ? t("bookSession.modeWord.peer") : t("bookSession.modeWord.coaching") })}{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold underline">
                  {CONTACT_EMAIL}
                </a>{" "}
                {t("bookSession.freePlanNotice.suffix")}
              </span>
            </div>
          ) : (
            overLimit && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {t("bookSession.limitReached", { used: usage?.used_this_month, limit: usage?.monthly_limit })}
              </div>
            )
          )}

          {ineligibleForOtherReason && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {t("bookSession.ineligible")}
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
              <div className="flex-1 overflow-x-auto">
                <div className="grid min-w-[360px] grid-cols-7 gap-2">
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
            label={t("bookSession.steps.time", { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
          >
            {!selectedDate ? (
              <p className="mt-3 text-sm text-muted-foreground">{t("bookSession.pickDatePrompt")}</p>
            ) : startOptions.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {t("bookSession.noWindowAvailable", { duration })}
              </p>
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
            <Label
              htmlFor="topic"
              className="text-xs font-bold uppercase tracking-widest text-muted-foreground"
            >
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
              {t("bookSession.confirmButton")}
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
