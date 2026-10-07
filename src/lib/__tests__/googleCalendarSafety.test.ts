import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const mocked = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: mocked.invoke } },
}));

import { getCoachCalendarBusyFailOpen } from "../googleCalendar";
import { tryGoogleCalendarCheck } from "../../../supabase/functions/_shared/googleCalendarPolicy";
import {
  canCompleteGoogleCalendarOAuth,
  createOAuthCodeChallenge,
  createOAuthCodeVerifier,
} from "../../../supabase/functions/_shared/googleCalendarOAuth";

const projectFile = (...parts: string[]) => readFileSync(path.resolve(__dirname, ...parts), "utf8");

afterEach(() => vi.clearAllMocks());

describe("calendar failure policy", () => {
  it("treats a rejected booking availability lookup as a warning and an empty busy list", async () => {
    const error = new Error("Google is unavailable");
    mocked.invoke.mockResolvedValueOnce({ data: null, error });
    const onError = vi.fn();

    const result = await getCoachCalendarBusyFailOpen(
      "coach-1",
      "2026-10-09T00:00:00Z",
      "2026-10-10T00:00:00Z",
      onError,
    );

    expect(result).toEqual({ busy: [], failed: true });
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("continues a confirmation when the Google Calendar lookup throws", async () => {
    const onError = vi.fn();
    const result = await tryGoogleCalendarCheck(
      async () => { throw new Error("revoked token"); },
      onError,
    );
    expect(result).toBeNull();
    expect(onError).toHaveBeenCalledOnce();

    for (const name of ["confirm-session", "confirm-mentoring-session"]) {
      const source = projectFile("../../../supabase/functions", name, "index.ts");
      expect(source).toContain("tryGoogleCalendarCheck");
      expect(source).toContain("calendarAvailability?.connected");
      expect(source).toMatch(/const calendarAvailability = isAdmin\s*\?\s*null\s*:\s*await tryGoogleCalendarCheck/);
      expect(source).toContain("calendarAvailability.busy.some");
      expect(source).toContain("calendar_conflict");
    }
  });

  it("keeps booking available after a failed check and keeps real busy conflicts", () => {
    for (const name of ["BookSession.tsx", "MentoringBookSession.tsx"]) {
      const source = projectFile("../../pages", name);
      expect(source).toContain("getCoachCalendarBusyFailOpen");
      expect(source).toContain('role="alert"');
      expect(source).not.toMatch(/disabled=\{[^}]*coachCalendarError/);
    }
  });
});

describe("OAuth PKCE and coach binding", () => {
  it("creates a valid verifier and derives Google's S256 challenge", async () => {
    const verifier = createOAuthCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(createOAuthCodeChallenge(
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    )).resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("only completes an unexpired OAuth state for its authenticated coach", () => {
    const now = Date.parse("2026-10-08T00:00:00Z");
    const state = {
      coachId: "coach-1",
      userId: "coach-1",
      codeVerifier: "a".repeat(43),
      expiresAt: "2026-10-08T00:10:00Z",
    };
    expect(canCompleteGoogleCalendarOAuth(state, now)).toBe(true);
    expect(canCompleteGoogleCalendarOAuth({ ...state, userId: "coach-2" }, now)).toBe(false);
    expect(canCompleteGoogleCalendarOAuth({ ...state, codeVerifier: null }, now)).toBe(false);
    expect(canCompleteGoogleCalendarOAuth({ ...state, expiresAt: "2026-10-07T23:59:00Z" }, now)).toBe(false);
  });

  it("keeps the provider callback token-free and exchanges codes in the authenticated completion function", () => {
    const callback = projectFile("../../../supabase/functions/google-calendar-oauth-callback/index.ts");
    const completion = projectFile("../../../supabase/functions/google-calendar-oauth-complete/index.ts");
    const start = projectFile("../../../supabase/functions/google-calendar-oauth-start/index.ts");
    expect(callback).toContain('redirectToApp(returnOrigin, "complete", { code, state })');
    expect(callback).not.toContain("oauth2.googleapis.com/token");
    expect(callback).not.toContain("google_calendar_connections");
    expect(start).toContain("code_challenge_method: \"S256\"");
    expect(completion).toContain("requestUser(req)");
    expect(completion).toContain("userHasCoachRole(admin, user.id)");
    expect(completion).toContain("code_verifier: consumed.code_verifier");
    expect(completion).toContain("canCompleteGoogleCalendarOAuth");
  });
});

describe("reconnect threshold and server-side event handling", () => {
  it("marks a connection for reconnect after repeated errors and restricts the RPC", () => {
    const migration = projectFile(
      "../../../supabase/migrations/20261008120000_google_calendar_resilience.sql",
    );
    expect(migration).toContain("connection.consecutive_error_count + 1 >= 3");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.record_google_calendar_failure(uuid) TO service_role");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    const card = projectFile("../../components/CoachGoogleCalendarCard.tsx");
    expect(card).toContain("needsReconnectStatus");
    expect(card).toContain("availability.googleCalendar.reconnect");
    expect(card).toContain("google-calendar-oauth-complete");
  });

  it("runs cancellation, reschedule cleanup, and Admin sync through server functions", () => {
    const cancel = projectFile("../../../supabase/functions/cancel-session/index.ts");
    const reschedule = projectFile("../../../supabase/functions/reschedule-session/index.ts");
    const adminEdit = projectFile("../../../supabase/functions/admin-session-edit/index.ts");
    const adminUi = projectFile("../../pages/AdminSessions.tsx");
    expect(cancel).toContain("deleteGoogleCalendarEvent");
    expect(cancel).toContain('fn: "transition_mentoring_session_status"');
    expect(reschedule).toContain("deleteGoogleCalendarEvent");
    expect(reschedule).toContain('asCaller.rpc(\n      "reschedule_coaching_session"');
    expect(adminEdit).toContain('row.role === "admin"');
    expect(adminEdit).toContain("syncGoogleCalendarEvent");
    expect(adminUi).toContain('"admin-session-edit"');
    expect(adminUi).not.toContain("google-calendar-sync-sessions");
  });
});
