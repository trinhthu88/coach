import { describe, expect, it } from "vitest";
import {
  DEMO_ACCOUNTS,
  DEMO_ANCHOR_DATE,
  DEMO_BATCH_1_CONTRACT,
  DEMO_FIXTURE_IDS,
  DEMO_FIXTURE_VERSION,
  DEMO_LEADER_COUNT,
  DEMO_ORGANIZATION_ID,
  DEMO_PROGRAMMES,
} from "../../../supabase/functions/demo-admin/manifest";

describe("Clariva live-demo Batch 1 contract", () => {
  it("uses one fixed target and deterministic fixture identifiers", () => {
    expect(DEMO_FIXTURE_IDS.organization).toBe(DEMO_ORGANIZATION_ID);
    expect(new Set(Object.values(DEMO_FIXTURE_IDS.programmes)).size).toBe(4);
    expect(new Set(Object.values(DEMO_FIXTURE_IDS.cohorts)).size).toBe(4);
    expect(new Set(Object.values(DEMO_FIXTURE_IDS.accounts)).size).toBe(4);
    expect(DEMO_ORGANIZATION_ID).toBe("c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01");
  });

  it("keeps the approved portfolio and Batch 1 scope separate", () => {
    expect(DEMO_FIXTURE_VERSION).toBe("clariva-live-demo-v1");
    expect(DEMO_ANCHOR_DATE).toBe("2026-01-05");
    expect(DEMO_LEADER_COUNT).toBe(40);
    expect(DEMO_ACCOUNTS).toHaveLength(4);
    expect(DEMO_PROGRAMMES).toHaveLength(4);
    expect(DEMO_BATCH_1_CONTRACT.creates.leaders).toBe(0);
    expect(DEMO_BATCH_1_CONTRACT.creates.activity).toBe(0);
  });
});