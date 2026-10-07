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
import {
  adminSessionCalendarColumns,
  syncAdminEditedCalendarSession,
} from "../../../supabase/functions/_shared/adminSessionCalendarSync";
import {
  createTokenRefreshFailure,
  GoogleCalendarReconnectRequiredError,
  trackGoogleCalendarOperation,
} from "../../../supabase/functions/_shared/googleCalendarFailurePolicy";

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

  it("selects only the session table's coach column", () => {
    const coachingColumns = adminSessionCalendarColumns("coach_id").split(", ");
    const peerColumns = adminSessionCalendarColumns("peer_coach_id").split(", ");

    expect(coachingColumns).toContain("coach_id");
    expect(coachingColumns).not.toContain("peer_coach_id");
    expect(peerColumns).toContain("peer_coach_id");
    expect(peerColumns).not.toContain("coach_id");

    const adminEdit = projectFile("../../../supabase/functions/admin-session-edit/index.ts");
    expect(adminEdit).toContain("adminSessionCalendarColumns(coachField)");
    expect(adminEdit).toContain("syncAdminEditedCalendarSession(");
  });

  it("moves the confirmed Google event for the coach when an Admin reschedules", async () => {
    const sessionId = "session-1";
    const oldStartTime = "2026-10-15T09:00:00.000Z";
    const newStartTime = "2026-10-16T11:30:00.000Z";
    const eventKey = `coaching:${sessionId}`;
    const events = new Map([[eventKey, { coachId: "coach-1", startTime: oldStartTime }]]);
    const syncEvent = vi.fn(async (input: {
      coachId: string;
      source: "coaching" | "peer";
      sessionId: string;
      topic: string | null;
      startTime: string;
      durationMinutes: number;
      meetingUrl: string | null;
    }) => {
      events.set(`${input.source}:${input.sessionId}`, input);
      return { connected: true, synced: true };
    });
    const removeEvent = vi.fn(async () => ({ connected: true, removed: true }));
    const session = {
      status: "confirmed",
      coach_id: "coach-1",
      peer_coach_id: "wrong-coach",
      topic: "Updated coaching session",
      start_time: newStartTime,
      duration_minutes: 60,
      meeting_url: "https://meet.example/rescheduled",
    };

    const result = await syncAdminEditedCalendarSession("coaching", sessionId, session, {
      syncEvent,
      removeEvent,
    });

    expect(result).toBe("synced");
    expect(syncEvent).toHaveBeenCalledWith({
      coachId: "coach-1",
      source: "coaching",
      sessionId,
      topic: "Updated coaching session",
      startTime: newStartTime,
      durationMinutes: 60,
      meetingUrl: "https://meet.example/rescheduled",
    });
    expect(events.get(eventKey)).toMatchObject({ coachId: "coach-1", startTime: newStartTime });
    expect(removeEvent).not.toHaveBeenCalled();

    const googleCalendar = projectFile("../../../supabase/functions/_shared/googleCalendar.ts");
    expect(googleCalendar).toContain("if (insert.status === 409)");
    expect(googleCalendar).toContain("method: \"PATCH\", body: JSON.stringify(event)");
  });
});

describe("Google Calendar token-refresh failure policy", () => {
  it("classifies invalid_grant and token-refresh 401/403 as reconnect failures", () => {
    expect(createTokenRefreshFailure(400, "invalid_grant"))
      .toBeInstanceOf(GoogleCalendarReconnectRequiredError);
    expect(createTokenRefreshFailure(401, "unauthorized_client"))
      .toBeInstanceOf(GoogleCalendarReconnectRequiredError);
    expect(createTokenRefreshFailure(403, null))
      .toBeInstanceOf(GoogleCalendarReconnectRequiredError);

    for (const [status, errorCode] of [
      [400, "invalid_client"],
      [429, "temporarily_unavailable"],
      [500, "backend_error"],
      [503, null],
    ] as const) {
      expect(createTokenRefreshFailure(status, errorCode))
        .not.toBeInstanceOf(GoogleCalendarReconnectRequiredError);
    }
  });

  it("does not count transient or Calendar API failures and clears reconnect after success", async () => {
    let needsReconnect = false;
    const recordReconnectFailure = vi.fn(async () => { needsReconnect = true; });
    const clearReconnectState = vi.fn(async () => { needsReconnect = false; });

    for (const failure of [
      new TypeError("request timed out"),
      createTokenRefreshFailure(429, "temporarily_unavailable"),
      createTokenRefreshFailure(500, "server_error"),
      createTokenRefreshFailure(502, "server_error"),
      createTokenRefreshFailure(503, "backend_error"),
      createTokenRefreshFailure(504, "gateway_timeout"),
      new Error("Calendar API returned 403"),
    ]) {
      await expect(trackGoogleCalendarOperation(
        async () => { throw failure; },
        clearReconnectState,
        recordReconnectFailure,
      )).rejects.toBe(failure);
    }
    expect(recordReconnectFailure).not.toHaveBeenCalled();
    expect(clearReconnectState).not.toHaveBeenCalled();

    const reconnectFailures = [
      createTokenRefreshFailure(400, "invalid_grant"),
      createTokenRefreshFailure(401, "unauthorized_client"),
      createTokenRefreshFailure(403, null),
    ];
    for (const failure of reconnectFailures) {
      await expect(trackGoogleCalendarOperation(
        async () => { throw failure; },
        clearReconnectState,
        recordReconnectFailure,
      )).rejects.toBe(failure);
    }
    expect(recordReconnectFailure).toHaveBeenCalledTimes(3);
    expect(needsReconnect).toBe(true);

    await expect(trackGoogleCalendarOperation(
      async () => ({ connected: true }),
      clearReconnectState,
      recordReconnectFailure,
    )).resolves.toEqual({ connected: true });
    expect(clearReconnectState).toHaveBeenCalledOnce();
    expect(needsReconnect).toBe(false);

    const implementation = projectFile("../../../supabase/functions/_shared/googleCalendar.ts");
    expect(implementation).toContain("throw createTokenRefreshFailure(response.status, result.error)");
    expect(implementation).toContain("needs_reconnect: false");
    expect(implementation).not.toContain("if (connection.needs_reconnect)");
  });
});
