import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Calendar,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Star,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";

type SessionStatus =
  | "pending_coach_approval"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "rescheduled";

type SessionKind = "coaching" | "peer-give" | "peer-receive";

interface SessionRow {
  id: string;
  coach_id: string;
  coachee_id: string;
  topic: string;
  start_time: string;
  duration_minutes: number;
  status: SessionStatus;
  action_items: any;
  coachee_rating: number | null;
  coachee_rating_comment: string | null;
  kind: SessionKind;
  coach: { full_name: string; email: string; avatar_url: string | null } | null;
  coachee: { full_name: string; email: string; avatar_url: string | null } | null;
}

const STATUS_META: Record<SessionStatus, { label: string; icon: any; className: string }> = {
  pending_coach_approval: {
    label: "Awaiting confirmation",
    icon: AlertCircle,
    className: "bg-warning/10 text-warning border-warning/20",
  },
  confirmed: {
    label: "Confirmed",
    icon: CheckCircle2,
    className: "bg-primary/10 text-primary border-primary/20",
  },
  completed: {
    label: "Completed",
    icon: CheckCircle2,
    className: "bg-success/10 text-success border-success/20",
  },
  cancelled: {
    label: "Cancelled",
    icon: XCircle,
    className: "bg-destructive/10 text-destructive border-destructive/20",
  },
  rescheduled: {
    label: "Rescheduled",
    icon: Clock,
    className: "bg-secondary text-secondary-foreground border-border",
  },
};

