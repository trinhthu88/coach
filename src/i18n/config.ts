import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

export const SUPPORTED_LANGUAGES = ["en", "vi"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = "clariva_preferred_language";

export const NAMESPACES = [
  "common",
  "auth",
  "dashboard",
  "sessions",
  "admin",
  "onboarding",
  "landing",
  "journey",
  "coaches",
  "profile",
  "sponsor",
  "tools",
  "mentoring",
  "training",
  "triads",
] as const;

type Namespace = (typeof NAMESPACES)[number];
type TranslationModule = { default: Record<string, unknown> };
type TranslationLoader = () => Promise<TranslationModule>;

// Keep translations out of the startup bundle. The active route asks
// react-i18next for its namespace and this backend imports only that JSON file.
// Vite turns each loader into a small cacheable asset, so changing language or
// visiting a new area does not require shipping every namespace up front.
const translationLoaders: Record<SupportedLanguage, Record<Namespace, TranslationLoader>> = {
  en: {
    common: () => import("@/locales/en/common.json"),
    auth: () => import("@/locales/en/auth.json"),
    dashboard: () => import("@/locales/en/dashboard.json"),
    sessions: () => import("@/locales/en/sessions.json"),
    admin: () => import("@/locales/en/admin.json"),
    onboarding: () => import("@/locales/en/onboarding.json"),
    landing: () => import("@/locales/en/landing.json"),
    journey: () => import("@/locales/en/journey.json"),
    coaches: () => import("@/locales/en/coaches.json"),
    profile: () => import("@/locales/en/profile.json"),
    sponsor: () => import("@/locales/en/sponsor.json"),
    tools: () => import("@/locales/en/tools.json"),
    mentoring: () => import("@/locales/en/mentoring.json"),
    training: () => import("@/locales/en/training.json"),
    triads: () => import("@/locales/en/triads.json"),
  },
  vi: {
    common: () => import("@/locales/vi/common.json"),
    auth: () => import("@/locales/vi/auth.json"),
    dashboard: () => import("@/locales/vi/dashboard.json"),
    sessions: () => import("@/locales/vi/sessions.json"),
    admin: () => import("@/locales/vi/admin.json"),
    onboarding: () => import("@/locales/vi/onboarding.json"),
    landing: () => import("@/locales/vi/landing.json"),
    journey: () => import("@/locales/vi/journey.json"),
    coaches: () => import("@/locales/vi/coaches.json"),
    profile: () => import("@/locales/vi/profile.json"),
    sponsor: () => import("@/locales/vi/sponsor.json"),
    tools: () => import("@/locales/vi/tools.json"),
    mentoring: () => import("@/locales/vi/mentoring.json"),
    training: () => import("@/locales/vi/training.json"),
    triads: () => import("@/locales/vi/triads.json"),
  },
};

const lazyTranslationBackend = {
  type: "backend" as const,
  read(
    language: string,
    namespace: string,
    callback: (error: Error | null, data: Record<string, unknown> | false) => void,
  ) {
    const locale = (SUPPORTED_LANGUAGES as readonly string[]).includes(language)
      ? (language as SupportedLanguage)
      : "en";
    const loader = translationLoaders[locale][namespace as Namespace];

    if (!loader) {
      callback(new Error(`Unknown translation namespace: ${namespace}`), false);
      return;
    }

    loader()
      .then((module) => callback(null, module.default))
      .catch((error: unknown) => {
        callback(error instanceof Error ? error : new Error(String(error)), false);
      });
  },
};

i18n
  .use(LanguageDetector)
  .use(lazyTranslationBackend as never)
  .use(initReactI18next)
  .init({
    ns: ["common"],
    defaultNS: "common",
    fallbackNS: "common",
    supportedLngs: SUPPORTED_LANGUAGES,
    fallbackLng: "en",
    load: "languageOnly",
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
    },
    interpolation: {
      escapeValue: false,
    },
    // Missing keys should never show up in the app — fall back to the English
    // string rather than the raw key.
    returnEmptyString: false,
  });

export default i18n;