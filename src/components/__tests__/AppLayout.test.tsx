import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import "@/i18n/config";

// AppLayout's own data needs (unread message count) — no network calls in tests.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ in: () => Promise.resolve({ data: [] }) }),
      }),
    }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
  },
}));

// Child widgets that carry their own data/query dependencies unrelated to
// what this test is actually asserting (nav visibility/order).
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/LanguageSwitcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/components/onboarding/OnboardingTour", () => ({ OnboardingTour: () => null }));

const mockAuth = vi.fn();
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => mockAuth(),
}));

let mockModules: {
  hasModule: (m: string) => boolean;
  hasDirection: (m: string, d: string) => boolean;
};
vi.mock("@/hooks/useProgrammeModules", () => ({
  useProgrammeModules: () => mockModules,
}));

import AppLayout from "../AppLayout";

function renderLayout(initialPath = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AppLayout />
    </MemoryRouter>
  );
}

const baseAuth = {
  user: { id: "u1" },
  profile: { full_name: "Learner One", avatar_url: null, onboarding_completed_at: "2026-01-01" },
  role: "coachee" as const,
  signOut: vi.fn(),
};

function noModulesConfigured() {
  return { hasModule: () => false, hasDirection: () => false };
}

beforeEach(() => {
  mockAuth.mockReset();
  mockAuth.mockReturnValue(baseAuth);
  mockModules = noModulesConfigured();
});

describe("AppLayout — coachee navigation", () => {
  // Regression test for the historical bug where My Journey was gated on
  // module:"coaching" + direction:"receive". My Journey aggregates Programme
  // Journey, Development Journey, goals, actions, reflections and feedback
  // for the selected enrollment as a whole — it must not require the
  // Coaching module specifically to be configured.
  it("shows My Journey even when no modules are configured for the enrollment", () => {
    renderLayout();
    expect(screen.getAllByRole("link", { name: "My Journey" }).length).toBeGreaterThan(0);
  });

  it("always shows Dashboard, My Journey and Sessions regardless of module configuration", () => {
    renderLayout();
    expect(screen.getAllByRole("link", { name: "Dashboard" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "My Journey" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Sessions" }).length).toBeGreaterThan(0);
  });

  it("hides Coaching, Peer Coaching, Mentoring and Triads when their modules are not configured", () => {
    renderLayout();
    expect(screen.queryAllByRole("link", { name: "Coaching" })).toHaveLength(0);
    expect(screen.queryAllByRole("link", { name: "Peer coaching" })).toHaveLength(0);
    expect(screen.queryAllByRole("link", { name: "Mentoring" })).toHaveLength(0);
    expect(screen.queryAllByRole("link", { name: "Triads" })).toHaveLength(0);
  });

  it("shows each My development module only when its module is configured for the enrollment", () => {
    mockModules = {
      hasModule: (m) => ["coaching", "peer_coaching", "mentoring", "triads"].includes(m),
      hasDirection: () => true,
    };
    // "My development" is collapsed by default unless the current route is
    // inside it — land on one of its own items so the group opens.
    renderLayout("/coaches");
    expect(screen.getAllByRole("link", { name: "Coaching" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Peer coaching" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Mentoring" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Triads" }).length).toBeGreaterThan(0);
  });

  it("shows Training & Learning only when the training module is configured", () => {
    renderLayout();
    expect(screen.queryAllByRole("link", { name: "Training & Learning" })).toHaveLength(0);

    mockModules = { hasModule: (m) => m === "training", hasDirection: () => false };
    renderLayout();
    expect(screen.getAllByRole("link", { name: "Training & Learning" }).length).toBeGreaterThan(0);
  });

  it("always shows Messages and Profile & Availability regardless of module configuration", () => {
    renderLayout();
    expect(screen.getAllByRole("link", { name: "Messages" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "My profile" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "My availability" }).length).toBeGreaterThan(0);
  });

  // Its real competency analytics now live inside My Journey's "Practice &
  // Competency Analytics" tab instead — see PracticeAnalyticsTab.
  it("never shows Practice journey as a primary coachee destination, even when peer coaching and triads are configured", () => {
    mockModules = { hasModule: (m) => ["peer_coaching", "triads"].includes(m), hasDirection: () => false };
    renderLayout("/coachee/journey");
    expect(screen.queryAllByRole("link", { name: "Practice journey" })).toHaveLength(0);
  });
});

describe("AppLayout — coach navigation is unaffected by the coachee nav restructure", () => {
  it("still shows the coach's Sessions, Messages and My development items", () => {
    mockAuth.mockReturnValue({ ...baseAuth, role: "coach" as const });
    mockModules = {
      hasModule: (m) => ["mentoring", "peer_coaching", "coaching", "training", "triads"].includes(m),
      hasDirection: () => true,
    };
    // "Develop Myself" is collapsed by default unless the current route is
    // inside it — land on /mentoring so the group opens.
    renderLayout("/mentoring");
    expect(screen.getAllByRole("link", { name: "Sessions" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Messages" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Mentoring" }).length).toBeGreaterThan(0);
  });

  it("still shows the coach's Practice journey link (untouched by the coachee nav change)", () => {
    mockAuth.mockReturnValue({ ...baseAuth, role: "coach" as const });
    mockModules = { hasModule: (m) => m === "peer_coaching", hasDirection: () => false };
    // Land on /practice-journey itself so "Develop Myself" (collapsed by
    // default) opens because its own route is current.
    renderLayout("/practice-journey");
    expect(screen.getAllByRole("link", { name: "Practice journey" }).length).toBeGreaterThan(0);
  });
});

describe("AppLayout — coachee mobile navigation", () => {
  it("provides the approved primary destinations plus More", () => {
    renderLayout("/dashboard");
    expect(screen.getAllByRole("link", { name: "Dashboard" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "My Journey" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Sessions" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Messages" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
  });
});
