import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Coach invites are replaced by Admin coaching engagements (decision 4, 20261006170000). */
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("coaching engagements replace coach invites", () => {
  it("the coach invite path is gone", () => {
    expect(existsSync(join(process.cwd(), "supabase/functions/coach-invite-coachee"))).toBe(false);
    expect(existsSync(join(process.cwd(), "src/pages/coach/InviteClientDialog.tsx"))).toBe(false);
    expect(existsSync(join(process.cwd(), "src/hooks/coach/useCoachInviteSlots.ts"))).toBe(false);
    expect(read("supabase/config.toml")).not.toMatch(/coach-invite-coachee/);
  });

  it("nothing in the app or the Edge Functions writes the coach allowlist", () => {
    const writers = [
      "src/hooks/admin/useAdminCoacheeMutations.ts",
      "supabase/functions/_shared/adminInvite.ts",
    ].filter((f) => /coachee_coach_allowlist"\)\s*\.(insert|upsert|delete|update)/.test(read(f).replace(/\n\s*/g, "")));
    expect(writers).toEqual([]);
  });

  it("Coaches refer, Admin creates engagements, and the client list includes engagement clients", () => {
    expect(read("src/pages/CoachClients.tsx")).toMatch(/ReferClientDialog/);
    expect(read("src/pages/coach/ReferClientDialog.tsx")).toMatch(/rpc\("coach_refer_client"/);
    expect(read("src/pages/admin/cohorts/NewCoachingEngagementDialog.tsx")).toMatch(/rpc\("admin_create_coaching_engagement"/);
    // The client list is coach_client_summary (20261007001100), which lists
    // engagement clients before their first session.
    expect(read("src/hooks/coach/useCoachClients.ts")).toMatch(/rpc\("coach_client_summary"\)/);
    expect(read("supabase/migrations/20261007001100_browser_numbers.sql"))
      .toMatch(/coach_client_summary\(\)[\s\S]*c\.kind = 'engagement'/);
  });
});
