import { SessionGoalRatings } from "../session/SessionGoalRatings";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ChevronLeft, Loader2, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { useTriadSessionEntry } from "@/hooks/triads/useMyTriads";
import {
  useTriadReflection,
  useTriadReflectionQuestions,
  useTriadSessionReflections,
  type TriadReflectionQuestion,
  type TriadReflectionSection,
} from "@/hooks/triads/useTriadReflection";

const SECTION_ORDER: TriadReflectionSection[] = ["coach", "coachee", "observer", "general"];
const ROLE_SECTIONS: TriadReflectionSection[] = ["coach", "coachee", "observer"];

/**
 * One learner experience, three canonical owners:
 *  - goal self-rating / comment -> goal check-ins (SessionGoalRatings);
 *  - reflection answers -> triad_reflection_answers (by stable question id);
 *  - satisfaction -> the reflection submission.
 * Nothing is copied between them.
 */
export default function TriadReflectionPage() {
  const { t, i18n } = useTranslation("triads");
  const { sessionId } = useParams<{ sessionId: string }>();
  const { user } = useAuth();
  const vi = i18n.language?.startsWith("vi");

  const { entry, loading } = useTriadSessionEntry(sessionId);
  const { questions, loading: questionsLoading } = useTriadReflectionQuestions(sessionId);
  const { reflections, loading: reflectionsLoading } = useTriadSessionReflections(sessionId);
  const { submitReflection, submitting } = useTriadReflection();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [satisfaction, setSatisfaction] = useState(0);
  // Roles rotate and the canonical model stores no per-session role, so the
  // learner says which role they played; only that role's questions (plus the
  // general ones) are asked. Answers stay keyed by stable question id.
  const [role, setRole] = useState<TriadReflectionSection | null>(null);

  const sections = useMemo(() => {
    const bySection = new Map<TriadReflectionSection, TriadReflectionQuestion[]>();
    for (const q of questions) bySection.set(q.section, [...(bySection.get(q.section) ?? []), q]);
    return SECTION_ORDER.filter((key) => bySection.has(key)).map((key) => ({ key, questions: bySection.get(key)! }));
  }, [questions]);

  const hasRoleSections = sections.some((sec) => ROLE_SECTIONS.includes(sec.key));
  const askedSections = sections.filter((sec) => !ROLE_SECTIONS.includes(sec.key) || !hasRoleSections || sec.key === role);
  const askedQuestions = askedSections.flatMap((sec) => sec.questions);

  const session = entry?.session ?? null;
  const mine = reflections.find((r) => r.isSelf) ?? null;
  const others = reflections.filter((r) => !r.isSelf);
  const nameBySlot = new Map((entry?.members ?? []).map((m) => [m.slot, m.full_name]));
  const label = (q: { label?: string; labelVi?: string | null; question?: string; questionVi?: string | null }) =>
    (vi ? q.labelVi ?? q.questionVi : null) ?? q.label ?? q.question ?? "";

  const handleSubmit = async () => {
    if (!sessionId) return;
    try {
      await submitReflection({
        sessionId,
        data: {
          satisfactionRating: satisfaction || null,
          answers: askedQuestions.map((q) => ({ questionId: q.id, answerText: answers[q.id] ?? "" })).filter((a) => a.answerText.trim()),
        },
      });
      toast.success(t("reflection.successToast"));
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, t, { fallback: t("reflection.errorToast") }));
    }
  };

  if (loading || questionsLoading || reflectionsLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!entry || !session) {
    return (
      <Card className="mx-auto max-w-xl rounded-[20px] border-[#e8e2d8] p-12 text-center">
        <p className="text-sm text-muted-foreground">{t("reflection.notFound")}</p>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/triads">{t("reflection.back")}</Link>
        </Button>
      </Card>
    );
  }

  const memberNames = entry.members.map((m) => m.full_name).join(" | ");
  const completed = session.status === "completed";

  return (
    <div className="mx-auto max-w-[760px] space-y-6">
      {user && (
        <SessionGoalRatings
          sessionId={session.id}
          coacheeId={user.id}
          enrollmentId={entry.enrollmentId}
          sourceActivityType="triad"
          canCreateGoal
          canEdit={completed}
          sessionStatus={session.status}
        />
      )}
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

      {mine ? (
        <>
          <p className="text-xs italic text-muted-foreground">{t("reflection.alreadySubmitted")}</p>
          {sections
            .filter((sec) => sec.questions.some((q) => mine.answers.some((a) => a.questionId === q.id)))
            .map((sec) => (
            <div key={sec.key} className="space-y-3 rounded-[20px] border border-[#e8e2d8] bg-card p-6">
              <p className="font-display text-[21px] font-normal tracking-[-0.01em]">{t(`reflection.sections.${sec.key}`)}</p>
              <div className="space-y-2 text-sm text-muted-foreground">
                {sec.questions.map((q) => (
                  <p key={q.id}>
                    <span className="font-semibold text-foreground">{label(q)}:</span>{" "}
                    {mine.answers.find((a) => a.questionId === q.id)?.answer || "—"}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </>
      ) : !completed ? (
        <p className="rounded-[16px] border border-[#efeae1] bg-[#faf8f4] p-4 text-center text-xs italic text-muted-foreground">{t("reflection.afterCompletion")}</p>
      ) : (
        <>
          {hasRoleSections && (
            <div className="space-y-3 rounded-[20px] border border-[#e8e2d8] bg-card p-6" data-testid="triad-role-picker">
              <p className="font-display text-[21px] font-normal tracking-[-0.01em]">{t("reflection.roleLabel")}</p>
              <p className="text-xs text-muted-foreground">{t("reflection.roleHelp")}</p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("reflection.roleLabel")}>
                {ROLE_SECTIONS.filter((key) => sections.some((sec) => sec.key === key)).map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={role === key}
                    onClick={() => setRole(key)}
                    className={cn(
                      "rounded-full border px-4 py-2 text-xs font-semibold",
                      role === key ? "border-primary bg-primary-soft text-[#1d5a6b]" : "border-[#dcd5c9] bg-[#faf8f4] text-[#4a463f]",
                    )}
                  >
                    {t(`reflection.sections.${key}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {askedSections.map((sec) => (
            <div key={sec.key} className="space-y-5 rounded-[20px] border border-[#e8e2d8] bg-card p-6">
              <p className="font-display text-[21px] font-normal tracking-[-0.01em]">{t(`reflection.sections.${sec.key}`)}</p>
              {sec.questions.map((q) => (
                <div key={q.id}>
                  <Label htmlFor={`q-${q.id}`} className="text-xs font-semibold text-[#4a463f]">
                    {label(q)}
                  </Label>
                  <Textarea
                    id={`q-${q.id}`}
                    rows={3}
                    className="mt-1.5 rounded-[14px] border-[#dcd5c9] bg-[#faf8f4] text-[13.5px]"
                    value={answers[q.id] ?? ""}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          ))}

          <div className="space-y-4 rounded-[20px] border border-[#e8e2d8] bg-card p-6">
            <p className="font-display text-[21px] font-normal tracking-[-0.01em]">{t("reflection.satisfaction")}</p>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setSatisfaction(n)} aria-label={String(n)} className="transition-transform hover:scale-[1.12]">
                  <Star className={cn("h-[30px] w-[30px]", n <= satisfaction ? "fill-[#e8a33d] text-[#e8a33d]" : "fill-none text-[#d6cfc4]")} />
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting || (hasRoleSections && !role)}
            className="w-full rounded-[14px] bg-primary px-6 py-[15px] text-[13px] font-semibold text-secondary shadow-[0_14px_30px_-16px_rgba(61,180,208,.9)] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
          >
            {submitting && <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />}
            {t("reflection.submit")}
          </button>
        </>
      )}

      <div>
        <p className="mb-2 text-[9.5px] font-bold uppercase tracking-[.24em] text-muted-foreground">{t("reflection.othersHeading")}</p>
        {others.length === 0 ? (
          <div className="rounded-[16px] border border-[#efeae1] bg-[#faf8f4] p-4 text-center text-xs italic text-muted-foreground">
            {mine ? t("reflection.othersLocked") : t("reflection.othersPending")}
          </div>
        ) : (
          <div className="space-y-2">
            {others.map((r) => (
              <div key={r.slot} data-testid="triad-group-reflection" className="space-y-2 rounded-[16px] border border-[#efeae1] bg-[#faf8f4] p-4 text-xs text-muted-foreground">
                <p className="mb-1 text-sm font-semibold text-foreground">{nameBySlot.get(r.slot) || "—"}</p>
                {r.answers.map((a) => (
                  <p key={a.questionId}>
                    <span className="font-semibold text-foreground">
                      {t(`reflection.sections.${a.section}`)} · {label(a)}:
                    </span>{" "}
                    {a.answer}
                  </p>
                ))}
                {r.satisfactionRating != null && (
                  <p className="flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className={cn("h-3.5 w-3.5", i < r.satisfactionRating! ? "fill-[#e8a33d] text-[#e8a33d]" : "fill-none text-[#d6cfc4]")} />
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
