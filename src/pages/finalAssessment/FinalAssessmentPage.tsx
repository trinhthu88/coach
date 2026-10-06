import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { formatAssessmentDate } from "@/lib/assessments";
import { ModuleCard, ModuleEyebrow, ModulePageHeader } from "@/components/programme/module/ModulePage";
import { ProfileLoadError } from "@/components/programme/primitives";
import { useAuth } from "@/context/AuthContext";
import {
  RecordingFileError,
  checkRecording,
  useFinalAssessmentQuiz,
  useLearnerFinalAssessment,
  useSubmitFinalAssessment,
  useSubmitFinalAssessmentQuiz,
  useUploadRecording,
  type LearnerFinalAssessment,
} from "@/hooks/assessments/useLearnerFinalAssessment";

type StepKey = "quiz" | "recording" | "transcript" | "review";

/**
 * Final Assessment (learner). Four steps -- quiz, MP3 recording, transcript,
 * review & submit -- then the submission's status, and once Admin releases
 * it the result. The quiz score is shown only with the released result.
 */
export default function FinalAssessmentPage() {
  const { t, i18n } = useTranslation("assessments");
  const vi = i18n.language.startsWith("vi");
  const { enrollmentId, data, loading, error } = useLearnerFinalAssessment();

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const instructions = data ? (vi && data.instructionsVi) || data.instructions : null;

  return (
    <div className="flex flex-col gap-[18px]" data-testid="final-assessment-page">
      <ModulePageHeader
        title={t("final.title")}
        subtitle={t("final.subtitle")}
        action={
          data?.dueOn ? (
            <span className="rounded-full bg-[#e4f1f5] px-[13px] py-2 text-[9px] font-extrabold uppercase tracking-[.08em] text-[#226d80]">
              {t("final.due", { date: formatAssessmentDate(data.dueOn) })}
            </span>
          ) : undefined
        }
      />
      {error ? (
        <ProfileLoadError text={t("final.loadError")} />
      ) : !data || !enrollmentId ? (
        <ModuleCard testId="final-assessment-none">
          <p className="text-[12px] text-[#7d7468]">{t("final.notInProgramme")}</p>
        </ModuleCard>
      ) : (
        <>
          {instructions && (
            <ModuleCard testId="final-assessment-instructions">
              <ModuleEyebrow>{t("final.instructions")}</ModuleEyebrow>
              <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-[#4a463f]">{instructions}</p>
            </ModuleCard>
          )}
          {data.state === "not_submitted" || data.state === "resubmit_requested" ? (
            // Keyed by attempt: a new attempt starts from a clean form.
            <FinalAssessmentSteps key={data.attemptNo} enrollmentId={enrollmentId} fa={data} />
          ) : (
            <FinalAssessmentStatus fa={data} />
          )}
        </>
      )}
    </div>
  );
}

function FinalAssessmentStatus({ fa }: { fa: LearnerFinalAssessment }) {
  const { t } = useTranslation("assessments");
  const { role } = useAuth();
  const journey = role === "coach" ? "/coach/my-journey#feedback-results" : "/coachee/journey#feedback-results";
  if (fa.state !== "completed") {
    return (
      <ModuleCard testId="final-assessment-status" className="space-y-1">
        <ModuleEyebrow>{t(`final.state.${fa.state}`)}</ModuleEyebrow>
        <p className="text-[13px] text-[#4a463f]">
          {t(fa.state === "submitted" ? "final.submittedBody" : "final.underReviewBody", {
            date: formatAssessmentDate(fa.submittedAt),
          })}
        </p>
        {fa.attemptNo > 1 && <p className="text-[11px] text-[#9a938a]">{t("final.attemptN", { n: fa.attemptNo })}</p>}
      </ModuleCard>
    );
  }
  return (
    <ModuleCard testId="final-assessment-result" className="space-y-3">
      <ModuleEyebrow>{t("final.state.completed")}</ModuleEyebrow>
      {fa.finalResult && (
        <p
          data-testid="final-assessment-final-result"
          className={cn("font-serif text-[24px]", fa.finalResult === "pass" ? "text-[#17663f]" : "text-[#a8541c]")}
        >
          {t(`outcome.${fa.finalResult}`)}
        </p>
      )}
      {fa.quizTotal != null && (
        <p className="text-[12px] text-[#4a463f]" data-testid="final-assessment-quiz-result">
          {t("feedback.quizScore", { correct: fa.quizCorrect ?? 0, total: fa.quizTotal, pct: Math.round(fa.quizScorePct ?? 0) })}
          {fa.passMarkPct != null &&
            ` · ${t(fa.quizPassed ? "final.abovePassMark" : "final.belowPassMark", { pct: fa.passMarkPct })}`}
        </p>
      )}
      {fa.finalResult === "not_pass" && <p className="text-[12px] text-[#7d7468]">{t("final.notPassFinal")}</p>}
      <Link to={journey} className="text-[12px] font-semibold text-primary hover:underline">
        {t("final.readFeedback")}
      </Link>
    </ModuleCard>
  );
}

function FinalAssessmentSteps({ enrollmentId, fa }: { enrollmentId: string; fa: LearnerFinalAssessment }) {
  const { t } = useTranslation("assessments");
  // One id per attempt, so the recording lands under its submission's path.
  const [submissionId] = useState(() => crypto.randomUUID());
  const steps = useMemo<StepKey[]>(
    () => [
      ...(fa.quizEnabled ? (["quiz"] as const) : []),
      "recording",
      ...(fa.transcriptMode !== "none" ? (["transcript"] as const) : []),
      "review",
    ],
    [fa.quizEnabled, fa.transcriptMode],
  );
  const [step, setStep] = useState<StepKey>(steps[0]);
  const [recordingPath, setRecordingPath] = useState<string | null>(null);
  const [recordingName, setRecordingName] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const submit = useSubmitFinalAssessment(enrollmentId);

  const done: Record<StepKey, boolean> = {
    quiz: fa.quizTaken,
    recording: !!recordingPath,
    transcript: fa.transcriptMode !== "required" || !!transcript.trim(),
    review: false,
  };
  const ready = steps.filter((s) => s !== "review").every((s) => done[s]);
  const index = steps.indexOf(step);

  const send = () =>
    submit.mutate(
      {
        submissionId,
        requirementId: fa.requirementId,
        quizSubmissionId: fa.quizSubmissionId,
        recordingPath: recordingPath!,
        transcriptText: transcript,
      },
      {
        onSuccess: () => toast.success(t("final.submittedToast")),
        onError: (e) => toast.error(getFriendlyErrorMessage(e, t)),
      },
    );

  return (
    <div className="space-y-4">
      {fa.state === "resubmit_requested" && (
        <ModuleCard testId="final-assessment-resubmit">
          <p className="text-[12.5px] text-[#4a463f]">{t("final.resubmitBody", { n: fa.attemptNo })}</p>
        </ModuleCard>
      )}
      <ol className="flex flex-wrap gap-2" data-testid="final-assessment-steps">
        {steps.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => setStep(s)}
              data-testid={`final-step-${s}`}
              data-current={s === step ? "true" : "false"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px]",
                s === step ? "border-[#2c8fa8] bg-[#e4f1f5] text-[#062f3e]" : "border-[#efeae1] bg-white text-[#4a463f]",
              )}
            >
              {done[s] ? <CheckCircle2 className="h-3.5 w-3.5 text-[#17663f]" /> : <Circle className="h-3.5 w-3.5" />}
              {i + 1}. {t(`final.steps.${s}`)}
            </button>
          </li>
        ))}
      </ol>

      <ModuleCard testId={`final-step-panel-${step}`}>
        {step === "quiz" && <QuizStep enrollmentId={enrollmentId} fa={fa} />}
        {step === "recording" && (
          <RecordingStep
            enrollmentId={enrollmentId}
            submissionId={submissionId}
            maxFileMb={fa.maxFileMb}
            uploadedName={recordingName}
            onUploaded={(path, name) => {
              setRecordingPath(path);
              setRecordingName(name);
            }}
          />
        )}
        {step === "transcript" && (
          <div className="space-y-2">
            <Label htmlFor="final-transcript">{t("final.transcriptLabel")}</Label>
            <p className="text-[11px] text-[#9a938a]">
              {t(fa.transcriptMode === "required" ? "final.transcriptRequired" : "final.transcriptOptional")}
            </p>
            <Textarea
              id="final-transcript"
              rows={10}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder={t("final.transcriptPlaceholder")}
              data-testid="final-transcript"
            />
          </div>
        )}
        {step === "review" && (
          <div className="space-y-3" data-testid="final-review">
            <ul className="space-y-1.5 text-[12.5px]">
              {steps
                .filter((s) => s !== "review")
                .map((s) => (
                  <li key={s} className="flex items-center gap-2" data-testid={`final-review-${s}`} data-done={done[s] ? "true" : "false"}>
                    {done[s] ? <CheckCircle2 className="h-4 w-4 text-[#17663f]" /> : <Circle className="h-4 w-4 text-[#a8541c]" />}
                    {s === "quiz" && t(done.quiz ? "final.review.quizDone" : "final.review.quizMissing")}
                    {s === "recording" && (done.recording ? t("final.review.recordingDone", { name: recordingName }) : t("final.review.recordingMissing"))}
                    {s === "transcript" &&
                      (transcript.trim()
                        ? t("final.review.transcriptDone")
                        : t(fa.transcriptMode === "required" ? "final.review.transcriptMissing" : "final.review.transcriptSkipped"))}
                  </li>
                ))}
            </ul>
            <p className="text-[11px] text-[#9a938a]">{t("final.review.lockedAfterSubmit")}</p>
            <Button onClick={send} disabled={!ready || submit.isPending} data-testid="final-submit">
              {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("final.review.submit")}
            </Button>
          </div>
        )}
      </ModuleCard>

      <div className="flex justify-between">
        <Button variant="outline" disabled={index <= 0} onClick={() => setStep(steps[index - 1])}>
          {t("final.back")}
        </Button>
        {index < steps.length - 1 && (
          <Button variant="outline" onClick={() => setStep(steps[index + 1])} data-testid="final-next">
            {t("final.next")}
          </Button>
        )}
      </div>
    </div>
  );
}

