import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Attachment } from "./types";

interface UseSessionAttachmentsOptions {
  sessionId: string | undefined;
  isPeer: boolean;
  userId: string | undefined;
}

const ALLOWED_EXT = ["pdf", "jpg", "jpeg", "mp3", "mp4"];

/**
 * Manages session file attachments: listing, uploading, downloading and
 * removing files from the `session-attachments` storage bucket. Peer
 * sessions do not support attachments.
 */
export function useSessionAttachments({
  sessionId,
  isPeer,
  userId,
}: UseSessionAttachmentsOptions) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (isPeer || !sessionId) {
      setAttachments([]);
      return;
    }
    const { data: atts } = await supabase
      .from("session_attachments")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false });
    setAttachments(atts || []);
  }, [sessionId, isPeer]);

  useEffect(() => {
    load();
  }, [load]);

  const upload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !userId || !sessionId) return;
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!ALLOWED_EXT.includes(ext)) {
        e.target.value = "";
        toast.error("Only PDF, JPG, MP3 or MP4 files are allowed");
        return;
      }
      setUploading(true);
      const path = `${sessionId}/${crypto.randomUUID()}-${file.name}`;
      const { error: upErr } = await supabase.storage
        .from("session-attachments")
        .upload(path, file);
      if (upErr) {
        setUploading(false);
        toast.error(upErr.message);
        return;
      }
      const { data, error: insErr } = await supabase
        .from("session_attachments")
        .insert({
          session_id: sessionId,
          uploaded_by: userId,
          file_name: file.name,
          storage_path: path,
          mime_type: file.type,
          file_size_bytes: file.size,
        })
        .select()
        .single();
      setUploading(false);
      e.target.value = "";
      if (insErr) {
        toast.error(insErr.message);
        return;
      }
      setAttachments((prev) => [data, ...prev]);
      toast.success("File uploaded");
    },
    [sessionId, userId]
  );

  const download = useCallback(async (a: Attachment) => {
    const { data, error } = await supabase.storage
      .from("session-attachments")
      .createSignedUrl(a.storage_path, 60);
    if (error || !data) {
      toast.error("Could not generate link");
      return;
    }
    window.open(data.signedUrl, "_blank");
  }, []);

  const remove = useCallback(async (a: Attachment) => {
    await supabase.storage.from("session-attachments").remove([a.storage_path]);
    await supabase.from("session_attachments").delete().eq("id", a.id);
    setAttachments((prev) => prev.filter((x) => x.id !== a.id));
  }, []);

  return { attachments, uploading, upload, download, remove, reload: load };
}
