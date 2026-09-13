import { describe, it, expect } from "vitest";
import { leaderHeaderStatusKey, moduleLabel } from "../sponsorUtils";

describe("leaderHeaderStatusKey", () => {
  it("collapses at_risk into active — Leader Detail spec forbids showing at_risk as an enrollment status", () => {
    expect(leaderHeaderStatusKey("at_risk")).toBe("active");
  });
  it("passes through active, paused and completed unchanged", () => {
    expect(leaderHeaderStatusKey("active")).toBe("active");
    expect(leaderHeaderStatusKey("paused")).toBe("paused");
    expect(leaderHeaderStatusKey("completed")).toBe("completed");
  });
});

describe("moduleLabel", () => {
  it("labels every configured cadence activity type, not just TASC's", () => {
    expect(moduleLabel("coaching")).toBe("1:1 Coaching");
    expect(moduleLabel("peer_coaching")).toBe("Peer Coaching");
    expect(moduleLabel("mentoring")).toBe("Mentor Coaching");
    expect(moduleLabel("triads")).toBe("Triad Practice");
  });
  it("falls back to the raw value for an unrecognized module type", () => {
    expect(moduleLabel("some_future_module")).toBe("some_future_module");
  });
});