function QuizStep({ enrollmentId, fa }: { enrollmentId: string; fa: LearnerFinalAssessment }) {
  const { t, i18n } = useTranslation("assessments");
  const vi = i18n.language.startsWith("vi");
  const { data: questions = [], isLoading, isError } = useFinalAssessmentQuiz(enrollmentId, fa.quizEnabled && !fa.quizTaken);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const submitQuiz = useSubmitFinalAssessmentQuiz(enrollmentId);

  if (fa.quizTaken) {
    return (
      <p className="text-[12.5px] text-[#17663f]" data-testid="final-quiz-taken">
        {t("final.quizTaken")}
      </p>
    );
  }
  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
  if (isError) return <ProfileLoadError text={t("final.quizLoadError")} />;

  const complete = questions.length > 0 && questions.every((q) => answers[q.id]);
  return (
    <div className="space-y-4" data-testid="final-quiz">
      <p className="text-[11px] text-[#9a938a]">{t("final.quizHint")}</p>
      {questions.map((q, i) => (
        <fieldset key={q.id} className="space-y-1.5" data-testid="final-quiz-question">
          <legend className="text-[13px] font-medium text-[#062f3e]">
            {i + 1}. {(vi && q.textVi) || q.text}
          </legend>
          {q.options.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-[12.5px]">
              <input
                type="radio"
                name={`q-${q.id}`}
                value={o.id}
                checked={answers[q.id] === o.id}
                onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: o.id }))}
              />
              {(vi && o.text_vi) || o.text}
            </label>
          ))}
        </fieldset>
      ))}
      <Button
        onClick={() =>
          submitQuiz.mutate(answers, {
            onSuccess: () => toast.success(t("final.quizSubmittedToast")),
            onError: (e) => toast.error(getFriendlyErrorMessage(e, t)),
          })
        }
        disabled={!complete || submitQuiz.isPending}
        data-testid="final-quiz-submit"
      >
        {submitQuiz.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {t("final.quizSubmit")}
      </Button>
    </div>
  );
}

