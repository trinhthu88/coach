import { describe, it, expect } from "vitest";
import { canMarkSessionComplete } from "../completionGate";

/**
 * One rule for every kind of session: confirmed, started, and an actor who was
 * entitled to be there. The caller decides who counts as that actor -- the
 * Coach for Coaching, either participant for Peer -- because that is the only
 * part that differs, and it is the part the server-side writers also differ on.
 */
describe("canMarkSessionComplete", () => {
  const held = { isConfirmed: true, hasStarted: true, isPermittedActor: true };

  it("allows a permitted actor to mark a confirmed session held once it has started", () => {
    expect(canMarkSessionComplete(held)).toBe(true);
  });

  it("blocks completion before the session has started", () => {
    expect(canMarkSessionComplete({ ...held, hasStarted: false })).toBe(false);
  });

  it("blocks completion while the session is still pending confirmation", () => {
    expect(canMarkSessionComplete({ ...held, isConfirmed: false })).toBe(false);
  });

  it("blocks somebody who was not in the session", () => {
    expect(canMarkSessionComplete({ ...held, isPermittedActor: false })).toBe(false);
  });

  it("depends on no artefact at all", () => {
    // Coaching once required the learner's notes and Peer once required the
    // actor's own ICF competency feedback. Both conflated "the conversation
    // happened" with "somebody has written it up". Whether the programme UNIT
    // is complete is a separate question, answered by canonical requirement
    // fulfilment -- not by this button.
    expect(canMarkSessionComplete(held)).toBe(true);
    expect(Object.keys(held)).toEqual(["isConfirmed", "hasStarted", "isPermittedActor"]);
  });

  it("treats a Peer session exactly like a Coaching one: no special case remains", () => {
    // The old signature had an `isPeer` branch that skipped the confirmed and
    // started checks entirely, so a Peer session could be completed before it
    // had even been accepted. It cannot now.
    expect(canMarkSessionComplete({ isConfirmed: false, hasStarted: false, isPermittedActor: true })).toBe(false);
  });
});
