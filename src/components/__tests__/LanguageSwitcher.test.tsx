import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const updateSpy = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ update: updateSpy }),
  },
}));

const authState: { user: { id: string } | null } = { user: null };
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: authState.user }),
}));

import "@/i18n/config";
import i18n from "@/i18n/config";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../LanguageSwitcher";

function Greeting() {
  const { t } = useTranslation("common");
  return <p data-testid="greeting">{t("languageSwitcherDemo")}</p>;
}

beforeEach(async () => {
  authState.user = null;
  updateSpy.mockClear();
  await i18n.changeLanguage("en");
});

describe("LanguageSwitcher", () => {
  it("switches rendered text between English and Vietnamese", async () => {
    render(
      <>
        <LanguageSwitcher />
        <Greeting />
      </>
    );

    expect(screen.getByTestId("greeting").textContent).toBe("Welcome to Clariva");

    fireEvent.click(screen.getByRole("button", { name: "VI" }));
    await waitFor(() =>
      expect(screen.getByTestId("greeting").textContent).toBe("Chào mừng đến với Clariva")
    );

    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    await waitFor(() =>
      expect(screen.getByTestId("greeting").textContent).toBe("Welcome to Clariva")
    );
  });

  it("does not touch Supabase when no user is signed in", async () => {
    render(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "VI" }));
    await waitFor(() => expect(i18n.language).toBe("vi"));
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("persists preferred_language to the profile when a user is signed in", async () => {
    authState.user = { id: "u1" };
    render(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "VI" }));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith({ preferred_language: "vi" }));
  });

  it("renders the same markup regardless of auth state", () => {
    authState.user = null;
    const { container: loggedOut } = render(<LanguageSwitcher />);
    authState.user = { id: "u1" };
    const { container: loggedIn } = render(<LanguageSwitcher />);
    expect(loggedOut.innerHTML).toBe(loggedIn.innerHTML);
  });
});