export default function Sessions() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("upcoming");

  const load = useCallback(async () => {
    if (!user) return;

    // Regular coaching sessions
    const sessQueries: Promise<any>[] = [];
    if (role === "coach" || role === "coachee") {
      const col = role === "coach" ? "coach_id" : "coachee_id";
      sessQueries.push(
        supabase.from("sessions").select("*").eq(col, user.id).order("start_time", { ascending: false })
      );
    } else {
      sessQueries.push(Promise.resolve({ data: [] }));
    }

    // Peer sessions (only relevant when user is a coach)
    if (role === "coach") {
      sessQueries.push(
        supabase
          .from("peer_sessions")
          .select("*")
          .or(`peer_coach_id.eq.${user.id},peer_coachee_id.eq.${user.id}`)
          .order("start_time", { ascending: false })
      );
    } else {
      sessQueries.push(Promise.resolve({ data: [] }));
    }

    const [{ data: sessData }, { data: peerData }] = await Promise.all(sessQueries);
    const sess = (sessData as any[]) || [];
    const peer = (peerData as any[]) || [];

    const allRows = [
      ...sess.map((s) => ({ ...s, kind: "coaching" as SessionKind })),
      ...peer.map((s) => ({
        ...s,
        coach_id: s.peer_coach_id,
        coachee_id: s.peer_coachee_id,
        kind: (s.peer_coach_id === user.id ? "peer-give" : "peer-receive") as SessionKind,
      })),
    ].sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());

    const ids = Array.from(
      new Set(allRows.flatMap((s: any) => [s.coach_id, s.coachee_id]))
    );
    let byId = new Map<string, any>();
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url")
        .in("id", ids);
      byId = new Map((profs || []).map((p) => [p.id, p]));
    }

    setSessions(
      allRows.map((s: any) => ({
        ...s,
        coach: byId.get(s.coach_id) || null,
        coachee: byId.get(s.coachee_id) || null,
      })) as SessionRow[]
    );
    setLoading(false);
  }, [user, role]);

  useEffect(() => {
    load();
  }, [load]);

  const now = new Date();
  const upcoming = sessions.filter(
    (s) => s.status !== "cancelled" && s.status !== "completed" && new Date(s.start_time) >= now
  );
  const past = sessions.filter(
    (s) => s.status === "completed" || s.status === "cancelled" || new Date(s.start_time) < now
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Calendar className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
            <p className="text-sm text-muted-foreground">
              {role === "coach"
                ? "Confirm requests, manage notes and meeting links."
                : "Track upcoming bookings, notes and action items."}
            </p>
          </div>
        </div>
        {role === "coachee" && (
          <Button asChild className="shadow-glow">
            <Link to="/coaches">
              <Calendar className="mr-1 h-4 w-4" /> Book a session
            </Link>
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="upcoming">Upcoming ({upcoming.length})</TabsTrigger>
            <TabsTrigger value="past">Past ({past.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming" className="mt-4 space-y-3">
            {upcoming.length === 0 ? (
              <EmptyState
                title="No upcoming sessions"
                subtitle={role === "coachee" ? "Browse coaches and book your next session." : "You're all caught up."}
              />
            ) : (
              upcoming.map((s) => (
                <SessionCard key={s.id} session={s} role={role!} onOpen={() => navigate(`/sessions/${s.id}`)} onChanged={load} />
              ))
            )}
          </TabsContent>
          <TabsContent value="past" className="mt-4 space-y-3">
            {past.length === 0 ? (
              <EmptyState title="Nothing yet" subtitle="Past sessions will show up here." />
            ) : (
              past.map((s) => (
                <SessionCard key={s.id} session={s} role={role!} onOpen={() => navigate(`/sessions/${s.id}`)} onChanged={load} />
              ))
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <Card className="p-12 text-center">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </Card>
  );
}

function SessionCard({
  session,
  role,
  onOpen,
  onChanged,
}: {
  session: SessionRow;
  role: "coach" | "coachee" | "admin";
  onOpen: () => void;
  onChanged: () => void;
}) {
  const meta = STATUS_META[session.status];
  const Icon = meta.icon;
  const counterpart = role === "coach" ? session.coachee : session.coach;
  const start = new Date(session.start_time);
  const showRating = role === "coachee" && session.status === "completed";
  const canMarkComplete =
    role === "coach" && session.status === "confirmed" && start < new Date();
  const [completing, setCompleting] = useState(false);

  const markComplete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setCompleting(true);
    const { error } = await supabase
      .from("sessions")
      .update({ status: "completed" })
      .eq("id", session.id);
    setCompleting(false);
    if (error) return toast.error(error.message);
    toast.success("Session marked completed");
    onChanged();
  };

  return (
    <Card
      className="group cursor-pointer p-5 transition-colors hover:border-primary/40"
      onClick={onOpen}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary font-bold">
            {(counterpart?.full_name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold">{session.topic}</p>
            <p className="truncate text-sm text-muted-foreground">
              {role === "coach" ? "with " : "Coach: "}
              <span className="font-medium text-foreground">
                {counterpart?.full_name || counterpart?.email || "—"}
              </span>
            </p>
            <p className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {format(start, "EEE, MMM d · p")}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" /> {session.duration_minutes} min
              </span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest",
              meta.className
            )}
          >
            <Icon className="h-3 w-3" /> {meta.label}
          </span>
          {canMarkComplete && (
            <Button
              size="sm"
              variant="secondary"
              onClick={markComplete}
              disabled={completing}
            >
              {completing ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Check className="mr-1 h-3 w-3" />
              )}
              Mark complete
            </Button>
          )}
        </div>
      </div>
      <ActionItemsList items={session.action_items} date={session.start_time} />
      {showRating && (
        <div className="mt-4 border-t pt-3" onClick={(e) => e.stopPropagation()}>
          <RateSession session={session} onChanged={onChanged} />
        </div>
      )}
    </Card>
  );
}

function RateSession({ session, onChanged }: { session: SessionRow; onChanged: () => void }) {
  const [rating, setRating] = useState<number>(session.coachee_rating || 0);
  const [hover, setHover] = useState(0);
  const [saving, setSaving] = useState(false);
  const isRated = !!session.coachee_rating;

  const submit = async (value: number) => {
    setSaving(true);
    setRating(value);
    const { error } = await supabase
      .from("sessions")
      .update({ coachee_rating: value, coachee_rated_at: new Date().toISOString() })
      .eq("id", session.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(isRated ? "Rating updated" : "Thanks for your rating!");
    onChanged();
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {isRated ? "Your rating" : "Rate this session"}
      </span>
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = (hover || rating) >= n;
          return (
            <button
              key={n}
              type="button"
              disabled={saving}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => submit(n)}
              className="p-0.5 transition-transform hover:scale-110 disabled:opacity-50"
              aria-label={`Rate ${n} star${n > 1 ? "s" : ""}`}
            >
              <Star
                className={cn(
                  "h-5 w-5",
                  active ? "fill-warning text-warning" : "text-muted-foreground"
                )}
              />
            </button>
          );
        })}
      </div>
      {isRated && (
        <span className="text-xs text-muted-foreground">({rating}/5)</span>
      )}
    </div>
  );
}

function ActionItemsList({ items, date }: { items: any; date: string }) {
  const list = Array.isArray(items)
    ? items
        .map((it: any) => (typeof it === "string" ? { text: it, done: false } : it))
        .filter((it: any) => it?.text)
    : [];
  if (list.length === 0) return null;
  return (
    <div className="mt-4 border-t pt-3">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Action items
      </p>
      <ul className="space-y-1.5">
        {list.slice(0, 4).map((it: any, idx: number) => (
          <li key={idx} className="flex items-start justify-between gap-3 text-xs">
            <span className={cn("flex flex-1 items-start gap-1.5", it.done && "text-muted-foreground")}>
              <span className={cn("mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[10px]", it.done && "text-success font-bold")}>
                {it.done ? "✓" : "•"}
              </span>
              <span>{it.text}</span>
            </span>
            <span className="shrink-0 text-muted-foreground">
              {format(new Date(date), "MMM d, yyyy")}
            </span>
          </li>
        ))}
        {list.length > 4 && (
          <li className="text-[10px] text-muted-foreground">+{list.length - 4} more</li>
        )}
      </ul>
    </div>
  );
}
