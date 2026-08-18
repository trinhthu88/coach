import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import commonEn from "@/locales/en/common.json";
import authEn from "@/locales/en/auth.json";
import dashboardEn from "@/locales/en/dashboard.json";
import sessionsEn from "@/locales/en/sessions.json";
import adminEn from "@/locales/en/admin.json";
import onboardingEn from "@/locales/en/onboarding.json";
import landingEn from "@/locales/en/landing.json";
import journeyEn from "@/locales/en/journey.json";
import coachesEn from "@/locales/en/coaches.json";
import profileEn from "@/locales/en/profile.json";
import sponsorEn from "@/locales/en/sponsor.json";
import toolsEn from "@/locales/en/tools.json";
import mentoringEn from "@/locales/en/mentoring.json";

import commonVi from "@/locales/vi/common.json";
import authVi from "@/locales/vi/auth.json";
import dashboardVi from "@/locales/vi/dashboard.json";
import sessionsVi from "@/locales/vi/sessions.json";
import adminVi from "@/locales/vi/admin.json";
import onboardingVi from "@/locales/vi/onboarding.json";
import landingVi from "@/locales/vi/landing.json";
import journeyVi from "@/locales/vi/journey.json";
import coachesVi from "@/locales/vi/coaches.json";
import profileVi from "@/locales/vi/profile.json";
import sponsorVi from "@/locales/vi/sponsor.json";
import toolsVi from "@/locales/vi/tools.json";
import mentoringVi from "@/locales/vi/mentoring.json";

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
] as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: commonEn,
        auth: authEn,
        dashboard: dashboardEn,
        sessions: sessionsEn,
        admin: adminEn,
        onboarding: onboardingEn,
        landing: landingEn,
        journey: journeyEn,
        coaches: coachesEn,
        profile: profileEn,
        sponsor: sponsorEn,
        tools: toolsEn,
        mentoring: mentoringEn,
      },
      vi: {
        common: commonVi,
        auth: authVi,
        dashboard: dashboardVi,
        sessions: sessionsVi,
        admin: adminVi,
        onboarding: onboardingVi,
        landing: landingVi,
        journey: journeyVi,
        coaches: coachesVi,
        profile: profileVi,
        sponsor: sponsorVi,
        tools: toolsVi,
        mentoring: mentoringVi,
      },
    },
    ns: NAMESPACES,
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
