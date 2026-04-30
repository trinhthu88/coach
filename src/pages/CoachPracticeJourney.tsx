import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Layers, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface Entry {
  id: string;
  topic: string;
  start_time: string;
  duration_minutes: number;
  status: string;
  kind: "coached" | "peer-given" | "peer-received";
  counterpart_id: string;
}

export default function CoachPracticeJourney() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, { full_name: string }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // Sessions where coach is being coached as a coachee
      const { data: coached } = await supabase
        .from("sessions")
        .select("id, topic, start_time, duration_minutes, status, coach_id")
        .eq("coachee_id", user.id);

      // Peer sessions: both directions
      const { data: peer } = await supabase
        .from("peer_sessions")
        .select("id, topic, start_time, duration_minutes, status, peer_coach_id, peer_coachee_id")
        .or(`peer_coach_id.eq.${user.id},peer_coachee_id.eq.${user.id}`);

      const list: Entry[] = [];
      (coached || []).forEach((s: any) =>
        list.push({
          id: s.id,
          topic: s.topic,
          start_time: s.start_time,
          duration_minutes: s.duration_minutes,
          status: s.status,
          kind: "coached",
          counterpart_id: s.coach_id,
        })
      );
      (peer || []).forEach((s: any) =>
        list.push({
          id: s.id,
          topic: s.topic,
          start_time: s.start_time,
          duration_minutes: s.duration_minutes,
          status: s.status,
          kind: s.peer_coach_id === user.id ? "peer-given" : "peer-received",
          counterpart_id: s.peer_coach_id === user.id ? s.peer_coachee_id : s.peer_coach_id,
        })
      );

      list.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
      setEntries(list);

      const ids = Array.from(new Set(list.map((e) => e.counterpart_id)));
      if (ids.length) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
        const map: Record<string, any> = {};
        (profs || []).forEach((p: any) => (map[p.id] = p));
        setProfilesById(map);
      }
      setLoading(false);
    })();
  }, [user]);

  const stats = useMemo(() => {
    const completed = entries.filter((e) => e.status === "completed");
    return {
      total: entries.length,
      completed: completed.length,
      coachedCount: completed.filter((e) => e.kind === "coached").length,
      peerGiven: completed.filter((e) => e.kind === "peer-given").length,
      peerReceived: completed.filter((e) => e.kind === "peer-received").length,
    };
  }, [entries]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10 text-success">
          <Layers className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-3xl tracking-tight text-secondary">
            My practice <em className="not-italic text-primary">journey</em>
          </h1>
          <p className="text-sm text-muted-foreground">
            Combined log of sessions you received and peer-coaching sessions you provided.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Total entries" value={stats.total} />
        <StatTile label="Sessions received" value={stats.coachedCount} />
        <StatTile label="Peer sessions given" value={stats.peerGiven} />
        <StatTile label="Peer sessions received" value={stats.peerReceived} />
      </div>

      <Card className="p-5">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Practice log
        </p>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No entries yet. Book a coach or offer peer coaching to get started.
          </p>
        ) : (
          <ul className="divide-y">
            {entries.map((e) => {
              const counterpart = profilesById[e.counterpart_id]?.full_name || "—";
              return (
                <li key={`${e.kind}-${e.id}`} className="py-3">
                  <div className="flex items-center gap-2">
                    <KindBadge kind={e.kind} />
                    <p className="font-semibold">{e.topic}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    with {counterpart} · {format(new Date(e.start_time), "MMM d, yyyy · p")} ·{" "}
                    {e.duration_minutes} min · {e.status.replace(/_/g, " ")}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </Card>
  );
}

function KindBadge({ kind }: { kind: Entry["kind"] }) {
  const map = {
    coached: { label: "Coached", className: "bg-secondary text-secondary-foreground" },
    "peer-given": { label: "Peer · given", className: "bg-success/15 text-success" },
    "peer-received": { label: "Peer · received", className: "bg-success/10 text-success" },
  } as const;
  const m = map[kind];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest",
        m.className
      )}
    >
      {m.label}
    </span>
  );
}
