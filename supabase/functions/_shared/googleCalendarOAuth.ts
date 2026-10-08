function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createOAuthState(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashOAuthState(state: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function createOAuthCodeVerifier(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function createOAuthCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function canCompleteGoogleCalendarOAuth(
  state: {
    coachId: string;
    userId: string;
    codeVerifier: string | null;
    expiresAt: string;
  },
  now = Date.now(),
): boolean {
  return state.coachId === state.userId &&
    typeof state.codeVerifier === "string" &&
    state.codeVerifier.length >= 43 &&
    state.codeVerifier.length <= 128 &&
    Number.isFinite(Date.parse(state.expiresAt)) &&
    Date.parse(state.expiresAt) > now;
}
