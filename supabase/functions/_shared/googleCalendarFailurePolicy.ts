export class GoogleCalendarReconnectRequiredError extends Error {
  constructor() {
    super("Google Calendar authorization must be renewed");
    this.name = "GoogleCalendarReconnectRequiredError";
  }
}

export function createTokenRefreshFailure(status: number, errorCode: unknown): Error {
  if (errorCode === "invalid_grant" || status === 401 || status === 403) {
    return new GoogleCalendarReconnectRequiredError();
  }
  return new Error("Could not refresh the Google Calendar access token");
}

export async function trackGoogleCalendarOperation<T extends { connected: boolean }>(
  operation: () => Promise<T>,
  clearReconnectState: () => Promise<void>,
  recordReconnectFailure: () => Promise<void>,
): Promise<T> {
  try {
    const result = await operation();
    if (result.connected) await clearReconnectState();
    return result;
  } catch (error) {
    if (error instanceof GoogleCalendarReconnectRequiredError) {
      await recordReconnectFailure();
    }
    throw error;
  }
}
