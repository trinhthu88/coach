import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveEnrollment } from "@/hooks/useActiveEnrollment";
import { ASSESSMENT_FILES_BUCKET } from "@/lib/assessments";
import { uploadWithProgress } from "@/lib/uploadWithProgress";
import { measureAudioDuration } from "@/lib/audioDuration";
import { extractFunctionError } from "@/lib/errors";

/**
 * The learner's Final Assessment (20261007000100). Everything is read through
 * learner_final_assessment (state, config; the quiz score and result only
 * after release) and learner_final_assessment_quiz (never the answer key),
 * and written through learner_submit_final_assessment_quiz and
 * learner_submit_assessment. The recording is uploaded first under
 * {enrollment}/{submission}/, then registered on submit.
 */

export const LEARNER_FINAL_ASSESSMENT_KEY = "learner-final-assessment";
export const RECORDING_MIME = "audio/mpeg";

export type FinalAssessmentState = "not_submitted" | "submitted" | "under_review" | "completed" | "resubmit_requested";
export type TranscriptMode = "none" | "optional" | "required";

export interface LearnerFinalAssessment {
  requirementId: string;
  dueOn: string | null;
  instructions: string | null;
  instructionsVi: string | null;
  transcriptMode: TranscriptMode;
  maxFileMb: number;
  quizEnabled: boolean;
  quizQuestionCount: number;
  attemptNo: number;
  state: FinalAssessmentState;
  quizTaken: boolean;
  quizSubmissionId: string | null;
  submissionId: string | null;
  submittedAt: string | null;
  releasedAt: string | null;
  quizCorrect: number | null;
  quizTotal: number | null;
  quizScorePct: number | null;
  passMarkPct: number | null;
  quizPassed: boolean | null;
  finalResult: "pass" | "not_pass" | null;
  canResubmit: boolean;
}

export interface FinalQuizQuestion {
  id: string;
  text: string;
  textVi: string | null;
  options: { id: string; text: string; text_vi?: string | null }[];
}

export function useLearnerFinalAssessment() {
  const active = useActiveEnrollment();
  const query = useLearnerFinalAssessmentFor(active.enrollmentId);
  return {
    enrollmentId: active.enrollmentId,
    enrollmentLoading: active.loading,
    /** learner_display_enrollment: false when the enrollment is shown read-only (no quiz, upload or Submit). */
    isCurrent: active.isCurrent,
    displayState: active.displayState,
    data: query.data ?? null,
    loading: active.loading || query.isLoading,
    error: query.isError,
  };
}

/** The same read for a given enrollment (My Journey pages pass the one they show). */
export function useLearnerFinalAssessmentFor(enrollmentId: string | null | undefined) {
  return useQuery({
    queryKey: [LEARNER_FINAL_ASSESSMENT_KEY, enrollmentId],
    enabled: !!enrollmentId,
    queryFn: async (): Promise<LearnerFinalAssessment | null> => {
      const { data, error } = await supabase.rpc("learner_final_assessment", { p_enrollment_id: enrollmentId! });
      if (error) throw error;
      const r = (data ?? [])[0];
      if (!r) return null;
      return {
        requirementId: r.requirement_id,
        dueOn: r.due_on ?? null,
        instructions: r.instructions ?? null,
        instructionsVi: r.instructions_vi ?? null,
        transcriptMode: (r.transcript_mode as TranscriptMode) ?? "optional",
        maxFileMb: r.max_file_mb ?? 50,
        quizEnabled: !!r.quiz_enabled,
        quizQuestionCount: r.quiz_question_count ?? 0,
        attemptNo: r.attempt_no,
        state: r.state as FinalAssessmentState,
        quizTaken: !!r.quiz_taken,
        quizSubmissionId: r.quiz_submission_id ?? null,
        submissionId: r.submission_id ?? null,
        submittedAt: r.submitted_at ?? null,
        releasedAt: r.released_at ?? null,
        quizCorrect: r.quiz_correct ?? null,
        quizTotal: r.quiz_total ?? null,
        quizScorePct: r.quiz_score_pct ?? null,
        passMarkPct: r.pass_mark_pct ?? null,
        quizPassed: r.quiz_passed ?? null,
        finalResult: (r.final_result as LearnerFinalAssessment["finalResult"]) ?? null,
        canResubmit: !!r.can_resubmit,
      };
    },
  });
}

export function useFinalAssessmentQuiz(enrollmentId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [LEARNER_FINAL_ASSESSMENT_KEY, "quiz", enrollmentId],
    enabled: !!enrollmentId && enabled,
    queryFn: async (): Promise<FinalQuizQuestion[]> => {
      const { data, error } = await supabase.rpc("learner_final_assessment_quiz", { p_enrollment_id: enrollmentId! });
      if (error) throw error;
      return (data ?? []).map((q) => ({
        id: q.question_id,
        text: q.question_text,
        textVi: q.question_text_vi ?? null,
        options: ((q.options as FinalQuizQuestion["options"] | null) ?? []).map((o) => ({ id: o.id, text: o.text, text_vi: o.text_vi })),
      }));
    },
  });
}

export function useSubmitFinalAssessmentQuiz(enrollmentId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (answers: Record<string, string>) => {
      const { data, error } = await supabase.rpc("learner_submit_final_assessment_quiz", {
        p_enrollment_id: enrollmentId!,
        p_answers: answers,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [LEARNER_FINAL_ASSESSMENT_KEY] }),
  });
}

export class RecordingFileError extends Error {
  constructor(public reason: "type" | "size") {
    super(reason === "type" ? "The recording must be an MP3 file" : "The recording is too large");
  }
}