function RecordingStep({
  enrollmentId,
  submissionId,
  maxFileMb,
  uploadedName,
  onUploaded,
}: {
  enrollmentId: string;
  submissionId: string;
  maxFileMb: number;
  uploadedName: string | null;
  onUploaded: (path: string, name: string) => void;
}) {
  const { t } = useTranslation("assessments");
  const upload = useUploadRecording();
  const [progress, setProgress] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const pick = (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    try {
      checkRecording(file, maxFileMb);
    } catch (e) {
      if (input.current) input.current.value = "";
      setFileError(
        e instanceof RecordingFileError
          ? t(e.reason === "type" ? "final.recordingType" : "final.recordingSize", { mb: maxFileMb })
          : String(e),
      );
      return;
    }
    setProgress(0);
    upload.mutate(
      { enrollmentId, submissionId, file, maxFileMb, onProgress: setProgress },
      {
        onSuccess: (path) => onUploaded(path, file.name),
        onError: (e) => setFileError(e instanceof Error ? e.message : t("final.uploadFailed")),
      },
    );
  };

  return (
    <div className="space-y-3">
      <Label htmlFor="final-recording">{t("final.recordingLabel", { mb: maxFileMb })}</Label>
      <p className="rounded-md bg-[#fbf8f2] p-2.5 text-[11.5px] text-[#4a463f]" data-testid="final-recording-tip">
        {t("final.recordingTip")}
      </p>
      <input
        id="final-recording"
        ref={input}
        type="file"
        accept="audio/mpeg,.mp3"
        disabled={upload.isPending}
        onChange={(e) => pick(e.target.files?.[0])}
        data-testid="final-recording-input"
        className="block text-sm"
      />
      {upload.isPending && (
        <div className="space-y-1" data-testid="final-recording-progress">
          <Progress value={Math.round(progress * 100)} />
          <p className="text-[11px] text-[#9a938a]">{t("final.uploading", { pct: Math.round(progress * 100) })}</p>
        </div>
      )}
      {!upload.isPending && uploadedName && (
        <p className="text-[12px] text-[#17663f]" data-testid="final-recording-uploaded">
          {t("final.recordingUploaded", { name: uploadedName })}
        </p>
      )}
      {fileError && (
        <p role="alert" className="text-[12px] text-destructive" data-testid="final-recording-error">
          {fileError}
        </p>
      )}
    </div>
  );
}
