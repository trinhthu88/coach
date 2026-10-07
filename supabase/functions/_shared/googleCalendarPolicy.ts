export async function tryGoogleCalendarCheck<T>(
  check: () => Promise<T>,
  onError: (error: unknown) => void = () => {},
): Promise<T | null> {
  try {
    return await check();
  } catch (error) {
    onError(error);
    return null;
  }
}
