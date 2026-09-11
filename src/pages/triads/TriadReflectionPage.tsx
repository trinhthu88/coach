import { SessionGoalRatings } from "../session/SessionGoalRatings";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ChevronLeft, Loader2, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { useMyTriadReflection, useGroupReflections, useTriadReflection, type TriadReflectionInput } from "@/hooks/triads/useTriadReflection";

interface ProfileRow {
  id: string;
  full_name: string;
}

const SECTIONS = [
  { key: "coach", learned: "learned_as_coach", willUse: "will_use_as_coach" },
  { key: "coachee", learned: "learned_as_coachee", willUse: "will_use_as_coachee" },
  { key: "observer", learned: "learned_as_observer", willUse: "will_use_as_observer" },
] as const satisfies readonly { key: string; learned: keyof TriadReflectionInput; willUse: keyof TriadReflectionInput }[];

const EMPTY_FORM: TriadReflectionInput = {
  learned_as_coach: "",
  will_use_as_coach: "",
  learned_as_coachee: "",
  will_use_as_coachee: "",
  learned_as_observer: "",
  will_use_as_observer: "",
  satisfaction_rating: 0,
};

export default function TriadReflectionPage() {
  const { t } = useTranslation("triads");
  const { sessionId } = useParams<{ sessionId: string }>();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [enrollmentId, setEnrollmentId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState("");
  const [sessionExists, setSessionExists] = useState(false);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [form, setForm] = useState<TriadReflectionInput>(EMPTY_FORM);

  const { reflection: myReflection, loading: myLoading } = useMyTriadReflection(sessionId);
  const { reflections: groupReflections } = useGroupReflections(sessionId);
  const { submitReflection, submitting } = useTriadReflection();

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      const { data: session } = await supabase.from("triad_sessions").select("id, triad_group_id, status, coach_enrollment_id, coachee_enrollment_id, observer_enrollment_id").eq("id", sessionId).maybeSingle();
      if (!session) {
        setSessionExists(false);
        setLoading(false);
        return;
      }
      setSessionExists(true);
      setSessionStatus(session.status);
      const enrollmentIds = [session.coach_enrollment_id, session.coachee_enrollment_id, session.observer_enrollment_id].filter((id): id is string => !!id);
      const { data: ownEnrollments } = await supabase.from("programme_enrollments").select("id").in("id", enrollmentIds).eq("user_id", user?.id ?? "");
      setEnrollmentId(ownEnrollments?.length === 1 ? ownEnrollments[0].id : null);
      const { data: group } = await supabase
        .from("triad_groups")
        .select("member_1_id, member_2_id, member_3_id")
        .eq("id", session.triad_group_id)
        .maybeSingle();
      const memberIds = [group?.member_1_id, group?.member_2_id, group?.member_3_id].filter(Boolean) as string[];
      const { data: profileRows } = memberIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", memberIds)
        : { data: [] };
      setProfiles((profileRows ?? []) as ProfileRow[]);
      setLoading(false);
    })();
  }, [sessionId, user?.id]);

  const nameById = new Map(profiles.map((p) => [p.id, p.full_name]));

  const handleSubmit = async () => {
    if (!sessionId) return;
    try {
      await submitReflection({ sessionId, data: form });
      toast.success(t("reflection.successToast"));
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, t, { fallback: t("reflection.errorToast") }));
    }
  };

  if (loading || myLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!sessionExists) {
    return (
      <Card className="mx-auto max-w-xl rounded-[20px] border-[#e8e2d8] p-12 text-center">
        <p className="text-sm text-muted-foreground">{t("reflection.notFound")}</p>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/triads">{t("reflection.back")}</Link>
        </Button>
      </Card>
    );
  }

  const memberNames = profiles.map((p) => p.full_name).join(" | ");

  return (
    <div className="mx-auto max-w-[760px] space-y-6">
      {enrollmentId && sessionId && user && <SessionGoalRatings sessionId={sessionId} coacheeId={user.id} enrollmentId={enrollmentId} sourceActivityType="triad" canCreateGoal canEdit={sessionStatus === "completed"} sessionStatus={sessionStatus} />}
      <Link to="/triads" className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-[#2c8fa8]">
        <ChevronLeft className="h-4 w-4" /> {t("reflection.back")}
      </Link>

      <div>
        <p className="text-[9.5px] font-bold uppercase tracking-[.22em] text-primary">{t("eyebrow")}</p>
        <h1 className="font-display mt-2 text-[1.9rem] leading-[1.08] tracking-[-0.02em]">{t("reflection.title")}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("reflection.subtitle")}</p>
      </div>

      {memberNames && (
        <div className="rounded-[14px] bg-primary-soft px-[18px] py-[14px] text-[12.5px] text-[#1d5a6b]">
          <span className="font-bold">{t("reflection.membersBannerLabel")}</span> {memberNames}
        </div>
      )}

      {myReflection ? (
        <>
          <p className="text-xs italic text-muted-foreground">{t("reflection.alreadySubmitted")}</p>
          {SECTIONS.map((sec) => (
            <div key={sec.key} className="space-y-3 rounded-[20px] border border-[#e8e2d8] bg-card p-6">
              <p className="font-display text-[21px] font-normal tracking-[-0.01em]">{t(`reflection.sections.${sec.key}`)}</p>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  <span className="font-semibold text-foreground">{t(`reflection.learnedAs${sec.key === "coach" ? "Coach" : sec.key === "coachee" ? "Coachee" : "Observer"}`)}:</span>{" "}
                  {myReflection[sec.learned] || "—"}
                </p>
                <p>
                  <span className="font-semibold text-foreground">{t(`reflection.willUseAs${sec.key === "coach" ? "Coach" : sec.key === "coachee" ? "Coachee" : "Observer"}`)}:</span>{" "}
                  {myReflection[sec.willUse] || "—"}
                </p>
              </div>
            </div>
          ))}
        </>
      ) : (
        <>
          {SECTIONS.map((sec) => (
            <div key={sec.key} className="space-y-5 rounded-[20px] border border-[#e8e2d8] bg-card p-6">
              <p className="font-display text-[21px] font-normal tracking-[-0.01em]">{t(`reflection.sections.${sec.key}`)}</p>
              <div>
                <Label htmlFor={sec.learned} className="text-xs font-semibold text-[#4a463f]">
                  {t(`reflection.learnedAs${sec.key === "coach" ? "Coach" : sec.key === "coachee" ? "Coachee" : "Observer"}`)}
                </Label>
                <Textarea
                  id={sec.learned}
                  rows={3}
                  className="mt-1.5 rounded-[14px] border-[#dcd5c9] bg-[#faf8f4] text-[13.5px]"
                  value={form[sec.learned] as string}
                  onChange={(e) => setForm((f) => ({ ...f, [sec.learned]: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor={sec.willUse} className="text-xs font-semibold text-[#4a463f]">
                  {t(`reflection.willUseAs${sec.key === "coach" ? "Coach" : sec.key === "coachee" ? "Coachee" : "Observer"}`)}
                </Label>
                <Textarea
                  id={sec.willUse}
                  rows={3}
                  className="mt-1.5 rounded-[14px] border-[#dcd5c9] bg-[#faf8f4] text-[13.5px]"
                  value={form[sec.willUse] as string}
                  onChange={(e) => setForm((f) => ({ ...f, [sec.willUse]: e.target.value }))}
                />
              </div>
            </div>
          ))}

          <div className="space-y-4 rounded-[20px] border border-[#e8e2d8] bg-card p-6">
            <p className="font-display text-[21px] font-normal tracking-[-0.01em]">{t("reflection.satisfaction")}</p>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, satisfaction_rating: n }))}
                  aria-label={String(n)}
                  className="transition-transform hover:scale-[1.12]"
                >
                  <Star
                    className={cn(
                      "h-[30px] w-[30px]",
                      n <= form.satisfaction_rating ? "fill-[#e8a33d] text-[#e8a33d]" : "fill-none text-[#d6cfc4]"
                    )}
                  />
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full rounded-[14px] bg-primary px-6 py-[15px] text-[13px] font-semibold text-secondary shadow-[0_14px_30px_-16px_rgba(61,180,208,.9)] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
          >
            {submitting && <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />}
            {t("reflection.submit")}
          </button>
        </>
      )}

      <div>
        <p className="mb-2 text-[9.5px] font-bold uppercase tracking-[.24em] text-muted-foreground">{t("reflection.othersHeading")}</p>
        {groupReflections.length === 0 ? (
          <div className="rounded-[16px] border border-[#efeae1] bg-[#faf8f4] p-4 text-center text-xs italic text-muted-foreground">
            {myReflection ? t("reflection.othersLocked") : t("reflection.othersPending")}
          </div>
        ) : (
          <div className="space-y-2">
            {groupReflections
              .filter((r) => r.participant_id !== user?.id)
              .map((r) => (
                <div key={r.id} className="space-y-2 rounded-[16px] border border-[#efeae1] bg-[#faf8f4] p-4 text-xs text-muted-foreground">
                  <p className="mb-1 text-sm font-semibold text-foreground">{nameById.get(r.participant_id) || "—"}</p>
                  {SECTIONS.flatMap((sec) => [r[sec.learned], r[sec.willUse]]).some(Boolean) &&
                    SECTIONS.map((sec) => (
                      <p key={sec.key}>
                        <span className="font-semibold text-foreground">{t(`reflection.sections.${sec.key}`)}:</span>{" "}
                        {r[sec.learned] || "—"} / {r[sec.willUse] || "—"}
                      </p>
                    ))}
                  {r.satisfaction_rating != null && (
                    <p className="flex items-center gap-1">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={cn("h-3.5 w-3.5", i < r.satisfaction_rating! ? "fill-[#e8a33d] text-[#e8a33d]" : "fill-none text-[#d6cfc4]")}
                        />
                      ))}
                    </p>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
