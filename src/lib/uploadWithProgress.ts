import { supabase } from "@/integrations/supabase/client";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase-target";

/**
 * Uploads one object to Supabase Storage with upload progress, which
 * supabase-js's storage.upload() does not report. Same endpoint, same auth
 * (the signed-in user's access token), so the bucket's policies apply as usual.
 */
export async function uploadWithProgress({
  bucket,
  path,
  file,
  contentType,
  onProgress,
  upsert = true,
}: {
  bucket: string;
  path: string;
  file: Blob;
  contentType: string;
  onProgress: (fraction: number) => void;
  upsert?: boolean;
}): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", SUPABASE_PUBLISHABLE_KEY);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("x-upsert", upsert ? "true" : "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
      } else {
        let message = `Upload failed (${xhr.status})`;
        try {
          const body = JSON.parse(xhr.responseText) as { message?: string; error?: string };
          message = body.message || body.error || message;
        } catch {
          // keep the status message
        }
        reject(Object.assign(new Error(message), { status: xhr.status }));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}
