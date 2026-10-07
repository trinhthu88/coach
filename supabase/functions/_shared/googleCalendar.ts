import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  createOAuthCodeChallenge,
  createOAuthCodeVerifier,
  createOAuthState,
  hashOAuthState,
} from "./googleCalendarOAuth.ts";
import {
  createTokenRefreshFailure,
  trackGoogleCalendarOperation,
} from "./googleCalendarFailurePolicy.ts";

export {
  createOAuthCodeChallenge,
  createOAuthCodeVerifier,
  createOAuthState,
  hashOAuthState,
};

type AdminClient = ReturnType<typeof createClient>;

export type CalendarSource = "coaching" | "peer" | "mentoring";
export type CalendarBusyInterval = { start: string; end: string };

type ConnectionRow = {
  coach_id: string;
  google_email: string;
  refresh_token_ciphertext: string;
  consecutive_error_count: number;
  needs_reconnect: boolean;
};

const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

export function invalidateGoogleCalendarAccessToken(coachId: string): void {
  accessTokenCache.delete(coachId);
}

export function makeAdminClient(): AdminClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase service configuration is missing");
  return createClient(url, key);
}

export function isGoogleCalendarConfigured(): boolean {
  return !!(
    Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID") &&
    Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET") &&
    Deno.env.get("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY")
  );
}

