import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, stored, scopes } = vi.hoisted(() => ({ rpc: vi.fn(), stored: [] as Record<string, unknown>[], scopes: [] as unknown[][] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from: (table: string) => {
  const query = { select: () => query, eq: (key: string, value: unknown) => { scopes.push([table,key,value]); return query; }, in: () => query, order: () => Promise.resolve({data: stored, error: null}) }; return query;
} } }));
import { withEnrollmentActions, saveEnrollmentActions } from "../enrollmentActions";
beforeEach(() => { scopes.length = 0; stored.length = 0; rpc.mockReset().mockResolvedValue({ error: null }); });
describe("normalized enrollment actions", () => {
  it("uses normalized rows and preserves their identities and relationships instead of legacy JSON", async () => {
    stored.push({id:"action",enrollment_id:"enrollment",source_activity_type:"coaching",source_activity_id:"session",title:"Actual action",status:"completed",goal_id:"goal",milestone_id:"milestone",due_date:null});
    const rows = await withEnrollmentActions([{id:"session",enrollment_id:"enrollment",action_items:[{text:"Legacy stale text"}]}],"coaching");
    expect(rows[0].enrollment_actions).toEqual([{id:"action",text:"Actual action",description:null,done:true,goal_id:"goal",milestone_id:"milestone",due_date:null}]);
    expect(rows[0].enrollment_actions).not.toEqual([{text:"Legacy stale text"}]);
    expect(scopes).toContainEqual(["enrollment_actions","enrollment_id","enrollment"]);
  });
  it("does not attach another enrollment's action even if a malformed response has the same source ID", async () => {
    stored.push({id:"action",enrollment_id:"foreign",source_activity_type:"coaching",source_activity_id:"session",title:"Private"});
    const rows = await withEnrollmentActions([{id:"session",enrollment_id:"enrollment"}],"coaching");
    expect(rows[0].enrollment_actions).toEqual([]);
  });
  it("fails explicitly for missing enrollment ownership and never falls back to JSON", async () => {
    await expect(withEnrollmentActions([{id:"session",enrollment_id:null,action_items:[{text:"Legacy"}]}],"coaching"))
      .rejects.toThrow("unscoped coaching activity session");
    expect(scopes).toEqual([]);
    const result=await saveEnrollmentActions(null,"coaching","session",[]);
    expect(result.error).toBeTruthy(); expect(rpc).not.toHaveBeenCalled();
  });
  it("writes stable action IDs and source/goal/milestone links to the sole authoritative RPC", async () => {
    await saveEnrollmentActions("enrollment","peer_coaching","session",[{id:"action",text:"Follow up",done:false,goal_id:"goal",milestone_id:"milestone"}]);
    expect(rpc).toHaveBeenCalledWith("save_enrollment_activity_actions", {p_enrollment_id:"enrollment",p_source_activity_type:"peer_coaching",p_source_activity_id:"session",p_actions:[{id:"action",title:"Follow up",description:null,status:"open",goal_id:"goal",milestone_id:"milestone",due_date:null}]});
  });
});
