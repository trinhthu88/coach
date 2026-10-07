import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@/i18n/config";
import { MentoringCancelButton } from "../MentoringCancelButton";

const NOW = Date.parse("2026-10-07T03:00:00Z");
const hoursFromNow = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

describe("the mentee's Cancel on a Mentoring session (decision 7)", () => {
  it("more than 24 hours ahead: cancels without a reason", async () => {
    const onCancel = vi.fn().mockResolvedValue({ error: null });
    render(<MentoringCancelButton startTime={hoursFromNow(72)} onCancel={onCancel} now={() => NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel session" }));
    expect(screen.getByText(/can be booked again/)).toBeInTheDocument();
    const confirm = screen.getAllByRole("button", { name: "Cancel session" }).at(-1)!;
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(onCancel).toHaveBeenCalledWith(undefined));
  });

  it("inside 24 hours: asks for a reason and passes it on; the unit is still freed", async () => {
    const onCancel = vi.fn().mockResolvedValue({ error: null });
    render(<MentoringCancelButton startTime={hoursFromNow(5)} onCancel={onCancel} now={() => NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel session" }));
    expect(screen.getByText(/within 24 hours, so please say why/)).toBeInTheDocument();
    const confirm = screen.getAllByRole("button", { name: "Cancel session" }).at(-1)!;
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason \(required/), { target: { value: "  Board meeting moved  " } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(onCancel).toHaveBeenCalledWith("Board meeting moved"));
  });

  it("once the session has started there is no Cancel: a no-show is the Mentor's to mark held", () => {
    render(<MentoringCancelButton startTime={hoursFromNow(-1)} onCancel={vi.fn()} now={() => NOW} />);
    expect(screen.queryByRole("button", { name: "Cancel session" })).not.toBeInTheDocument();
  });
});
