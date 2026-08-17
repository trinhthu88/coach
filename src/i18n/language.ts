import i18n, { SUPPORTED_LANGUAGES, SupportedLanguage } from "@/i18n/config";
import { supabase } from "@/integrations/supabase/client";

/**
 * Switches the active UI language. i18next-browser-languagedetector's
 * `caches: ["localStorage"]` persists the choice immediately on `changeLanguage`,
 * so a refresh before auth state loads still shows the right language. When a
 * user is signed in, also persist to `profiles.preferred_language` so the
 * preference follows their account across devices — this call is fire-and-forget
 * since a failed write shouldn't block the language switch the user just made.
 */
export async function changeLanguage(lang: SupportedLanguage, userId?: string | null) {
  await i18n.changeLanguage(lang);

  if (userId) {
    supabase
      .from("profiles")
      .update({ preferred_language: lang })
      .eq("id", userId)
      .then(({ error }) => {
        if (error) console.error("Failed to persist preferred_language:", error);
      });
  }
}

/**
 * Called once a profile has loaded (login or refresh). The account's stored
 * preference wins once known, even if localStorage/browser detection picked a
 * different language before auth resolved.
 */
export function syncLanguageFromProfile(preferredLanguage: string | null | undefined) {
  if (!preferredLanguage) return;
  if (preferredLanguage === i18n.language) return;
  if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(preferredLanguage)) return;
  i18n.changeLanguage(preferredLanguage);
}