export function googleCalendarRedirectUri(): string {
  const base = Deno.env.get("SUPABASE_URL");
  if (!base) throw new Error("Supabase URL is not configured");
  return `${base.replace(/\/+$/, "")}/functions/v1/google-calendar-oauth-callback`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encryptionKeyBytes(): Uint8Array {
  const encoded = Deno.env.get("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY");
  if (!encoded) throw new Error("Google Calendar encryption is not configured");
  const key = base64ToBytes(encoded);
  if (key.length !== 32) throw new Error("Google Calendar encryption key must be 32 bytes, base64 encoded");
  return key;
}

async function importEncryptionKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encryptionKeyBytes(), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptRefreshToken(token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await importEncryptionKey(),
    new TextEncoder().encode(token),
  );
  return `v1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptRefreshToken(value: string): Promise<string> {
  const [version, encodedIv, encodedCiphertext] = value.split(":");
  if (version !== "v1" || !encodedIv || !encodedCiphertext) {
    throw new Error("Stored Google Calendar token has an unsupported format");
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(encodedIv) },
    await importEncryptionKey(),
    base64ToBytes(encodedCiphertext),
  );
  return new TextDecoder().decode(plaintext);
}

function allowedOrigin(origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin !== origin || !["https:", "http:"].includes(parsed.protocol)) return false;
  const allowlist = (Deno.env.get("ALLOWED_ORIGIN") ?? "https://clariva.club,https://www.clariva.club")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowlist.some((pattern) => {
    if (pattern === origin) return true;
    if (!pattern.includes("*")) return false;
    const escapedParts = pattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return new RegExp(`^${escapedParts.join(".*")}$`).test(origin);
  });
}

export function isAllowedCalendarReturnOrigin(origin: string): boolean {
  return allowedOrigin(origin);
}

export async function requestUser(req: Request) {
  const authorization = req.headers.get("Authorization");
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!authorization || !url || !anonKey) return null;
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(url, anonKey);
  const { data, error } = await client.auth.getUser(token);
  return error ? null : data.user;
}

export async function userHasCoachRole(admin: AdminClient, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "coach")
    .limit(1);
  if (error) throw new Error("Could not verify coach access");
  return (data ?? []).length > 0;
}

async function getConnection(admin: AdminClient, coachId: string): Promise<ConnectionRow | null> {
  const { data, error } = await admin
    .from("google_calendar_connections")
    .select("coach_id, google_email, refresh_token_ciphertext, consecutive_error_count, needs_reconnect")
    .eq("coach_id", coachId)
    .maybeSingle();
  if (error) throw new Error("Could not load Google Calendar connection");
  return (data as ConnectionRow | null) ?? null;
}

export async function getCalendarConnectionStatus(admin: AdminClient, coachId: string) {
  const connection = await getConnection(admin, coachId);
  return {
    configured: isGoogleCalendarConfigured(),
    connected: !!connection,
    email: connection?.google_email ?? null,
    needs_reconnect: connection?.needs_reconnect ?? false,
  };
}

async function accessTokenForCoach(admin: AdminClient, coachId: string): Promise<string | null> {
  const connection = await getConnection(admin, coachId);
  if (!connection) return null;
  if (!isGoogleCalendarConfigured()) throw new Error("Google Calendar is not configured");
  const cached = accessTokenCache.get(coachId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET")!;
  const refreshToken = await decryptRefreshToken(connection.refresh_token_ciphertext);
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    accessTokenCache.delete(coachId);
    throw createTokenRefreshFailure(response.status, result.error);
  }
  if (typeof result.access_token !== "string") {
    throw new Error("Google Calendar did not return an access token");
  }
  const accessToken = result.access_token as string;
  const lifetimeSeconds = Number(result.expires_in) || 3600;
  accessTokenCache.set(coachId, {
    token: accessToken,
    expiresAt: Date.now() + lifetimeSeconds * 1000,
  });
  return accessToken;
}

async function trackCalendarOperation<T extends { connected: boolean }>(
  admin: AdminClient,
  coachId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return trackGoogleCalendarOperation(
    operation,
    async () => {
      try {
        const { error } = await admin
          .from("google_calendar_connections")
          .update({ consecutive_error_count: 0, needs_reconnect: false, updated_at: new Date().toISOString() })
          .eq("coach_id", coachId);
        if (error) console.error("Could not reset Google Calendar error state", error.message);
      } catch (error) {
        console.error(
          "Could not reset Google Calendar error state",
          error instanceof Error ? error.message : "unknown error",
        );
      }
    },
    async () => {
      try {
        const { error: recordError } = await admin.rpc("record_google_calendar_failure", {
          p_coach_id: coachId,
        });
        if (recordError) console.error("Could not record Google Calendar failure", recordError.message);
      } catch (error) {
        console.error(
          "Could not record Google Calendar failure",
          error instanceof Error ? error.message : "unknown error",
        );
      }
    },
  );
}

async function googleCalendarFetch(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers,
  });
}

async function readGoogleBusyIntervals(
  admin: AdminClient,
  coachId: string,
  timeMin: string,
  timeMax: string,
): Promise<{ connected: boolean; busy: CalendarBusyInterval[] }> {
  const accessToken = await accessTokenForCoach(admin, coachId);
  if (!accessToken) return { connected: false, busy: [] };

  const response = await googleCalendarFetch(accessToken, "/freeBusy", {
    method: "POST",
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: [{ id: "primary" }],
    }),
  });
  if (!response.ok) throw new Error("Could not read Google Calendar availability");
  const payload = await response.json();
  const calendar = payload.calendars?.primary;
  if (!calendar || (calendar.errors?.length ?? 0) > 0) {
    throw new Error("Google Calendar did not return availability for the primary calendar");
  }
  const busy = Array.isArray(calendar.busy)
    ? calendar.busy
        .filter((item: { start?: unknown; end?: unknown }) =>
          typeof item.start === "string" && typeof item.end === "string",
        )
        .map((item: { start: string; end: string }) => ({ start: item.start, end: item.end }))
    : [];
  return { connected: true, busy };
}

export function getGoogleBusyIntervals(
  admin: AdminClient,
  coachId: string,
  timeMin: string,
  timeMax: string,
): Promise<{ connected: boolean; busy: CalendarBusyInterval[] }> {
  return trackCalendarOperation(admin, coachId, () =>
    readGoogleBusyIntervals(admin, coachId, timeMin, timeMax),
  );
}

function calendarEventId(source: CalendarSource, sessionId: string): string {
  const code: Record<CalendarSource, string> = { coaching: "c", peer: "p", mentoring: "m" };
  const id = sessionId.replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(id)) throw new Error("Invalid session id for Google Calendar event");
  // Google event ids accept only a-v and 0-9; UUID hex and this prefix comply.
  return `clariva${code[source]}${id}`;
}

async function writeGoogleCalendarEvent(
  admin: AdminClient,
  input: {
    coachId: string;
    source: CalendarSource;
    sessionId: string;
    topic: string | null;
    startTime: string;
    durationMinutes: number;
    meetingUrl: string | null;
  },
): Promise<{ connected: boolean; synced: boolean }> {
  const accessToken = await accessTokenForCoach(admin, input.coachId);
  if (!accessToken) return { connected: false, synced: false };

  const eventId = calendarEventId(input.source, input.sessionId);
  const start = new Date(input.startTime);
  if (!Number.isFinite(start.getTime()) || input.durationMinutes < 1) {
    throw new Error("Session time is invalid");
  }
  const end = new Date(start.getTime() + input.durationMinutes * 60_000);
  const sourceLabel: Record<CalendarSource, string> = {
    coaching: "Coaching",
    peer: "Peer coaching",
    mentoring: "Mentoring",
  };
  const description = [
    input.topic ? `Topic: ${input.topic}` : "",
    input.meetingUrl ? `Meeting link: ${input.meetingUrl}` : "",
    "Scheduled through Clariva.",
  ].filter(Boolean).join("\n");
  const event = {
    id: eventId,
    summary: `Clariva ${sourceLabel[input.source]} session`,
    description,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    extendedProperties: {
      private: {
        clarivaSessionId: input.sessionId,
        clarivaSessionType: input.source,
      },
    },
  };
  const encodedId = encodeURIComponent(eventId);
  const insert = await googleCalendarFetch(accessToken, "/calendars/primary/events?sendUpdates=none", {
    method: "POST",
    body: JSON.stringify(event),
  });
  if (insert.ok) return { connected: true, synced: true };
  if (insert.status === 409) {
    const patch = await googleCalendarFetch(
      accessToken,
      `/calendars/primary/events/${encodedId}?sendUpdates=none`,
      { method: "PATCH", body: JSON.stringify(event) },
    );
    if (patch.ok) return { connected: true, synced: true };
  }
  throw new Error("Could not add the confirmed session to Google Calendar");
}

export function syncGoogleCalendarEvent(
  admin: AdminClient,
  input: {
    coachId: string;
    source: CalendarSource;
    sessionId: string;
    topic: string | null;
    startTime: string;
    durationMinutes: number;
    meetingUrl: string | null;
  },
): Promise<{ connected: boolean; synced: boolean }> {
  return trackCalendarOperation(admin, input.coachId, () =>
    writeGoogleCalendarEvent(admin, input),
  );
}

async function removeGoogleCalendarEvent(
  admin: AdminClient,
  coachId: string,
  source: CalendarSource,
  sessionId: string,
): Promise<{ connected: boolean; removed: boolean }> {
  const accessToken = await accessTokenForCoach(admin, coachId);
  if (!accessToken) return { connected: false, removed: false };
  const eventId = encodeURIComponent(calendarEventId(source, sessionId));
  const response = await googleCalendarFetch(
    accessToken,
    `/calendars/primary/events/${eventId}?sendUpdates=none`,
    { method: "DELETE" },
  );
  if (response.ok || response.status === 404 || response.status === 410) {
    return { connected: true, removed: true };
  }
  throw new Error("Could not remove the cancelled session from Google Calendar");
}

export function deleteGoogleCalendarEvent(
  admin: AdminClient,
  coachId: string,
  source: CalendarSource,
  sessionId: string,
): Promise<{ connected: boolean; removed: boolean }> {
  return trackCalendarOperation(admin, coachId, () =>
    removeGoogleCalendarEvent(admin, coachId, source, sessionId),
  );
}

export function validBusyWindow(timeMin: unknown, timeMax: unknown): timeMin is string {
  if (typeof timeMin !== "string" || typeof timeMax !== "string") return false;
  const start = new Date(timeMin).getTime();
  const end = new Date(timeMax).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && start < end &&
    end - start <= 366 * 24 * 60 * 60 * 1000;
}
