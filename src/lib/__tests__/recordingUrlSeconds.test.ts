import { describe, expect, it } from "vitest";
import { recordingUrlSeconds, RECORDING_URL_MARGIN_SECONDS, RECORDING_URL_UNKNOWN_SECONDS } from "../assessments";

describe("recordingUrlSeconds (Prompt 15 item 15)", () => {
  it("lasts the recording's length plus the margin", () => {
    expect(recordingUrlSeconds(1520.4)).toBe(1521 + RECORDING_URL_MARGIN_SECONDS);
  });

  it("falls back to a generous length when the recording's length was never stored", () => {
    expect(recordingUrlSeconds(null)).toBe(RECORDING_URL_UNKNOWN_SECONDS + RECORDING_URL_MARGIN_SECONDS);
    expect(recordingUrlSeconds(0)).toBe(RECORDING_URL_UNKNOWN_SECONDS + RECORDING_URL_MARGIN_SECONDS);
  });
});
