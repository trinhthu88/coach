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
  const [sessionExists, setSessionExists] = useState(false);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [form, setForm] = useState<TriadReflectionInput>(EMPTY_FORM);

  const { reflection: myReflection, loading: myLoading } = useMyTriadReflection(sessionId);
  const { reflections: groupReflections } = useGroupReflections(sessionId);
  const { submitReflection, submitting } = useTriadReflection();

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      const { data: session } = await supabase.from("triad_sessions").select("id, triad_group_id").eq("id", sessionId).maybeSingle();
      if (!session) {
        setSessionExists(false);
        setLoading(false);
        return;
      }
      setSessionExists(true);
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
  }, [sessionId]);

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
      <Card className="mx-auto max-w-xl p-12 text-center">
        <p className="text-sm text-muted-foreground">{t("reflection.notFound")}</p>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/triads">{t("reflection.back")}</Link>
        </Button>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/triads" className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> {t("reflection.back")}
      </Link>

      <div>
        <h1 className="font-display text-[1.7rem] leading-[1.1] tracking-tight">{t("reflection.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("reflection.subtitle")}</p>
      </div>

      {myReflection ? (
        <>
          <p className="text-xs italic text-muted-foreground">{t("reflection.alreadySubmitted")}</p>
          {SECTIONS.map((sec) => (
            <Card key={sec.key} className="space-y-3 p-6">
              <p className="font-display text-xl font-normal tracking-tight">{t(`reflection.sections.${sec.key}`)}</p>
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
            </Card>
          ))}
        </>
      ) : (
        <>
          {SECTIONS.map((sec) => (
            <Card key={sec.key} className="space-y-5 p-6">
              <p className="font-display text-xl font-normal tracking-tight">{t(`reflection.sections.${sec.key}`)}</p>
              <div>
                <Label htmlFor={sec.learned}>{t(`reflection.learnedAs${sec.key === "coach" ? "Coach" : sec.key === "coachee" ? "Coachee" : "Observer"}`)}</Label>
                <Textarea
                  id={sec.learned}
                  rows={3}
                  className="mt-1.5"
                  value={form[sec.learned] as string}
                  onChange={(e) => setForm((f) => ({ ...f, [sec.learned]: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor={sec.willUse}>{t(`reflection.willUseAs${sec.key === "coach" ? "Coach" : sec.key === "coachee" ? "Coachee" : "Observer"}`)}</Label>
                <Textarea
                  id={sec.willUse}
                  rows={3}
                  className="mt-1.5"
                  value={form[sec.willUse] as string}
                  onChange={(e) => setForm((f) => ({ ...f, [sec.willUse]: e.target.value }))}
                />
              </div>
            </Card>
          ))}

          <Card className="space-y-4 p-6">
            <p className="font-display text-xl font-normal tracking-tight">{t("reflection.satisfaction")}</p>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, satisfaction_rating: n }))}
                  aria-label={String(n)}
                  className="transition-transform hover:scale-110"
                >
                  <Star className={cn("h-7 w-7", n <= form.satisfaction_rating ? "fill-warning text-warning" : "text-muted-foreground/40")} />
                </button>
              ))}
            </div>
          </Card>

          <Button onClick={handleSubmit} disabled={submitting} size="lg" className="w-full">
            {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {t("reflection.submit")}
          </Button>
        </>
      )}

      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("reflection.othersHeading")}</p>
        {groupReflections.length === 0 ? (
          <Card className="p-4 text-center text-xs italic text-muted-foreground">
            {myReflection ? t("reflection.othersLocked") : t("reflection.othersPending")}
          </Card>
        ) : (
          <div className="space-y-2">
            {groupReflections
              .filter((r) => r.participant_id !== user?.id)
              .map((r) => (
                <Card key={r.id} className="space-y-2 p-4 text-xs text-muted-foreground">
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
                        <Star key={i} className={cn("h-3.5 w-3.5", i < r.satisfaction_rating! ? "fill-warning text-warning" : "text-muted-foreground/30")} />
                      ))}
                    </p>
                  )}
                </Card>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