/** MP3 only (audio/mpeg); some browsers report audio/mp3 for a .mp3 file. Checked again by the bucket and on submit. */
export function checkRecording(file: File, maxFileMb: number) {
  const isMp3 = file.type === RECORDING_MIME || file.type === "audio/mp3" || (!file.type && /\.mp3$/i.test(file.name));
  if (!isMp3) throw new RecordingFileError("type");
  if (file.size > maxFileMb * 1024 * 1024) throw new RecordingFileError("size");
}

export function recordingPath(enrollmentId: string, submissionId: string) {
  return `${enrollmentId}/${submissionId}/recording.mp3`;
}

export function useUploadRecording() {
  return useMutation({
    mutationFn: async ({
      enrollmentId,
      submissionId,
      file,
      maxFileMb,
      onProgress,
    }: {
      enrollmentId: string;
      submissionId: string;
      file: File;
      maxFileMb: number;
      onProgress: (fraction: number) => void;
    }) => {
      checkRecording(file, maxFileMb);
      const path = recordingPath(enrollmentId, submissionId);
      // Stored as audio/mpeg whatever the browser called it. The length is
      // read alongside and sent with the submission (it sizes the assessor's
      // signed URL).
      const [, durationSeconds] = await Promise.all([
        uploadWithProgress({ bucket: ASSESSMENT_FILES_BUCKET, path, file, contentType: RECORDING_MIME, onProgress }),
        measureAudioDuration(file),
      ]);
      return { path, durationSeconds };
    },
  });
}

export function useSubmitFinalAssessment(enrollmentId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      submissionId,
      requirementId,
      quizSubmissionId,
      recordingPath: path,
      recordingSeconds = null,
      transcriptText,
      transcriptAuto = false,
    }: {
      submissionId: string;
      requirementId: string;
      quizSubmissionId: string | null;
      recordingPath: string;
      /** The recording's length as measured at upload; omitted when unknown. */
      recordingSeconds?: number | null;
      transcriptText: string;
      /** The text started as an automatic draft (the learner may have edited it). */
      transcriptAuto?: boolean;
    }) => {
      const transcript = transcriptText.trim();
      const { error } = await supabase.rpc("learner_submit_assessment", {
        p_submission_id: submissionId,
        p_enrollment_id: enrollmentId!,
        p_cohort_requirement_id: requirementId,
        p_kind: "final_assessment",
        p_quiz_submission_id: quizSubmissionId ?? undefined,
        p_transcript_text: transcript || undefined,
        p_transcript_source: transcript ? (transcriptAuto ? "auto" : "pasted") : "none",
        p_files: [
          recordingSeconds ? { storage_path: path, file_kind: "recording", duration_seconds: recordingSeconds } : { storage_path: path, file_kind: "recording" },
        ],
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [LEARNER_FINAL_ASSESSMENT_KEY] }),
  });
}

export type AutoTranscribeError =
  | "consent_required"
  | "limit_reached"
  | "not_configured"
  | "not_open"
  | "not_found"
  | "transcription_failed"
  | "unknown";

export const FINAL_TRANSCRIPTION_KEY = "learner-final-assessment-transcription";

export interface FinalAssessmentTranscription {
  attemptNo: number;
  cap: number;
  remaining: number;
  /** The latest automatic draft of the open attempt (saved, so a reload keeps it). */
  draftText: string | null;
  draftStoragePath: string | null;
  draftAt: string | null;
}

/** Drafts left on this attempt and its saved draft; null once the attempt is submitted. */
export function useFinalAssessmentTranscription(enrollmentId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: [FINAL_TRANSCRIPTION_KEY, enrollmentId],
    enabled: !!enrollmentId && enabled,
    queryFn: async (): Promise<FinalAssessmentTranscription | null> => {
      const { data, error } = await supabase.rpc("learner_final_assessment_transcription", { p_enrollment_id: enrollmentId! });
      if (error) throw error;
      const r = (data ?? [])[0];
      if (!r) return null;
      return {
        attemptNo: r.attempt_no,
        cap: r.cap,
        remaining: r.remaining,
        draftText: r.draft_text ?? null,
        draftStoragePath: r.draft_storage_path ?? null,
        draftAt: r.draft_at ?? null,
      };
    },
  });
}

/**
 * Automatic transcription draft (transcribe-assessment-recording, Prompt A7):
 * Whisper on the uploaded, not yet submitted recording. At most 3 per attempt
 * and only with the learner's consent, both enforced in the database; the
 * draft is saved there too, and stored on submit with transcript_source 'auto'.
 */
export function useAutoTranscribe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ enrollmentId, storagePath }: { enrollmentId: string; storagePath: string }) => {
      const { data, error } = await supabase.functions.invoke("transcribe-assessment-recording", {
        body: { enrollment_id: enrollmentId, storage_path: storagePath, consent: true },
      });
      if (error) throw await extractFunctionError(error);
      return (data as { text: string }).text ?? "";
    },
    // A use is spent (or given back on failure): refresh what is left.
    onSettled: () => queryClient.invalidateQueries({ queryKey: [FINAL_TRANSCRIPTION_KEY] }),
  });
}

export function autoTranscribeErrorCode(e: unknown): AutoTranscribeError {
  const m = e instanceof Error ? e.message : "";
  return (
    (["consent_required", "limit_reached", "not_configured", "not_open", "not_found", "transcription_failed"] as const).find(
      (c) => c === m,
    ) ?? "unknown"
  );
}
