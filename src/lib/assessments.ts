import type { TFunction } from "i18next";
import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

/**
 * Shared by the Admin queue, the coach inbox and the learner's feedback
 * (assessment review pipeline, 20261006210000). The bucket is private: every
 * read is a short-lived signed URL, allowed by assessment_object_readable.
 */
export const ASSESSMENT_FILES_BUCKET = "assessment-files";
/** coach_submit_review refuses a feedback PDF above this (and anything not application/pdf). */
export const FEEDBACK_PDF_MAX_BYTES = 10 * 1024 * 1024;

export type AssessmentKind = "triad" | "final_assessment";
export type AssessmentStatus =
  | "awaiting_assignment"
  | "with_assessor"
  | "awaiting_validation"
  | "returned"
  | "released";
export type AssessmentOutcome = "pass" | "not_pass" | "resubmit";

export interface AssessmentFile {
  storagePath: string;
  fileKind?: "recording" | "transcript" | "feedback_pdf";
  mime: string;
  sizeBytes: number;
  /** A recording's length, measured when the learner uploaded it (null if unknown). */
  durationSeconds?: number | null;
}

type RawAssessmentFile = {
  storage_path: string;
  file_kind?: AssessmentFile["fileKind"];
  mime: string;
  size_bytes: number;
  duration_seconds?: number | null;
};

export function parseAssessmentFiles(value: unknown): AssessmentFile[] {
  return ((value as RawAssessmentFile[] | null) ?? []).map((f) => ({
    storagePath: f.storage_path,
    fileKind: f.file_kind,
    mime: f.mime,
    sizeBytes: f.size_bytes,
    durationSeconds: f.duration_seconds ?? null,
  }));
}

/** Documents (transcripts, feedback PDFs) are signed for five minutes. */
export const ASSESSMENT_FILE_URL_SECONDS = 300;
/** Room to pause, rewind and replay a recording before its link runs out. */
export const RECORDING_URL_MARGIN_SECONDS = 30 * 60;
/** A recording uploaded before its length was stored: the longest a 50 MB MP3 plausibly runs. */
export const RECORDING_URL_UNKNOWN_SECONDS = 2 * 60 * 60;

/**
 * How long a recording's signed URL lasts: the recording's length plus a
 * margin, so an assessor listening to the whole session is never cut off by
 * an expired link.
 */
export function recordingUrlSeconds(durationSeconds: number | null | undefined): number {
  const length = durationSeconds && durationSeconds > 0 ? Math.ceil(durationSeconds) : RECORDING_URL_UNKNOWN_SECONDS;
  return length + RECORDING_URL_MARGIN_SECONDS;
}

export async function assessmentFileUrl(storagePath: string, expiresIn = ASSESSMENT_FILE_URL_SECONDS): Promise<string> {
  const { data, error } = await supabase.storage.from(ASSESSMENT_FILES_BUCKET).createSignedUrl(storagePath, expiresIn);
  if (error || !data?.signedUrl) throw error ?? new Error("No signed URL");
  return data.signedUrl;
}

/**
 * "Triad 2", "Final Assessment", "Final Assessment (attempt 2)". `prefix` is
 * where triadN / finalAttempt / kind sit in the caller's namespace
 * ("assessments." in admin, "" in the assessments namespace).
 */
export function assessmentLabel(
  row: { kind: AssessmentKind; requirementOrdinal: number | null; attemptNo: number },
  t: TFunction,
  prefix = "assessments.",
) {
  if (row.kind === "triad") return t(`${prefix}triadN`, { n: row.requirementOrdinal });
  return row.attemptNo > 1 ? t(`${prefix}finalAttempt`, { n: row.attemptNo }) : t(`${prefix}kind.final_assessment`);
}

/** A released feedback card's title (assessments namespace), also used by the learner's Needs attention item. */
export function feedbackTitle(
  t: TFunction<"assessments">,
  item: { kind: string; requirementOrdinal: number | null; attemptNo: number },
): string {
  return item.kind === "triad"
    ? t("feedback.triadTitle", { n: item.requirementOrdinal })
    : item.attemptNo > 1
      ? t("feedback.finalAttemptTitle", { n: item.attemptNo })
      : t("feedback.finalTitle");
}

/** "6 Oct 2026"; date-only values parse as local dates, not UTC midnight. */
export function formatAssessmentDate(value: string | null | undefined) {
  return value ? format(parseISO(value), "d MMM yyyy") : "—";
}
