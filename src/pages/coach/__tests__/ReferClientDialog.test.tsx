import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n/config";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), tables: [] as string[], invoke: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mocks.rpc,
    functions: { invoke: mocks.invoke },
    from: (table: string) => {
      mocks.tables.push(table);
      const query = {
        select: () => query,
        eq: () => query,
        order: async () => ({ data: [{ id: "p1", name: "1:1 Coaching" }], error: null }),
      };
      return query;
    },
  },
}));

import { ReferClientDialog } from "../ReferClientDialog";

/**
 * "Refer a client" (decision 4): the Coach sends Admin a pending request
 * through coach_refer_client. No account is created and no invite is sent.
 */
describe("ReferClientDialog", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.invoke.mockReset();
    mocks.rpc.mockResolvedValue({ data: "req-1", error: null });
  });

  it("sends a referral to Admin and never invites the client itself", async () => {
    const onOpenChange = vi.fn();
    render(<ReferClientDialog open onOpenChange={onOpenChange} />);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Minh Tran" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "minh@example.test" } });
    expect(screen.getByText(/does not create an account or give access/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send referral" }));
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith("coach_refer_client", {
        p_full_name: "Minh Tran",
        p_email: "minh@example.test",
        p_suggested_programme_id: undefined,
        p_note: undefined,
      }),
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
