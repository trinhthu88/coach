import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const ALLOWED_EXT = ["pdf", "docx"];
const ALLOWED_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

interface UseMentoringPrepFileOptions {
  sessionId: string | undefined;
  onSubmitted: () => void;
}

/**
 * Handles the mentee's one-time preparation file upload (hard-gated at the
 * DB level — see enforce_mentoring_prep_file_before_completion() /
 * enforce_mentoring_feedback_requires_prep_file() in
 * 20260818140400_mentoring_sessions.sql and 20260818140500_mentoring_feedback.sql).
 * Client-side .docx/.pdf validation here is a UX nicety; the storage RLS
 * policy's filename-suffix check is the real backstop.
 */
export function useMentoringPrepFile({ sessionId, onSubmitted }: UseMentoringPrepFileOptions) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);

  const submit = async (file: File, notes: string) => {
    if (!sessionId) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXT.includes(ext) || (file.type && !ALLOWED_MIME.includes(file.type))) {
      toast.error("Only .docx or .pdf files are allowed");
      return;
    }
    setUploading(true);
    const path = `${sessionId}/${crypto.randomUUID()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("mentoring-prep-files").upload(path, file);
    if (upErr) {
      setUploading(false);
      toast.error(upErr.message);
      return;
    }
    const { error: updateErr } = await supabase
      .from("mentoring_sessions")
      .update({
        prep_file_path: path,
        prep_file_notes: notes.trim() || null,
        prep_file_submitted_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
    setUploading(false);
    if (updateErr) {
      toast.error(updateErr.message);
      return;
    }
    toast.success("Preparation file submitted");
    queryClient.invalidateQueries({ queryKey: ["mentoring-session-core", sessionId] });
    onSubmitted();

    supabase.functions
      .invoke("send-mentoring-prep-file", { body: { session_id: sessionId } })
      .then(({ error }) => {
        if (error) console.error("Failed to send prep-file email", error);
      });
  };

  const download = async (path: string) => {
    const { data: signed, error } = await supabase.storage
      .from("mentoring-prep-files")
      .createSignedUrl(path, 60 * 10);
    if (error || !signed) {
      toast.error("Could not generate link");
      return;
    }
    window.open(signed.signedUrl, "_blank");
  };

  return { uploading, submit, download };
}
