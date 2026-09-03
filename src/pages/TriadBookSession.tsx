import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, Loader2 } from "lucide-react";
import { getFriendlyErrorMessage } from "@/lib/errors";

interface MemberProfile {
  id: string;
  full_name: string;
}

interface TriadGroupRow {
  id: string;
  programme_id: string;
  member_1_id: string;
  member_2_id: string;
  member_3_id: string;
}

interface TrainingWeekOption {
  id: string;
  week_number: number;
  title: string;
}

const NO_WEEK = "__none__";

/**
 * Simple self-service date/time picker (not the availability-slot grid
 * BookSession.tsx/MentoringBookSession.tsx use) — a triad's 3 members
 * already know each other and pick a time by agreement, so there's no
 * "provider publishes availability" party to book against here.
 */
export default function TriadBookSession() {
  const { t } = useTranslation("triads");
  const { triadGroupId } = useParams<{ triadGroupId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<TriadGroupRow | null>(null);
  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [weeks, setWeeks] = useState<TrainingWeekOption[]>([]);

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [weekId, setWeekId] = useState(NO_WEEK);
  const [coachId, setCoachId] = useState("");
  const [coacheeId, setCoacheeId] = useState("");
  const [observerId, setObserverId] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!triadGroupId) return;
    (async () => {
      setLoading(true);
      const { data: groupRow } = await supabase
        .from("triad_groups")
        .select("id, programme_id, member_1_id, member_2_id, member_3_id")
        .eq("id", triadGroupId)
        .maybeSingle();
      if (!groupRow) {
        setLoading(false);
        return;
      }
      setGroup(groupRow as TriadGroupRow);
      const memberIds = [groupRow.member_1_id, groupRow.member_2_id, groupRow.member_3_id];

      const [{ data: profileRows }, { data: lastSessionRows }, { data: weekRows }] = await Promise.all([
        supabase.from("profiles").select("id, full_name").in("id", memberIds),
        supabase
          .from("triad_sessions")
          .select("coach_role_id, coachee_role_id, observer_role_id")
          .eq("triad_group_id", triadGroupId)
          .order("session_date", { ascending: false })
          .limit(1),
        supabase
          .from("training_weeks")
          .select("id, week_number, title")
          .eq("programme_id", groupRow.programme_id)
          .eq("is_visible", true)
          .order("week_number"),
      ]);
      setMembers((profileRows || []) as MemberProfile[]);
      setWeeks((weekRows || []) as TrainingWeekOption[]);

      const last = (lastSessionRows || [])[0] as { coach_role_id: string; coachee_role_id: string; observer_role_id: string } | undefined;
      if (last) {
        // Rotate everyone into the next role: last session's Observer
        // becomes Coach, Coach becomes Coachee, Coachee becomes Observer —
        // so across 3 sessions each member has played all 3 roles once.
        setCoachId(last.observer_role_id);
        setCoacheeId(last.coach_role_id);
        setObserverId(last.coachee_role_id);
      } else {
        setCoachId(memberIds[0]);
        setCoacheeId(memberIds[1]);
        setObserverId(memberIds[2]);
      }
      setLoading(false);
    })();
  }, [triadGroupId]);

  const memberOptions = useMemo(() => members, [members]);

  const rolesValid = coachId && coacheeId && observerId && coachId !== coacheeId && coachId !== observerId && coacheeId !== observerId;
  const canSubmit = !!date && rolesValid && !submitting;

  const handleSubmit = async () => {
    if (!group || !date || !rolesValid) return;
    setSubmitting(true);
    const startTimeISO = time ? new Date(`${date}T${time}:00`).toISOString() : null;
    const { error } = await supabase.from("triad_sessions").insert({
      triad_group_id: group.id,
      training_week_id: weekId === NO_WEEK ? null : weekId,
      session_date: date,
      start_time: startTimeISO,
      coach_role_id: coachId,
      coachee_role_id: coacheeId,
      observer_role_id: observerId,
      meeting_url: meetingUrl.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(getFriendlyErrorMessage(error, t, { fallback: t("booking.errorToast") }));
      return;
    }
    toast.success(t("booking.successToast"));
    navigate("/triads");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!group) {
    return (
      <Card className="p-12 text-center">
        <Button asChild variant="outline">
          <Link to="/triads">{t("booking.back")}</Link>
        </Button>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/triads" className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> {t("booking.back")}
      </Link>

      <div>
        <h1 className="font-display text-[1.7rem] leading-[1.1] tracking-tight">{t("booking.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("booking.subtitle")}</p>
      </div>

      <Card className="space-y-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="triad-date">{t("booking.selectDate")}</Label>
            <Input id="triad-date" type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="triad-time">{t("booking.selectTime")}</Label>
            <Input id="triad-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1.5" />
          </div>
        </div>

        {weeks.length > 0 && (
          <div>
            <Label>{t("booking.weekLabel")}</Label>
            <Select value={weekId} onValueChange={setWeekId}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_WEEK}>{t("booking.weekNone")}</SelectItem>
                {weeks.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {t("training:list.weekN", { n: w.week_number })} — {w.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{t("booking.assignRoles")}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{t("booking.roleHint")}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <RoleSelect label={t("roles.coach")} value={coachId} onChange={setCoachId} members={memberOptions} />
            <RoleSelect label={t("roles.coachee")} value={coacheeId} onChange={setCoacheeId} members={memberOptions} />
            <RoleSelect label={t("roles.observer")} value={observerId} onChange={setObserverId} members={memberOptions} />
          </div>
          {!rolesValid && (coachId || coacheeId || observerId) && (
            <p className="mt-2 text-xs text-destructive">{t("booking.rolesMustDiffer")}</p>
          )}
        </div>

        <div>
          <Label htmlFor="triad-meeting-url">{t("booking.meetingUrlLabel")}</Label>
          <Input
            id="triad-meeting-url"
            value={meetingUrl}
            onChange={(e) => setMeetingUrl(e.target.value)}
            placeholder={t("booking.meetingUrlPlaceholder")}
            className="mt-1.5"
          />
        </div>

        <div className="flex justify-end border-t pt-4">
          <Button onClick={handleSubmit} disabled={!canSubmit} size="lg">
            {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {t("booking.confirmButton")}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function RoleSelect({
  label,
  value,
  onChange,
  members,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  members: MemberProfile[];
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {members.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.full_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
