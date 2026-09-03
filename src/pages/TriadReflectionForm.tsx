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

interface SessionRow {
  id: string;
  coach_role_id: string;
  coachee_role_id: string;
  observer_role_id: string;
}

interface ReflectionRow {
  participant_id: string;
  learned_as_coach: string | null;
  will_use_as_coach: string | null;
  learned_as_coachee: string | null;
  will_use_as_coachee: string | null;
  learned_as_observer: string | null;
  will_use_as_observer: string | null;
  satisfaction_rating: number | null;
}

interface ProfileRow {
  id: string;
  full_name: string;
}

const FIELDS = [
  ["learned_as_coach", "reflection.learnedAsCoach"],
  ["will_use_as_coach", "reflection.willUseAsCoach"],
  ["learned_as_coachee", "reflection.learnedAsCoachee"],
  ["will_use_as_coachee", "reflection.willUseAsCoachee"],
  ["learned_as_observer", "reflection.learnedAsObserver"],
  ["will_use_as_observer", "reflection.willUseAsObserver"],
] as const;

type FieldKey = (typeof FIELDS)[number][0];

export default function TriadReflectionForm() {
  const { t } = useTranslation("triads");
  const { sessionId } = useParams<{ sessionId: string }>();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionRow | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [reflections, setReflections] = useState<ReflectionRow[]>([]);
  const [form, setForm] = useState<Record<FieldKey, string>>({
    learned_as_coach: "",
    will_use_as_coach: "",
    learned_as_coachee: "",
    will_use_as_coachee: "",
    learned_as_observer: "",
    will_use_as_observer: "",
  });
  const [rating, setRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!sessionId || !user) return;
    (async () => {
      setLoading(true);
      const { data: sessionRow } = await supabase
        .from("triad_sessions")
        .select("id, coach_role_id, coachee_role_id, observer_role_id")
        .eq("id", sessionId)
        .maybeSingle();
      if (!sessionRow) {
        setLoading(false);
        return;
      }
      setSession(sessionRow as SessionRow);
      const memberIds = [sessionRow.coach_role_id, sessionRow.coachee_role_id, sessionRow.observer_role_id];

      const [{ data: profileRows }, { data: reflectionRows }] = await Promise.all([
        supabase.from("profiles").select("id, full_name").in("id", memberIds),
        supabase.from("triad_reflections").select("*").eq("triad_session_id", sessionId),
      ]);
      setProfiles((profileRows || []) as ProfileRow[]);
      const reflectionList = (reflectionRows || []) as ReflectionRow[];
      setReflections(reflectionList);

      const mine = reflectionList.find((r) => r.participant_id === user.id);
      if (mine) {
        setForm({
          learned_as_coach: mine.learned_as_coach || "",
          will_use_as_coach: mine.will_use_as_coach || "",
          learned_as_coachee: mine.learned_as_coachee || "",
          will_use_as_coachee: mine.will_use_as_coachee || "",
          learned_as_observer: mine.learned_as_observer || "",
          will_use_as_observer: mine.will_use_as_observer || "",
        });
        setRating(mine.satisfaction_rating || 0);
      }
      setLoading(false);
    })();
  }, [sessionId, user]);

  const myReflection = reflections.find((r) => r.participant_id === user?.id);
  const nameById = new Map(profiles.map((p) => [p.id, p.full_name]));
  const myRole = session
    ? session.coach_role_id === user?.id
      ? t("roles.coach")
      : session.coachee_role_id === user?.id
      ? t("roles.coachee")
      : t("roles.observer")
    : "";

  const handleSubmit = async () => {
    if (!session || !user) return;
    setSubmitting(true);
    const { error } = await supabase.from("triad_reflections").upsert(
      {
        triad_session_id: session.id,
        participant_id: user.id,
        ...form,
        satisfaction_rating: rating || null,
      },
      { onConflict: "triad_session_id,participant_id" }
    );
    setSubmitting(false);
    if (error) {
      toast.error(getFriendlyErrorMessage(error, t, { fallback: t("reflection.errorToast") }));
      return;
    }
    toast.success(t("reflection.successToast"));
    const { data: refreshed } = await supabase.from("triad_reflections").select("*").eq("triad_session_id", session.id);
    setReflections((refreshed || []) as ReflectionRow[]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
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
        <p className="mt-2 text-sm font-semibold text-primary">{t("reflection.yourRole", { role: myRole })}</p>
      </div>

      {myReflection && <p className="text-xs italic text-muted-foreground">{t("reflection.alreadySubmitted")}</p>}

      <Card className="space-y-5 p-5">
        {FIELDS.map(([key, labelKey]) => (
          <div key={key}>
            <Label htmlFor={key}>{t(labelKey)}</Label>
            <Textarea
              id={key}
              rows={3}
              className="mt-1.5"
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            />
          </div>
        ))}

        <div>
          <Label>{t("reflection.satisfaction")}</Label>
          <div className="mt-2 flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setRating(n)} aria-label={String(n)}>
                <Star className={cn("h-6 w-6", n <= rating ? "fill-warning text-warning" : "text-muted-foreground/40")} />
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end border-t pt-4">
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {t("reflection.submit")}
          </Button>
        </div>
      </Card>

      {myReflection && (
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("reflection.othersHeading")}</p>
          <div className="space-y-2">
            {profiles
              .filter((p) => p.id !== user?.id)
              .map((p) => {
                const r = reflections.find((x) => x.participant_id === p.id);
                return (
                  <Card key={p.id} className="p-4">
                    <p className="mb-2 text-sm font-semibold">{nameById.get(p.id)}</p>
                    {!r ? (
                      <p className="text-xs italic text-muted-foreground">{t("reflection.othersPending")}</p>
                    ) : (
                      <div className="space-y-2 text-xs text-muted-foreground">
                        {FIELDS.filter(([key]) => r[key]).map(([key, labelKey]) => (
                          <p key={key}>
                            <span className="font-semibold text-foreground">{t(labelKey)}</span> {r[key]}
                          </p>
                        ))}
                        {r.satisfaction_rating != null && (
                          <p className="flex items-center gap-1">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star key={i} className={cn("h-3.5 w-3.5", i < r.satisfaction_rating! ? "fill-warning text-warning" : "text-muted-foreground/30")} />
                            ))}
                          </p>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
