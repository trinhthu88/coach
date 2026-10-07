import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { assessmentLabel, formatAssessmentDate, recordingUrlSeconds, type AssessmentFile, type AssessmentOutcome } from "@/lib/assessments";
import { AssessmentFileLink } from "@/components/assessments/AssessmentFileLink";
import { useAssessmentFileUrl } from "@/hooks/assessments/useAssessmentFileUrl";
import {
  FeedbackPdfError,
  checkFeedbackPdf,
  useCoachAssessmentInbox,
  useSubmitAssessmentReview,
  type CoachInboxRow,
} from "@/hooks/assessments/useCoachAssessments";

const OUTCOMES: AssessmentOutcome[] = ["pass", "not_pass", "resubmit"];

/**
 * One submission, as coach_assessment_inbox returns it: the learner's content
 * while the assignment is active (recording, transcript, reflection answers,
 * read-only quiz score), Admin's return reason, and the review form.
 */
export default function CoachSubmissionDetail() {
  const { t } = useTranslation("assessments");
  const { submissionId } = useParams<{ submissionId: string }>();
  const { data: rows, isLoading, isError } = useCoachAssessmentInbox();
  const row = rows?.find((r) => r.submissionId === submissionId);

  const back = (
    <Link to="/coach/submissions" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> {t("detail.back")}
    </Link>
  );

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (isError || !row) {
    return (
      <div>
        {back}
        <Card className="p-10 text-center text-sm text-muted-foreground" data-testid="coach-submission-not-found">
          {isError ? t("inbox.loadError") : t("detail.notFound")}
        </Card>
      </div>
    );
  }

  const active = row.tab === "to_assess" || row.tab === "returned" || row.tab === "awaiting_validation";
  const recording = row.learnerFiles.find((f) => f.fileKind === "recording");
  const transcriptFiles = row.learnerFiles.filter((f) => f.fileKind === "transcript");

  return (
    <div className="space-y-4" data-testid="coach-submission-detail">
      {back}
      <PageHeader
        eyebrow={`${row.cohortName} · ${t(`inbox.tabs.${row.tab}`)}`}
        title={`${row.learnerName} · ${assessmentLabel(row, t, "")}`}
        trailing=""
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {t("inbox.submitted", { date: formatAssessmentDate(row.submittedAt) })}
            {row.dueOn && <span>· {t("inbox.due", { date: formatAssessmentDate(row.dueOn) })}</span>}
            {row.isOverdue && <Badge variant="destructive">{t("inbox.overdue")}</Badge>}
          </span>
        }
        className="mb-2"
      />

      {row.tab === "returned" && row.returnReason && (
        <Card className="border-destructive/40 bg-destructive/5 p-4" data-testid="coach-submission-return-reason" role="status">
          <p className="text-xs font-semibold uppercase tracking-wide text-destructive">{t("detail.returnReasonTitle")}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{row.returnReason}</p>
        </Card>
      )}

      {!active ? (
        <Card className="p-4 text-sm text-muted-foreground">{t("detail.historyOnly")}</Card>
      ) : (
        <>
          {row.kind === "final_assessment" && (
            <Card className="space-y-2 p-4">
              <h2 className="text-sm font-semibold">{t("detail.recording")}</h2>
              {recording ? <RecordingPlayer file={recording} /> : <p className="text-sm text-muted-foreground">{t("detail.noRecording")}</p>}
            </Card>
          )}

          {(row.kind === "final_assessment" || row.transcriptText || transcriptFiles.length > 0) && (
            <Card className="space-y-2 p-4">
              <h2 className="text-sm font-semibold">{t("detail.transcript")}</h2>
              {row.transcriptText ? (
                <p className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-sm" data-testid="coach-submission-transcript">
                  {row.transcriptText}
                </p>
              ) : transcriptFiles.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("detail.noTranscript")}</p>
              ) : null}
              {transcriptFiles.map((f) => (
                <div key={f.storagePath}>
                  <AssessmentFileLink path={f.storagePath} label={t("detail.transcriptFile")} />
                </div>
              ))}
            </Card>
          )}

          {row.kind === "triad" && <ReflectionAnswers row={row} />}

          {row.kind === "final_assessment" && (
            <Card className="p-4" data-testid="coach-submission-quiz">
              <h2 className="text-sm font-semibold">{t("detail.quiz")}</h2>
              {row.quizTotal != null ? (
                <>
                  <p className="mt-1 text-sm">
                    {t("detail.quizScore", { correct: row.quizCorrect ?? 0, total: row.quizTotal, pct: Math.round(row.quizScorePct ?? 0) })}
                  </p>
                  <p className="text-xs text-muted-foreground">{t("detail.quizReadOnly")}</p>
                </>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">{t("detail.noQuiz")}</p>
              )}
            </Card>
          )}
        </>
      )}

      {row.tab === "to_assess" || row.tab === "returned" ? (
        <ReviewForm row={row} />
      ) : (
        row.myLatestVersion != null && (
          <Card className="space-y-2 p-4" data-testid="coach-submission-my-review">
            <h2 className="text-sm font-semibold">{t("detail.yourReview", { version: row.myLatestVersion })}</h2>
            {row.tab === "awaiting_validation" && <p className="text-xs text-muted-foreground">{t("detail.awaitingValidation")}</p>}
            {row.myLatestOutcome && <Badge variant="secondary">{t(`outcome.${row.myLatestOutcome}`)}</Badge>}
            {row.myLatestFeedbackText && <p className="whitespace-pre-wrap text-sm">{row.myLatestFeedbackText}</p>}
          </Card>
        )
      )}
    </div>
  );
}

