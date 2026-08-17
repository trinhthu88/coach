import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { changeLanguage } from "@/i18n/language";
import { SUPPORTED_LANGUAGES, SupportedLanguage } from "@/i18n/config";

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: "EN",
  vi: "VI",
};

/**
 * Reads/writes through the i18next setup in src/i18n — zero props, safe to render
 * both on public (pre-login) pages and inside the authenticated AppLayout shell.
 */
export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const { user } = useAuth();
  const active = i18n.language as SupportedLanguage;

  return (
    <div
      role="group"
      aria-label="Language"
      className="inline-flex h-[34px] shrink-0 items-center gap-0.5 rounded-[11px] border border-border bg-card p-0.5"
    >
      {SUPPORTED_LANGUAGES.map((lang) => (
        <button
          key={lang}
          type="button"
          aria-pressed={active === lang}
          onClick={() => changeLanguage(lang, user?.id)}
          className={cn(
            "rounded-[8px] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide transition-colors",
            active === lang
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {LANGUAGE_LABELS[lang]}
        </button>
      ))}
    </div>
  );
}

export default LanguageSwitcher;
