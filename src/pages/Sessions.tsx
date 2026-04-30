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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

type SessionStatus =
  | "pending_coach_approval"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "rescheduled";

interface SessionRow {
  id: string;
  coach_id: string;
  coachee_id: string;
  topic: string;
  start_time: string;
  duration_minutes: number;
  status: SessionStatus;
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
    const filterCol = role === "coach" ? "coach_id" : "coachee_id";
    const { data } = await supabase
      .from("sessions")
      .select("*")
      .eq(filterCol, user.id)
      .order("start_time", { ascending: false });

    if (!data) {
      setSessions([]);
      setLoading(false);
      return;
    }

    const ids = Array.from(new Set([...data.map((s) => s.coach_id), ...data.map((s) => s.coachee_id)]));
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .in("id", ids);
    const byId = new Map((profs || []).map((p) => [p.id, p]));

    setSessions(
      data.map((s: any) => ({
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
                <SessionCard key={s.id} session={s} role={role!} onOpen={() => navigate(`/sessions/${s.id}`)} />
              ))
            )}
          </TabsContent>
          <TabsContent value="past" className="mt-4 space-y-3">
            {past.length === 0 ? (
              <EmptyState title="Nothing yet" subtitle="Past sessions will show up here." />
            ) : (
              past.map((s) => (
                <SessionCard key={s.id} session={s} role={role!} onOpen={() => navigate(`/sessions/${s.id}`)} />
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
}: {
  session: SessionRow;
  role: "coach" | "coachee" | "admin";
  onOpen: () => void;
}) {
  const meta = STATUS_META[session.status];
  const Icon = meta.icon;
  const counterpart = role === "coach" ? session.coachee : session.coach;
  const start = new Date(session.start_time);

  return (
    <Card
      className="group flex cursor-pointer items-center justify-between gap-4 p-5 transition-colors hover:border-primary/40"
      onClick={onOpen}
    >
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary font-bold">
          {(counterpart?.full_name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold">{session.topic}</p>
          <p className="truncate text-sm text-muted-foreground">
            with {counterpart?.full_name || counterpart?.email || "—"}
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
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest",
          meta.className
        )}
      >
        <Icon className="h-3 w-3" /> {meta.label}
      </span>
    </Card>
  );
}
