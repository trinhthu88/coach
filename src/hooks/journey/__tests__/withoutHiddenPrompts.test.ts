import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useProgrammeModules", () => ({ useProgrammeModules: () => ({ hasModule: () => true }) }));

import { withoutHiddenPrompts } from "../useLearnerReflectionFeed";

describe("withoutHiddenPrompts — Daily Prompts off leave no trace in the learner's feed", () => {
  const feed = [
    { key: "a", sourceType: "daily_prompt_response" },
    { key: "b", sourceType: "coaching_session_reflection" },
  ];

  it("keeps prompt answers while Daily Prompts are on", () => {
    expect(withoutHiddenPrompts(feed, true).map((r) => r.key)).toEqual(["a", "b"]);
  });

  it("drops them when Daily Prompts are off (feed rows and journey events alike)", () => {
    expect(withoutHiddenPrompts(feed, false).map((r) => r.key)).toEqual(["b"]);
    const events = [{ subtype: "daily_prompt_response", sourceType: "daily_prompt_responses" }, { subtype: "training_reflection", sourceType: "reflection_submissions" }];
    expect(withoutHiddenPrompts(events, false).map((e) => e.subtype)).toEqual(["training_reflection"]);
  });
});
