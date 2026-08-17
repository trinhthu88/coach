import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Loader2, Calendar, MessagesSquare, UserPlus, Star } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { AdminPageHeader } from "./_shared";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  kind: "session" | "peer" | "coachee" | "rating" | "milestone";
  title: string;
  sub: string;
  at: Date;
}

interface SessionActivityRow {
  id: string;
  topic: string;
  status: string;
  start_time: string;
  coachee_id: string;
  coach_id: string;
  coachee_rating: number | null;
  updated_at: string;
}

interface PeerSessionActivityRow {
  id: string;
  topic: string;
  status: string;
  start_time: string;
  peer_coach_id: string;
  peer_coachee_id: string;
  updated_at: string;
}

interface ProfileActivityRow {
  id: string;
  full_name: string;
  status: string;
  created_at: string;
}

interface MilestoneActivityRow {
  id: string;
  title: string;
  is_done: boolean;
  done_at: string | null;
  coachee_id: string;
}

export default function AdminActivity() {
  const { t } = useTranslation("admin");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [
        { data: sess },
        { data: peer },
        { data: profs },
        { data: milestones },
      ] = await Promise.all([
        supabase.from("sessions").select("id, topic, status, start_time, coachee_id, coach_id, coachee_rating, updated_at").order("updated_at", { ascending: false }).limit(40),
        supabase.from("peer_sessions").select("id, topic, status, start_time, peer_coach_id, peer_coachee_id, updated_at").order("updated_at", { ascending: false }).limit(20),
        supabase.from("profiles").select("id, full_name, status, created_at").order("created_at", { ascending: false }).limit(20),
        supabase.from("coachee_milestones").select("id, title, is_done, done_at, coachee_id").eq("is_done", true).order("done_at", { ascending: false }).limit(20),
      ]);

      const profById = new Map((profs || []).map((p: ProfileActivityRow) => [p.id, p.full_name]));

      const list: Item[] = [];
      (sess || []).forEach((s: SessionActivityRow) => {
        if (s.status === "completed") {
          list.push({
            id: `s-${s.id}`,
            kind: "session",
            title: t("activity.sessionCompleted", { topic: s.topic }),
            sub: `${profById.get(s.coach_id) || t("activity.defaultCoach")} → ${profById.get(s.coachee_id) || t("activity.defaultCoachee")}${s.coachee_rating ? ` · ${s.coachee_rating}/5` : ""}`,
            at: new Date(s.updated_at || s.start_time),
          });
        }
      });
      (peer || []).forEach((s: PeerSessionActivityRow) => {
        if (s.status === "completed") {
          list.push({
            id: `p-${s.id}`,
            kind: "peer",
            title: t("activity.peerSessionTitle", { topic: s.topic }),
            sub: `${profById.get(s.peer_coach_id) || t("activity.defaultPeerCoach")} → ${profById.get(s.peer_coachee_id) || t("activity.defaultPeerCoachee")}`,
            at: new Date(s.updated_at || s.start_time),
          });
        }
      });
      (profs || []).forEach((p: ProfileActivityRow) => {
        if (p.status === "active") {
          list.push({
            id: `u-${p.id}`,
            kind: "coachee",
            title: t("activity.joined", { name: p.full_name }),
            sub: t("activity.newActiveMember"),
            at: new Date(p.created_at),
          });
        }
      });
      (milestones || []).forEach((m: MilestoneActivityRow) => {
        list.push({
          id: `m-${m.id}`,
          kind: "milestone",
          title: t("activity.milestoneCompleted", { title: m.title }),
          sub: profById.get(m.coachee_id) || t("activity.defaultCoachee"),
          at: new Date(m.done_at || Date.now()),
        });
      });

      list.sort((a, b) => b.at.getTime() - a.at.getTime());
      setItems(list.slice(0, 60));
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const iconFor = (k: string) =>
    k === "peer" ? MessagesSquare : k === "coachee" ? UserPlus : k === "rating" ? Star : Calendar;
  const toneFor = (k: string) =>
    k === "peer" ? "bg-accent/15 text-accent" : k === "coachee" ? "bg-success/15 text-success" : k === "milestone" ? "bg-warning/20 text-warning" : "bg-primary-soft text-primary";

  return (
    <div>
      <AdminPageHeader title={t("activity.title")} emphasize={t("activity.titleEmphasis")} subtitle={t("activity.subtitle")} />

      <Card className="p-4">
        {items.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">{t("activity.noRecentActivity")}</p>
        ) : (
          <ul className="divide-y">
            {items.map((it) => {
              const Icon = iconFor(it.kind);
              return (
                <li key={it.id} className="flex items-start gap-3 py-3">
                  <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", toneFor(it.kind))}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{it.title}</p>
                    <p className="text-[11px] text-muted-foreground">{it.sub}</p>
                  </div>
                  <span className="text-[11px] text-muted-foreground">{formatDistanceToNow(it.at, { addSuffix: true })}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
