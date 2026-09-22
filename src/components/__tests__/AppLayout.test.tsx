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
  enrollmentId?: string | null;
  error?: string | null;
};
vi.mock("@/hooks/useProgrammeModules", () => ({
  useProgrammeModules: () => mockModules,
}));

// Canonical per-module progress (learner_module_progress) behind the badges.
let mockModuleProgress: { rows: { module: string; required_units: number; completed_units: number }[] } = { rows: [] };
vi.mock("@/hooks/useLearnerModuleProgress", () => ({
  useLearnerModuleProgress: () => mockModuleProgress,
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
  mockModuleProgress = { rows: [] };
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

  it("always shows Messages and the combined Profile & Availability workspace regardless of module configuration", () => {
    renderLayout();
    expect(screen.getAllByRole("link", { name: "Messages" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Profile & Availability" }).length).toBeGreaterThan(0);
  });

  // Its real competency analytics now live inside My Journey's "Practice &
  // Competency Analytics" tab instead — see PracticeAnalyticsTab.
  it("never shows Practice journey as a primary coachee destination, even when peer coaching and triads are configured", () => {
    mockModules = { hasModule: (m) => ["peer_coaching", "triads"].includes(m), hasDirection: () => false };
    renderLayout("/coachee/journey");
    expect(screen.queryAllByRole("link", { name: "Practice journey" })).toHaveLength(0);
  });
});

describe("AppLayout — Develop Myself is expanded (Coachee prototype nav rail)", () => {
  const allModules = () => ({
    hasModule: (m: string) => ["coaching", "peer_coaching", "mentoring", "triads"].includes(m),
    hasDirection: () => true,
  });
  const MODULE_LINKS: [string, string][] = [
    ["/coaches", "Coaching"],
    ["/coachee/peer-practice", "Peer coaching"],
    ["/mentoring", "Mentoring"],
    ["/triads", "Triads"],
  ];

  it("shows every Develop Myself child on first load from the Dashboard", () => {
    mockModules = allModules();
    renderLayout("/dashboard");
    for (const [, name] of MODULE_LINKS) {
      expect(screen.getAllByRole("link", { name }).length).toBeGreaterThan(0);
    }
  });

  it("renders Develop Myself as a static, always-open section for learners (no collapse toggle)", () => {
    mockModules = allModules();
    renderLayout("/dashboard");
    expect(screen.getAllByRole("group", { name: "Develop Myself" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Develop Myself/ })).toBeNull();
  });

  it.each([...MODULE_LINKS, ["/coachee/journey", "My Journey"] as [string, string]])(
    "deep link %s keeps Develop Myself open and highlights %s",
    (path, activeName) => {
      mockModules = allModules();
      renderLayout(path);
      for (const [, name] of MODULE_LINKS) {
        expect(screen.getAllByRole("link", { name }).length).toBeGreaterThan(0);
      }
      const active = screen.getAllByRole("link", { name: activeName });
      expect(active.some((link) => link.getAttribute("aria-current") === "page")).toBe(true);
      for (const [to, name] of MODULE_LINKS) {
        if (to === path) continue;
        expect(screen.getAllByRole("link", { name }).every((link) => link.getAttribute("aria-current") !== "page")).toBe(true);
      }
    }
  );

  it("opens Develop Myself by default for coaches too (still collapsible)", () => {
    mockAuth.mockReturnValue({ ...baseAuth, role: "coach" as const });
    mockModules = { hasModule: (m) => ["mentoring", "peer_coaching", "coaching"].includes(m), hasDirection: () => true };
    renderLayout("/dashboard");
    expect(screen.getAllByRole("link", { name: "Mentoring" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Develop Myself/ })).toBeInTheDocument();
  });
});

describe("AppLayout — coach navigation is unaffected by the coachee nav restructure", () => {
  it("still shows the coach's Sessions, Messages and My development items", () => {
    mockAuth.mockReturnValue({ ...baseAuth, role: "coach" as const });
    mockModules = {
      hasModule: (m) => ["mentoring", "peer_coaching", "coaching", "training", "triads"].includes(m),
      hasDirection: () => true,
    };
    renderLayout("/mentoring");
    expect(screen.getAllByRole("link", { name: "Sessions" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Messages" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Mentoring" }).length).toBeGreaterThan(0);
  });

  it("still shows the coach's Practice journey link (untouched by the coachee nav change)", () => {
    mockAuth.mockReturnValue({ ...baseAuth, role: "coach" as const });
    mockModules = { hasModule: (m) => m === "peer_coaching", hasDirection: () => false };
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

describe("AppLayout — learner module entries follow the active enrollment's canonical progress", () => {
  const allModules = () => ({
    hasModule: (m: string) => ["coaching", "peer_coaching", "mentoring", "triads", "training"].includes(m),
    hasDirection: () => true,
    enrollmentId: "enr-active",
    error: null,
  });

  it("each enabled module links to its module page and shows the canonical completed/required", () => {
    mockAuth.mockReturnValue(baseAuth);
    mockModules = allModules();
    mockModuleProgress = {
      rows: [
        { module: "training", required_units: 8, completed_units: 5 },
        { module: "coaching", required_units: 4, completed_units: 4 },
        { module: "mentoring", required_units: 2, completed_units: 2 },
        { module: "peer_coaching", required_units: 2, completed_units: 1 },
        { module: "triads", required_units: 2, completed_units: 1 },
      ],
    };
    renderLayout();
    for (const [path, badge] of [["/training", "5/8"], ["/coaches", "4/4"], ["/mentoring", "2/2"], ["/coachee/peer-practice", "1/2"], ["/triads", "1/2"]]) {
      const link = document.querySelector(`aside a[href="${path}"]`);
      expect(link, path).not.toBeNull();
      expect(link).toHaveTextContent(badge);
    }
    // Sessions stays as the cross-module hub.
    expect(document.querySelector('aside a[href="/sessions"]')).not.toBeNull();
  });

  it("a module the programme does not configure has no entry and no badge", () => {
    mockAuth.mockReturnValue(baseAuth);
    mockModules = { ...allModules(), hasModule: (m: string) => m === "coaching" };
    mockModuleProgress = { rows: [{ module: "coaching", required_units: 4, completed_units: 1 }] };
    renderLayout();
    expect(document.querySelector('aside a[href="/coaches"]')).toHaveTextContent("1/4");
    for (const path of ["/training", "/mentoring", "/coachee/peer-practice", "/triads"]) {
      expect(document.querySelector(`aside a[href="${path}"]`), path).toBeNull();
    }
  });

  it("a failed module load is surfaced, never shown as a programme without modules", () => {
    mockAuth.mockReturnValue(baseAuth);
    mockModules = { hasModule: () => false, hasDirection: () => false, enrollmentId: null, error: "permission denied" };
    renderLayout();
    expect(screen.getAllByTestId("nav-modules-error")[0]).toHaveTextContent(/could not be loaded/i);
  });
});
