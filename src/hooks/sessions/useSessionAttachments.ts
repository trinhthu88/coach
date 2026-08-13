import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Attachment } from "./types";

interface UseSessionAttachmentsOptions {
  sessionId: string | undefined;
  isPeer: boolean;
  userId: string | undefined;
}

const ALLOWED_EXT = ["pdf", "jpg", "jpeg", "mp3", "mp4"];

async function fetchAttachments(sessionId: string): Promise<Attachment[]> {
  const { data } = await supabase
    .from("session_attachments")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });
  return data || [];
}

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
  const queryClient = useQueryClient();
  const queryKey = ["session-attachments", sessionId];
  const enabled = !isPeer && !!sessionId;
  const [uploading, setUploading] = useState(false);

  const { data } = useQuery({
    queryKey,
    queryFn: () => fetchAttachments(sessionId as string),
    enabled,
    staleTime: 30_000,
  });
  const attachments = enabled ? data ?? [] : [];

  const reload = () => queryClient.invalidateQueries({ queryKey });

  const removeMutation = useMutation({
    mutationFn: async (a: Attachment) => {
      await supabase.storage.from("session-attachments").remove([a.storage_path]);
      await supabase.from("session_attachments").delete().eq("id", a.id);
      return a;
    },
    onSuccess: (a) => {
      queryClient.setQueryData(queryKey, (prev: Attachment[] | undefined) =>
        (prev ?? []).filter((x) => x.id !== a.id)
      );
    },
  });

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
    const { data: inserted, error: insErr } = await supabase
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
    queryClient.setQueryData(queryKey, (prev: Attachment[] | undefined) => [inserted, ...(prev ?? [])]);
    toast.success("File uploaded");
  };

  const download = async (a: Attachment) => {
    const { data: signed, error } = await supabase.storage
      .from("session-attachments")
      .createSignedUrl(a.storage_path, 60);
    if (error || !signed) {
      toast.error("Could not generate link");
      return;
    }
    window.open(signed.signedUrl, "_blank");
  };

  const remove = async (a: Attachment) => {
    await removeMutation.mutateAsync(a).catch(() => {});
  };

  return { attachments, uploading, upload, download, remove, reload };
}
