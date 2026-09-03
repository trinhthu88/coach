import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { AlertTriangle, Calendar, CalendarPlus, CheckCircle2, Loader2, Users } from "lucide-react";
import { format } from "date-fns";

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
          .select("id, session_date, start_time, duration_minutes, coach_role_id, coachee_role_id, observer_role_id, status")
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
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
              <p className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <Users className="h-3.5 w-3.5" /> {group.name || t("myGroup")}
              </p>
              <Button size="sm" onClick={() => navigate(`/triads/${group.id}/book`)}>
                <CalendarPlus className="mr-1.5 h-4 w-4" /> {t("scheduleSession")}
              </Button>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-3">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-3 rounded-xl border p-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-soft text-sm font-bold text-primary">
                    {m.avatar_url ? <img src={m.avatar_url} alt={m.full_name} className="h-full w-full object-cover" /> : initials(m.full_name)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{m.full_name}</p>
                    {m.id === user?.id && (
                      <p className="text-[10px] font-bold uppercase tracking-widest text-primary">{t("you")}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("upcomingHeading")}</p>
            {upcoming.length === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">{t("noUpcoming")}</Card>
            ) : (
              <div className="space-y-2">
                {upcoming.map((s) => (
                  <Card key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="flex items-center gap-3">
                      <Calendar className="h-4 w-4 text-primary" />
                      <div>
                        <p className="text-sm font-semibold">
                          {format(new Date(s.start_time || s.session_date), s.start_time ? "EEE, MMM d · p" : "EEE, MMM d")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {members.map((m) => `${m.full_name} (${roleOf(s, m.id)})`).join(" · ")}
                        </p>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("pastHeading")}</p>
            {past.length === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">{t("noPast")}</Card>
            ) : (
              <div className="space-y-2">
                {past.map((s) => {
                  const reflected = myReflectedSessionIds.has(s.id);
                  return (
                    <Card key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
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
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
