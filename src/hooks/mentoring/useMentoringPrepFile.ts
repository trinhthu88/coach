import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
 * Handles the mentee's preparation file: upload to mentoring-prep-files under
 * {session_id}/, then learner_submit_mentoring_prep_file records it with the
 * server's time. Client-side .docx/.pdf validation here is a UX nicety; the
 * storage RLS policy's filename-suffix check is the real backstop.
 */
export function useMentoringPrepFile({ sessionId, onSubmitted }: UseMentoringPrepFileOptions) {
  const { t } = useTranslation("mentoring");
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);

  const submit = async (file: File, notes: string) => {
    if (!sessionId) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXT.includes(ext) || (file.type && !ALLOWED_MIME.includes(file.type))) {
      toast.error(t("sessionDetail.prepFileTypeError"));
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
    // Recorded by the server, which checks the upload and stamps the time
    // (20261007000700); the prep file is not writable at the table.
    const { error: updateErr } = await supabase.rpc("learner_submit_mentoring_prep_file", {
      p_session_id: sessionId,
      p_path: path,
      p_notes: notes.trim() || undefined,
    });
    setUploading(false);
    if (updateErr) {
      toast.error(updateErr.message);
      return;
    }
    toast.success(t("sessionDetail.prepFileSubmitted"));
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
      toast.error(t("sessionDetail.linkError"));
      return;
    }
    window.open(signed.signedUrl, "_blank");
  };

  return { uploading, submit, download };
}
