import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader, HeroPanel } from "@/components/ui/page-header";
import { AlertTriangle, Calendar, CalendarPlus, CheckCircle2, Loader2, Users, Video } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface MemberProfile {
  id: string;
  full_name: string;
  avatar_url: string | null;
}

interface TriadGroupRow {
  id: string;
  name: string | null;
  member_1_id: string;
  member_2_id: string;
  member_3_id: string;
}

interface TriadSessionRow {
  id: string;
  session_date: string;
  start_time: string | null;
  duration_minutes: number;
  coach_role_id: string;
  coachee_role_id: string;
  observer_role_id: string;
  status: string;
  meeting_url: string | null;
}

function initials(name: string) {
  return (name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

export default function TriadDashboard() {
  const { t } = useTranslation("triads");
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [group, setGroup] = useState<TriadGroupRow | null>(null);
  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [sessions, setSessions] = useState<TriadSessionRow[]>([]);
  const [myReflectedSessionIds, setMyReflectedSessionIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(false);
    try {
      const { data: groupRows, error: groupErr } = await supabase
        .from("triad_groups")
        .select("id, name, member_1_id, member_2_id, member_3_id")
        .eq("is_active", true)
        .limit(1);
      if (groupErr) throw groupErr;
      const g = (groupRows || [])[0] as TriadGroupRow | undefined;
      if (!g) {
        setGroup(null);
        setMembers([]);
        setSessions([]);
        setLoading(false);
        return;
      }
      setGroup(g);

      const memberIds = [g.member_1_id, g.member_2_id, g.member_3_id];
      const [{ data: profileRows }, { data: sessionRows }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, avatar_url").in("id", memberIds),
        supabase
          .from("triad_sessions")
          .select("id, session_date, start_time, duration_minutes, coach_role_id, coachee_role_id, observer_role_id, status, meeting_url")
          .eq("triad_group_id", g.id)
          .order("session_date", { ascending: false }),
      ]);
      setMembers((profileRows || []) as MemberProfile[]);
      const sessionList = (sessionRows || []) as TriadSessionRow[];
      setSessions(sessionList);

      const sessionIds = sessionList.map((s) => s.id);
      if (sessionIds.length > 0) {
        const { data: reflectionRows } = await supabase
          .from("triad_reflections")
          .select("triad_session_id")
          .eq("participant_id", user.id)
          .in("triad_session_id", sessionIds);
        setMyReflectedSessionIds(new Set((reflectionRows || []).map((r) => r.triad_session_id as string)));
      } else {
        setMyReflectedSessionIds(new Set());
      }
      setLoading(false);
    } catch (err) {
      console.error("Failed to load triad dashboard:", err);
      setError(true);
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const roleOf = useCallback(
    (s: TriadSessionRow, memberId: string) => {
      if (s.coach_role_id === memberId) return t("roles.coach");
      if (s.coachee_role_id === memberId) return t("roles.coachee");
      return t("roles.observer");
    },
    [t]
  );

  const now = Date.now();
  const sessionMoment = (s: TriadSessionRow) => (s.start_time ? new Date(s.start_time).getTime() : new Date(s.session_date).getTime());
  const upcoming = sessions.filter((s) => sessionMoment(s) >= now && s.status !== "cancelled").sort((a, b) => sessionMoment(a) - sessionMoment(b));
  const past = sessions.filter((s) => sessionMoment(s) < now || s.status === "cancelled").sort((a, b) => sessionMoment(b) - sessionMoment(a));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />

      {error ? (
        <Card className="flex flex-col items-center gap-3 border-destructive/30 bg-destructive/5 p-12 text-center text-sm">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <p className="text-muted-foreground">{t("loadError")}</p>
          <Button size="sm" variant="outline" onClick={load}>
            {t("retry")}
          </Button>
        </Card>
      ) : !group ? (
        <Card className="flex flex-col items-center gap-2 p-12 text-center">
          <Users className="mb-2 h-8 w-8 text-muted-foreground/50" />
          <h2 className="text-lg font-semibold">{t("noGroupTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("noGroupBody")}</p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-2xs font-bold uppercase tracking-[0.22em] text-muted-foreground">{t("upcomingHeading")}</p>
            <Button size="sm" onClick={() => navigate(`/triads/${group.id}/book`)}>
              <CalendarPlus className="mr-1.5 h-4 w-4" /> {t("scheduleSession")}
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <HeroPanel>
              <p className="text-2xs font-bold uppercase tracking-[0.22em] text-primary-glow">{t("myGroup")}</p>
              <p className="font-display mt-2.5 text-[1.9rem] font-light leading-none tracking-tight">{group.name || t("myGroup")}</p>
              <div className="mt-5 flex flex-col gap-3">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-white/15 text-[11.5px] font-bold text-primary-glow">
                      {m.avatar_url ? <img src={m.avatar_url} alt={m.full_name} className="h-full w-full object-cover" /> : initials(m.full_name)}
                    </span>
                    <span className="text-sm">
                      {m.full_name}
                      {m.id === user?.id && <span className="ml-1.5 text-xs text-primary-glow">({t("you")})</span>}
                    </span>
                  </div>
                ))}
              </div>
            </HeroPanel>

            {upcoming.length === 0 ? (
              <Card className="flex flex-col items-center justify-center gap-3 p-8 text-center">
                <Calendar className="h-6 w-6 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">{t("noUpcoming")}</p>
                <Button size="sm" variant="outline" onClick={() => navigate(`/triads/${group.id}/book`)}>
                  {t("scheduleSession")}
                </Button>
              </Card>
            ) : (
              <Card className="border-l-4 border-l-primary p-6">
                <p className="text-2xs font-bold uppercase tracking-[0.22em] text-primary">{t("upcomingHeading")}</p>
                <p className="font-display mt-2.5 text-2xl font-normal leading-tight tracking-tight">
                  {format(new Date(upcoming[0].start_time || upcoming[0].session_date), upcoming[0].start_time ? "EEEE, MMM d 'at' p" : "EEEE, MMM d")}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {members.map((m) => (
                    <span
                      key={m.id}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-[10.5px] font-bold",
                        m.id === user?.id ? "bg-primary text-secondary" : "bg-muted text-muted-foreground"
                      )}
                    >
                      {m.id === user?.id ? t("you") : m.full_name}: {roleOf(upcoming[0], m.id)}
                    </span>
                  ))}
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-4">
                  {upcoming[0].meeting_url && (
                    <Button asChild size="sm">
                      <a href={upcoming[0].meeting_url} target="_blank" rel="noopener noreferrer">
                        <Video className="mr-1.5 h-4 w-4" /> {t("joinMeeting")}
                      </a>
                    </Button>
                  )}
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/triads/${group.id}/book`}>{t("scheduleSession")}</Link>
                  </Button>
                </div>
              </Card>
            )}
          </div>

          {upcoming.length > 1 && (
            <div className="space-y-2">
              {upcoming.slice(1).map((s) => (
                <Card key={s.id} className="flex flex-wrap items-center gap-3 p-4">
                  <Calendar className="h-4 w-4 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">
                      {format(new Date(s.start_time || s.session_date), s.start_time ? "EEE, MMM d · p" : "EEE, MMM d")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {members.map((m) => `${m.full_name} (${roleOf(s, m.id)})`).join(" · ")}
                    </p>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <div>
            <p className="mb-2 text-2xs font-bold uppercase tracking-[0.22em] text-muted-foreground">{t("pastHeading")}</p>
            {past.length === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">{t("noPast")}</Card>
            ) : (
              <Card className="divide-y overflow-hidden">
                {past.map((s) => {
                  const reflected = myReflectedSessionIds.has(s.id);
                  return (
                    <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/30">
                      <div className="flex items-center gap-3">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-semibold">{format(new Date(s.start_time || s.session_date), "EEE, MMM d")}</p>
                          <p className="text-xs text-muted-foreground">{t("roles." + (s.coach_role_id === user?.id ? "coach" : s.coachee_role_id === user?.id ? "coachee" : "observer"))}</p>
                        </div>
                      </div>
                      {reflected ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-success">
                          <CheckCircle2 className="h-3.5 w-3.5" /> {t("reflectionSubmitted")}
                        </span>
                      ) : (
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/triads/${s.id}/reflect`}>{t("writeReflection")}</Link>
                        </Button>
                      )}
                    </div>
                  );
                })}
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
