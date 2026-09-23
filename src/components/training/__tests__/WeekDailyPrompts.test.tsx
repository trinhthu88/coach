import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, upsert } = vi.hoisted(() => ({ from: vi.fn(), upsert: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));

import "@/i18n/config";
import { WeekDailyPrompts } from "../WeekDailyPrompts";

/** A query builder whose every filter returns itself and which resolves to `result`. */
function query(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order"]) builder[m] = () => builder;
  builder.then = (resolve: (v: unknown) => void) => resolve(result);
  return builder;
}

const prompts = [
  { id: "p1", prompt_text: "Ask one open question today.", prompt_text_vi: null, day_offset: 1 },
  { id: "p2", prompt_text: "Notice one moment of irritation.", prompt_text_vi: null, day_offset: 2 },
  { id: "p3", prompt_text: "Explain the why of one decision.", prompt_text_vi: null, day_offset: null },
];

function mockData(responses: unknown[]) {
  from.mockImplementation((table: string) => {
    if (table === "daily_prompts") return query({ data: prompts, error: null });
    return { ...query({ data: responses, error: null }), upsert };
  });
}

function renderPrompts(hash = "") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/training/w1${hash}`]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<WeekDailyPrompts weekId="w1" userId="learner-1" enrollmentId="enr-1" isVi={false} />, { wrapper: wrap });
}

describe("WeekDailyPrompts — the week's prompts, each optional and answerable", () => {
  beforeEach(() => {
    from.mockReset();
    upsert.mockReset();
    upsert.mockResolvedValue({ error: null });
  });

  it("lists every prompt; an answered one shows Done and its answer, the others an input and Optional", async () => {
    // p2 was only opened (no responded_at): it is not answered.
    mockData([
      { daily_prompt_id: "p1", response_text: "Two quiet people spoke.", responded_at: "2026-09-22T00:40:00Z" },
      { daily_prompt_id: "p2", response_text: null, responded_at: null },
    ]);
    renderPrompts();
    const items = await screen.findAllByTestId("week-prompt");
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.getAttribute("data-state"))).toEqual(["done", "open", "open"]);

    expect(items[0]).toHaveTextContent("Day 1");
    expect(items[0]).toHaveTextContent("Answered");
    expect(items[0]).toHaveTextContent("Two quiet people spoke.");
    expect(within(items[0]).queryByRole("textbox")).toBeNull();

    for (const open of items.slice(1)) {
      expect(open).toHaveTextContent("Optional");
      expect(within(open).getByRole("textbox")).toBeInTheDocument();
      expect(within(open).getByRole("button", { name: "Mark done" })).toBeInTheDocument();
    }
    expect(screen.getByTestId("week-daily-prompts")).toHaveTextContent("they never affect week completion");
  });

  it("saves an answer for the learner's own enrollment", async () => {
    mockData([]);
    renderPrompts();
    const [first] = await screen.findAllByTestId("week-prompt");
    fireEvent.change(within(first).getByRole("textbox"), { target: { value: "Tried it in stand-up." } });
    fireEvent.click(within(first).getByRole("button", { name: "Mark done" }));
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    const [row, options] = upsert.mock.calls[0];
    expect(row).toMatchObject({ user_id: "learner-1", enrollment_id: "enr-1", daily_prompt_id: "p1", response_text: "Tried it in stand-up." });
    expect(row.responded_at).toEqual(expect.any(String));
    expect(options).toEqual({ onConflict: "enrollment_id,daily_prompt_id" });
  });

  it("is the #daily-prompts anchor the week list links to", async () => {
    mockData([]);
    renderPrompts("#daily-prompts");
    const section = await screen.findByTestId("week-daily-prompts");
    expect(section).toHaveAttribute("id", "daily-prompts");
  });
});
