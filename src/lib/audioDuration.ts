/**
 * The length of an audio file in seconds, read from its metadata by the
 * browser before upload. Null when the browser cannot tell (unsupported
 * file, no object URLs, or no answer within `timeoutMs`): the length is then
 * simply not stored, and the recording's signed URL uses its fallback.
 */
export function measureAudioDuration(file: Blob, timeoutMs = 10_000): Promise<number | null> {
  if (typeof URL.createObjectURL !== "function" || typeof Audio === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (value: number | null) => {
      clearTimeout(timer);
      audio.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    audio.onerror = () => done(null);
    audio.src = url;
  });
}
