import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import CoacheeProfileEditor from "@/pages/CoacheeProfileEditor";
import CoacheeAvailability from "@/pages/CoacheeAvailability";

/**
 * Approved prototype's combined "Profile & Availability" account workspace
 * — smallest clean implementation per the brief: Profile is the workspace,
 * Availability is a tab/subview, each rendering the existing, unchanged
 * page component (`embedded` just suppresses its own duplicate PageHeader).
 * No new persistence: a "Preferences" tab is deliberately not added here —
 * the only preference-shaped field that actually exists (spoken languages)
 * already lives in the Profile tab, and the prototype's other Preferences
 * controls (session format, free-text "development context") have no
 * backing schema. Inventing one just to fill a tab is explicitly against
 * the brief.
 */
export default function CoacheeAccount() {
  const { t } = useTranslation("profile");
  // Seeded once from ?tab= (the redirect target from the old standalone
  // /coachee/availability route) — in-page tab switches after that are
  // local state, not round-tripped through the URL on every click.
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<"profile" | "availability">(
    searchParams.get("tab") === "availability" ? "availability" : "profile"
  );

  return (
    <div className="space-y-6">
      <PageHeader
        className="mb-0"
        eyebrow={t("account.eyebrow")}
        title={t("account.titleLead")}
        emphasis={t("account.titleEmphasis")}
        subtitle={t("account.subtitle")}
      />

      <Tabs value={tab} onValueChange={(next) => setTab(next === "availability" ? "availability" : "profile")}>
        <TabsList>
          <TabsTrigger value="profile">{t("account.tabs.profile")}</TabsTrigger>
          <TabsTrigger value="availability">{t("account.tabs.availability")}</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="mt-4">
          <CoacheeProfileEditor embedded />
        </TabsContent>
        <TabsContent value="availability" className="mt-4">
          <CoacheeAvailability embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
