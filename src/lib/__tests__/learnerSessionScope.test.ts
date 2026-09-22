import { describe, expect, it } from "vitest";
import { scopeLearnerSessions } from "../learnerSessionScope";
import { viewerEnrollmentFor, type PeerParticipationIndex } from "@/hooks/sessions/useSessionsData";

// Linh: Cohort A enrollment (historical) and Cohort B enrollment (active).
const LINH_A = "enr-linh-a";
const LINH_B = "enr-linh-b";
const NOOR_A = "enr-noor-a";

// Linh's OWN peer participations (peer_session_participants where user_id = Linh).
const participations: PeerParticipationIndex = new Map([
  ["coachee_peer:peer-a-provided", LINH_A], // Linh PROVIDED; the session row carries Noor's enrollment
  ["coachee_peer:peer-a-received", LINH_A],
  ["coachee_peer:peer-b-received", LINH_B],
  ["coachee_peer:peer-b-provided", LINH_B],
]);

const row = (id: string, kind: Parameters<typeof viewerEnrollmentFor>[0]["kind"], enrollment_id: string | null) => {
  const r = { id, kind, enrollment_id };
  return { ...r, viewer_enrollment_id: viewerEnrollmentFor(r, participations) };
};

const rows = [
  row("coaching-b", "coaching", LINH_B),
  row("coaching-a", "coaching", LINH_A),
  row("peer-a-provided", "coachee-peer-give", NOOR_A),
  row("peer-a-received", "coachee-peer-receive", LINH_A),
  row("peer-b-received", "coachee-peer-receive", LINH_B),
  row("peer-b-provided", "coachee-peer-give", "enr-partner-b"),
  row("triad-b", "triad", LINH_B),
];

describe("peer participant attribution — each participant's OWN enrollment", () => {
  it("a session Linh PROVIDED resolves to her own participant enrollment, not the receiver's session enrollment", () => {
    expect(rows.find((r) => r.id === "peer-a-provided")?.viewer_enrollment_id).toBe(LINH_A);
    expect(rows.find((r) => r.id === "peer-b-provided")?.viewer_enrollment_id).toBe(LINH_B);
  });

  it("a session Linh RECEIVED resolves to her own participant enrollment", () => {
    expect(rows.find((r) => r.id === "peer-a-received")?.viewer_enrollment_id).toBe(LINH_A);
    expect(rows.find((r) => r.id === "peer-b-received")?.viewer_enrollment_id).toBe(LINH_B);
  });

  it("the same physical session resolves to each participant's own enrollment", () => {
    const shared = { id: "peer-a-provided", kind: "coachee-peer-receive" as const, enrollment_id: NOOR_A };
    // Noor (the receiver) sees it under her own enrollment...
    expect(viewerEnrollmentFor(shared, new Map([["coachee_peer:peer-a-provided", NOOR_A]]))).toBe(NOOR_A);
    // ...Linh (the provider) under hers.
    expect(viewerEnrollmentFor({ ...shared, kind: "coachee-peer-give" }, participations)).toBe(LINH_A);
  });

  it("without a participant row the session is not attributed to the viewer at all", () => {
    expect(viewerEnrollmentFor({ id: "unknown", kind: "coachee-peer-give", enrollment_id: LINH_B }, participations)).toBeNull();
    expect(viewerEnrollmentFor({ id: "x", kind: "mentoring-mentor", enrollment_id: LINH_B }, participations)).toBeNull();
  });
});

describe("Sessions hub — current programme = viewer_enrollment_id is the active enrollment", () => {
  it("the current view holds only sessions attributable to Linh's Cohort B enrollment", () => {
    const scoped = scopeLearnerSessions(rows, LINH_B, false);
    expect(scoped.rows.map((r) => r.id).sort()).toEqual(["coaching-b", "peer-b-provided", "peer-b-received", "triad-b"]);
    // The Cohort A session she provided (whose session row names Noor's enrollment) is NOT current.
    expect(scoped.rows.map((r) => r.id)).not.toContain("peer-a-provided");
    expect(scoped.hiddenPast).toBe(3);
  });

  it("'show past programmes' adds Linh's Cohort A sessions, each once", () => {
    const all = scopeLearnerSessions(rows, LINH_B, true).rows;
    expect(all.map((r) => r.id)).toEqual(expect.arrayContaining(["coaching-a", "peer-a-provided", "peer-a-received"]));
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
  });

  it("without an active enrollment nothing is 'current'", () => {
    expect(scopeLearnerSessions(rows, null, false).rows).toEqual([]);
  });
});
