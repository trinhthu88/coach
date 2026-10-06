import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { formatAssessmentDate } from "@/lib/assessments";
import { ProfileLoadError, ProfileSection, ProfileSectionTitle } from "@/components/programme/primitives";
import { useLearnerFinalAssessmentFor } from "@/hooks/assessments/useLearnerFinalAssessment";
import { useSponsorFinalAssessment, type AdminFinalAssessment } from "@/hooks/assessments/useFinalAssessmentResult";

/**
 * The Final Assessment's state and result on Learner My Journey, Admin
 * enrollment detail and Sponsor leader detail. Each surface reads its own
 * role wrapper over canonical_final_assessment_result, and shows only what
 * that wrapper returns:
 *   Learner  state, result, and the quiz score only once released
 *   Admin    state, attempt, quiz score vs pass mark, the assessor's outcome
 *   Sponsor  Not submitted / Under review / Completed + Pass / Not pass
 *            (Resubmit is Under review)
 * Nothing renders for a programme without a Final Assessment.
 */

type Tone = "muted" | "progress" | "success" | "warning";

function toneOf(state: string, result: string | null): Tone {
  if (state === "completed") return result === "not_pass" ? "warning" : "success";
  if (state === "not_submitted") return "muted";
  return "progress";
}

const TONE_CLASS: Record<Tone, string> = {
  muted: "bg-[#f1ede6] text-[#6a6560]",
  progress: "bg-[#e4f1f5] text-[#226d80]",
  success: "bg-[#e8f1ec] text-[#17663f]",
  warning: "bg-[#fbeee5] text-[#a8541c]",
};

function StatusPill({ tone, children, testId }: { tone: Tone; children: ReactNode; testId: string }) {
  return (
    <span data-testid={testId} className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.08em]", TONE_CLASS[tone])}>
      {children}
    </span>
  );
}

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div>
      <dt className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[#9a938a]">{label}</dt>
      <dd className="mt-0.5 text-[12.5px]" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

function QuizLine({ correct, total, pct, passMark, passed }: { correct: number | null; total: number; pct: number | null; passMark: number | null; passed: boolean | null }) {
  const { t } = useTranslation("assessments");
  return (
    <>
      {t("feedback.quizScore", { correct: correct ?? 0, total, pct: Math.round(pct ?? 0) })}
      {passMark != null && passed != null && ` · ${t(passed ? "final.abovePassMark" : "final.belowPassMark", { pct: passMark })}`}
    </>
  );
}

/** My Journey (learner). */
export function LearnerFinalAssessmentSection({ enrollmentId }: { enrollmentId: string | null | undefined }) {
  const { t } = useTranslation("assessments");
  const { data: fa, isLoading, isError } = useLearnerFinalAssessmentFor(enrollmentId);
  if (isLoading || (!isError && !fa)) return null;
  return (
    <ProfileSection id="final-assessment" className="scroll-mt-4">
      <div data-testid="learner-final-assessment">
        <ProfileSectionTitle
          title={t("results.title")}
          aside={
            fa ? (
              <StatusPill tone={toneOf(fa.state, fa.finalResult)} testId="final-assessment-state">
                {t(`final.state.${fa.state}`)}
              </StatusPill>
            ) : undefined
          }
        />
        {isError || !fa ? (
          <ProfileLoadError text={t("final.loadError")} />
        ) : (
          <>
            <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
              {fa.finalResult && (
                <Row label={t("results.result")} testId="final-assessment-result">
                  {t(`outcome.${fa.finalResult}`)}
                </Row>
              )}
              {/* learner_final_assessment returns the score only once released. */}
              {fa.quizTotal != null && (
                <Row label={t("results.quiz")} testId="final-assessment-quiz">
                  <QuizLine correct={fa.quizCorrect} total={fa.quizTotal} pct={fa.quizScorePct} passMark={fa.passMarkPct} passed={fa.quizPassed} />
                </Row>
              )}
              {fa.state !== "completed" && fa.dueOn && <Row label={t("results.due")}>{formatAssessmentDate(fa.dueOn)}</Row>}
              {fa.attemptNo > 1 && <Row label={t("results.attempt")}>{t("final.attemptN", { n: fa.attemptNo })}</Row>}
            </dl>
            <Link to="/final-assessment" className="mt-3 inline-block text-[12px] font-semibold text-primary hover:underline">
              {t(fa.state === "not_submitted" || fa.state === "resubmit_requested" ? "results.open" : "results.view")}
            </Link>
          </>
        )}
      </div>
    </ProfileSection>
  );
}

/** Admin -> enrollment detail (the panel reads useAdminFinalAssessment and frames it). */
export function AdminFinalAssessmentDetail({ fa }: { fa: AdminFinalAssessment }) {
  const { t } = useTranslation("assessments");
  return (
    <div data-testid="admin-final-assessment" className="space-y-3">
      <StatusPill tone={toneOf(fa.state, fa.finalResult)} testId="final-assessment-state">
        {t(`final.state.${fa.state}`)}
      </StatusPill>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Row label={t("results.attempt")}>{t("final.attemptN", { n: fa.attemptNo })}</Row>
        <Row label={t("results.due")}>{formatAssessmentDate(fa.dueOn)}</Row>
        <Row label={t("results.submitted")}>{formatAssessmentDate(fa.submittedAt)}</Row>
        <Row label={t("results.released")}>{formatAssessmentDate(fa.releasedAt)}</Row>
        <Row label={t("results.quiz")} testId="final-assessment-quiz">
          {fa.quizTotal != null ? (
            <QuizLine correct={fa.quizCorrect} total={fa.quizTotal} pct={fa.quizScorePct} passMark={fa.passMarkPct} passed={fa.quizPassed} />
          ) : (
            "—"
          )}
        </Row>
        <Row label={t("results.outcome")} testId="final-assessment-outcome">
          {fa.outcome ? t(`outcome.${fa.outcome}`) : "—"}
        </Row>
        <Row label={t("results.result")} testId="final-assessment-result">
          {fa.finalResult ? t(`outcome.${fa.finalResult}`) : "—"}
        </Row>
      </dl>
    </div>
  );
}

/** Sponsor -> leader detail: status and Pass / Not pass only. */
export function SponsorFinalAssessmentSection({ enrollmentId }: { enrollmentId: string }) {
  const { t } = useTranslation("assessments");
  const { data: fa, isLoading, isError } = useSponsorFinalAssessment(enrollmentId);
  if (isLoading || (!isError && !fa)) return null;
  return (
    <ProfileSection className="mt-4">
      <div data-testid="sponsor-final-assessment">
        <ProfileSectionTitle
          title={t("results.title")}
          aside={
            fa ? (
              <StatusPill tone={toneOf(fa.status, fa.result)} testId="final-assessment-state">
                {t(`results.sponsorState.${fa.status}`)}
              </StatusPill>
            ) : undefined
          }
        />
        {isError || !fa ? (
          <ProfileLoadError text={t("final.loadError")} />
        ) : (
          fa.result && (
            <p className="mt-3 text-[13px]" data-testid="final-assessment-result">
              {t("results.result")}: <span className="font-semibold">{t(`outcome.${fa.result}`)}</span>
            </p>
          )
        )}
        <p className="mt-2 text-[10.5px] text-[#9a938a]">{t("results.sponsorNote")}</p>
      </div>
    </ProfileSection>
  );
}