/** Signed for the recording's length plus a margin, so a full listen never hits an expired link. */
function RecordingPlayer({ file }: { file: AssessmentFile }) {
  const { t } = useTranslation("assessments");
  const { data: url, isError } = useAssessmentFileUrl(file.storagePath, recordingUrlSeconds(file.durationSeconds));
  if (isError) return <p className="text-sm text-destructive">{t("fileError")}</p>;
  if (!url) return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  return (
    <audio controls preload="metadata" src={url} className="w-full" data-testid="coach-submission-audio">
      {t("detail.audioUnsupported")}
    </audio>
  );
}

function ReflectionAnswers({ row }: { row: CoachInboxRow }) {
  const { t, i18n } = useTranslation("assessments");
  const vi = i18n.language.startsWith("vi");
  const answers = row.reflection?.answers ?? [];
  const sections = (["coach", "coachee", "observer", "general"] as const)
    .map((section) => ({ section, answers: answers.filter((a) => a.section === section) }))
    .filter((s) => s.answers.length > 0);
  return (
    <Card className="space-y-3 p-4" data-testid="coach-submission-reflection">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("detail.reflection")}</h2>
        {row.reflection && (
          <span className="text-xs text-muted-foreground">
            {t("detail.reflectionSubmitted", { date: formatAssessmentDate(row.reflection.submittedAt) })}
          </span>
        )}
      </div>
      {sections.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("detail.noReflection")}</p>
      ) : (
        sections.map((s) => (
          <div key={s.section}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t(`detail.sections.${s.section}`)}</p>
            <dl className="mt-1 space-y-2">
              {s.answers.map((a) => (
                <div key={a.questionId}>
                  <dt className="text-xs font-medium">{(vi && a.questionVi) || a.question}</dt>
                  <dd className="whitespace-pre-wrap text-sm">{a.answer}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))
      )}
    </Card>
  );
}

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function ReviewForm({ row }: { row: CoachInboxRow }) {
  const { t } = useTranslation("assessments");
  const submit = useSubmitAssessmentReview();
  // A returned review starts from the assessor's own last version.
  const [feedbackText, setFeedbackText] = useState(row.tab === "returned" ? row.myLatestFeedbackText ?? "" : "");
  const [outcome, setOutcome] = useState<AssessmentOutcome | null>(row.tab === "returned" ? row.myLatestOutcome : null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const isFinal = row.kind === "final_assessment";
  const lastAttempt = row.attemptNo >= 2;
  const hasContent = !!feedbackText.trim() || !!pdf;
  const outcomeOk = !isFinal || (!!outcome && !(lastAttempt && outcome === "resubmit"));

  const pickPdf = (file: File | undefined) => {
    setPdfError(null);
    if (!file) return setPdf(null);
    try {
      checkFeedbackPdf(file);
      setPdf(file);
    } catch (e) {
      setPdf(null);
      if (fileInput.current) fileInput.current.value = "";
      setPdfError(e instanceof FeedbackPdfError ? t(e.reason === "type" ? "detail.form.pdfType" : "detail.form.pdfSize") : String(e));
    }
  };

  const send = () =>
    submit.mutate(
      { row, feedbackText, outcome: isFinal ? outcome : null, pdf },
      {
        onSuccess: () => toast.success(t("detail.form.submitted")),
        onError: (e) =>
          toast.error(
            e instanceof FeedbackPdfError
              ? t(e.reason === "type" ? "detail.form.pdfType" : "detail.form.pdfSize")
              : getFriendlyErrorMessage(e, t),
          ),
      },
    );

  return (
    <Card className="space-y-4 p-4" data-testid="coach-review-form">
      <div>
        <h2 className="text-sm font-semibold">{t("detail.form.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("detail.form.hint")}</p>
      </div>

      {isFinal && (
        <div>
          <Label>{t("detail.form.outcomeLabel")}</Label>
          <RadioGroup
            value={outcome ?? ""}
            onValueChange={(v) => setOutcome(v as AssessmentOutcome)}
            className="mt-2 flex flex-wrap gap-4"
            data-testid="coach-review-outcome"
          >
            {OUTCOMES.map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm">
                <RadioGroupItem value={o} disabled={o === "resubmit" && lastAttempt} aria-label={t(`outcome.${o}`)} />
                {t(`outcome.${o}`)}
              </label>
            ))}
          </RadioGroup>
          {lastAttempt && <p className="mt-1 text-xs text-muted-foreground">{t("detail.form.resubmitLastAttempt")}</p>}
        </div>
      )}

      <div>
        <Label htmlFor="coach-review-text">{t("detail.form.feedbackLabel")}</Label>
        <Textarea
          id="coach-review-text"
          rows={6}
          value={feedbackText}
          onChange={(e) => setFeedbackText(e.target.value)}
          placeholder={t("detail.form.feedbackPlaceholder")}
          data-testid="coach-review-text"
        />
      </div>

      <div>
        <Label htmlFor="coach-review-pdf">{t("detail.form.pdfLabel")}</Label>
        <input
          id="coach-review-pdf"
          ref={fileInput}
          type="file"
          accept="application/pdf"
          className="mt-1 block text-sm"
          onChange={(e) => pickPdf(e.target.files?.[0])}
          data-testid="coach-review-pdf"
        />
        {pdf && (
          <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            {t("detail.form.pdfChosen", { name: pdf.name, size: formatSize(pdf.size) })}
            <button
              type="button"
              className="text-primary underline-offset-2 hover:underline"
              onClick={() => {
                setPdf(null);
                if (fileInput.current) fileInput.current.value = "";
              }}
            >
              {t("detail.form.removePdf")}
            </button>
          </p>
        )}
        {pdfError && (
          <p role="alert" className="mt-1 text-xs text-destructive" data-testid="coach-review-pdf-error">
            {pdfError}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {!hasContent ? (
          <span className="text-xs text-muted-foreground">{t("detail.form.needsContent")}</span>
        ) : !outcomeOk ? (
          <span className="text-xs text-muted-foreground">{t("detail.form.needsOutcome")}</span>
        ) : null}
        <Button onClick={send} disabled={!hasContent || !outcomeOk || submit.isPending} data-testid="coach-review-submit">
          {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {row.tab === "returned" ? t("detail.form.resubmit") : t("detail.form.submit")}
        </Button>
      </div>
    </Card>
  );
}
