import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { format, differenceInCalendarDays } from "date-fns";
import { Building2, Camera, ExternalLink, Loader2, Mail, User as UserIcon } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionCard } from "@/pages/admin/_shared";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { getFriendlyErrorMessage } from "@/lib/errors";

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "vi", label: "Tiếng Việt" },
  { value: "fr", label: "Français" },
  { value: "zh", label: "中文" },
];

interface NotificationPrefs {
  weekly_digest: boolean;
  at_risk_alerts: boolean;
  session_milestones: boolean;
  monthly_auto_report: boolean;
}
const DEFAULT_PREFS: NotificationPrefs = {
  weekly_digest: true,
  at_risk_alerts: true,
  session_milestones: true,
  monthly_auto_report: false,
};

interface OrgDetail {
  id: string;
  name: string;
  logo_url: string | null;
  website: string | null;
  subscription_tier: string | null;
  contract_start: string | null;
  contract_end: string | null;
  coaching_budget: number | null;
  programme_objectives: string[] | null;
  focus_competencies: string[] | null;
  account_manager: { full_name: string; email: string } | null;
}

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).join("").toUpperCase().slice(0, 2);
}

export default function SponsorSettings() {
  const { t } = useTranslation("sponsor");
  const { user, profile, refreshProfile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tab 1 — profile form. full_name/preferred_language live on profiles;
  // title/department/phone live on sponsor_profiles (see AdminOrganizations.tsx
  // for the same split — sponsor_profiles is the sponsor-role-specific table).
  const [form, setForm] = useState({ full_name: "", preferred_language: "en", title: "", department: "", phone: "" });
  const [sponsorRowLoaded, setSponsorRowLoaded] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // Tab 2 — organisation (read-only)
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);
  const [orgError, setOrgError] = useState(false);

  // Tab 3 — notifications
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [savingPrefs, setSavingPrefs] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setForm((f) => ({ ...f, full_name: profile.full_name || "", preferred_language: profile.preferred_language || "en" }));
    const savedPrefs = (profile as unknown as { notification_prefs?: Partial<NotificationPrefs> }).notification_prefs;
    if (savedPrefs) setPrefs({ ...DEFAULT_PREFS, ...savedPrefs });
  }, [profile]);

  useEffect(() => {
    if (!user) return;
    supabase.from("sponsor_profiles").select("title, department, phone").eq("user_id", user.id).maybeSingle().then(({ data }) => {
      setForm((f) => ({ ...f, title: data?.title || "", department: data?.department || "", phone: (data as { phone?: string } | null)?.phone || "" }));
      setSponsorRowLoaded(true);
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    // RLS ("Organizations: sponsor view own") already scopes this to the
    // caller's own org — no id lookup needed first, same pattern as
    // SponsorDashboard.tsx. maybeSingle() since an unlinked sponsor
    // legitimately has zero rows.
    supabase
      .from("organizations")
      .select("id, name, logo_url, website, subscription_tier, contract_start, contract_end, coaching_budget, programme_objectives, focus_competencies, account_manager:account_manager_id(full_name,email)")
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) { setOrgError(true); setOrgLoading(false); return; }
        setOrg(data as unknown as OrgDetail | null);
        setOrgLoading(false);
      });
  }, [user]);

  const handleAvatarPick = async (file: File) => {
    if (!user) return;
    setAvatarUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const { error: updateError } = await supabase.from("profiles").update({ avatar_url: pub.publicUrl }).eq("id", user.id);
      if (updateError) throw updateError;
      await refreshProfile();
      toast.success(t("settings.profile.avatarUpdated"));
    } catch (e) {
      toast.error(getFriendlyErrorMessage(e, t));
    } finally {
      setAvatarUploading(false);
    }
  };

  const saveProfile = async () => {
    if (!user) return;
    if (!form.full_name.trim()) { toast.error(t("settings.profile.nameRequired")); return; }
    setSavingProfile(true);
    try {
      const [{ error: pErr }, { error: sErr }] = await Promise.all([
        supabase.from("profiles").update({ full_name: form.full_name.trim(), preferred_language: form.preferred_language }).eq("id", user.id),
        supabase.from("sponsor_profiles").update({ title: form.title.trim() || null, department: form.department.trim() || null, phone: form.phone.trim() || null }).eq("user_id", user.id),
      ]);
      if (pErr) throw pErr;
      if (sErr) throw sErr;
      await refreshProfile();
      toast.success(t("settings.profile.saved"));
    } catch (e) {
      toast.error(getFriendlyErrorMessage(e, t));
    } finally {
      setSavingProfile(false);
    }
  };

  const saveNotifications = async () => {
    if (!user) return;
    setSavingPrefs(true);
    try {
      const { error } = await supabase.from("profiles").update({ notification_prefs: { ...prefs } }).eq("id", user.id);
      if (error) throw error;
      await refreshProfile();
      toast.success(t("settings.notifications.saved"));
    } catch (e) {
      toast.error(getFriendlyErrorMessage(e, t));
    } finally {
      setSavingPrefs(false);
    }
  };

  if (!profile) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const daysRemaining = org?.contract_end
    ? differenceInCalendarDays(new Date(org.contract_end), new Date())
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settings.title")}
        emphasis={t("settings.titleEmphasis")}
        subtitle={t("settings.subtitle")}
      />

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">{t("settings.tabs.profile")}</TabsTrigger>
          <TabsTrigger value="organisation">{t("settings.tabs.organisation")}</TabsTrigger>
          <TabsTrigger value="notifications">{t("settings.tabs.notifications")}</TabsTrigger>
        </TabsList>

        {/* TAB 1 — My Profile */}
        <TabsContent value="profile">
          <Card className="max-w-xl space-y-5 p-6">
            <div className="flex items-center gap-4">
              <div className="relative">
                <Avatar className="h-16 w-16">
                  <AvatarImage src={profile.avatar_url || undefined} alt="" />
                  <AvatarFallback className="text-base font-semibold text-primary">
                    {profile.full_name ? initials(profile.full_name) : <UserIcon className="h-6 w-6" />}
                  </AvatarFallback>
                </Avatar>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={avatarUploading}
                  className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow"
                  aria-label={t("settings.profile.changeAvatar")}
                >
                  {avatarUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAvatarPick(f); e.target.value = ""; }}
                />
              </div>
              <div>
                <p className="text-sm font-semibold">{profile.full_name}</p>
                <p className="text-[12px] text-muted-foreground">{profile.email}</p>
              </div>
            </div>

            <div><Label>{t("settings.profile.fullNameLabel")}</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><Label>{t("settings.profile.titleLabel")}</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} disabled={!sponsorRowLoaded} /></div>
              <div><Label>{t("settings.profile.departmentLabel")}</Label><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} disabled={!sponsorRowLoaded} /></div>
            </div>
            <div><Label>{t("settings.profile.phoneLabel")}</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} disabled={!sponsorRowLoaded} /></div>
            <div>
              <Label>{t("settings.profile.languageLabel")}</Label>
              <Select value={form.preferred_language} onValueChange={(v) => setForm({ ...form, preferred_language: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={saveProfile} disabled={savingProfile}>
              {savingProfile && <Loader2 className="h-4 w-4 animate-spin" />} {t("settings.profile.save")}
            </Button>
          </Card>
        </TabsContent>

        {/* TAB 2 — Organisation (read-only) */}
        <TabsContent value="organisation">
          {orgLoading ? (
            <div className="max-w-2xl space-y-3">
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-40 w-full rounded-xl" />
            </div>
          ) : orgError ? (
            <Card className="max-w-2xl p-6 text-sm text-destructive">{t("settings.organisation.loadError")}</Card>
          ) : !org ? (
            <Card className="max-w-2xl p-6 text-sm text-muted-foreground">{t("settings.organisation.noOrg")}</Card>
          ) : (
            <div className="max-w-2xl space-y-4">
              <Card className="p-6">
                <div className="flex items-center gap-3">
                  {org.logo_url ? (
                    <img src={org.logo_url} alt="" className="h-12 w-12 shrink-0 rounded-lg border object-contain" />
                  ) : (
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-primary-soft">
                      <Building2 className="h-6 w-6 text-primary" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-lg font-semibold">{org.name}</p>
                    {org.website && (
                      <a href={org.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline">
                        {org.website} <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  {org.subscription_tier && (
                    <Badge variant="secondary" className="shrink-0 capitalize">{t(`settings.organisation.tiers.${org.subscription_tier}`, org.subscription_tier)}</Badge>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("settings.organisation.contractLabel")}</p>
                    <p className="mt-1 text-[13px]">
                      {org.contract_start ? format(new Date(org.contract_start), "MMM d, yyyy") : "—"}
                      {" → "}
                      {org.contract_end ? format(new Date(org.contract_end), "MMM d, yyyy") : "—"}
                    </p>
                    {daysRemaining != null && (
                      <p className={`mt-0.5 text-[11px] font-medium ${daysRemaining < 30 ? "text-destructive" : "text-muted-foreground"}`}>
                        {t("settings.organisation.daysRemaining", { count: Math.max(0, daysRemaining) })}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("settings.organisation.budgetLabel")}</p>
                    <p className="mt-1 text-[13px]">
                      {org.coaching_budget != null
                        ? new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(org.coaching_budget)
                        : "—"}
                    </p>
                  </div>
                </div>

                {(org.programme_objectives?.length || org.focus_competencies?.length) ? (
                  <div className="mt-4 grid grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-2">
                    {!!org.programme_objectives?.length && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("settings.organisation.objectivesLabel")}</p>
                        <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[12.5px]">
                          {org.programme_objectives.map((o) => <li key={o}>{o}</li>)}
                        </ul>
                      </div>
                    )}
                    {!!org.focus_competencies?.length && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("settings.organisation.competenciesLabel")}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {org.focus_competencies.map((c) => <Badge key={c} variant="outline">{c}</Badge>)}
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </Card>

              {org.account_manager && (
                <Card className="p-5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("settings.organisation.accountManagerLabel")}</p>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary">
                      {initials(org.account_manager.full_name)}
                    </div>
                    <div>
                      <p className="text-[13px] font-medium">{org.account_manager.full_name}</p>
                      <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Mail className="h-3 w-3" /> {org.account_manager.email}
                      </p>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        {/* TAB 3 — Notifications */}
        <TabsContent value="notifications">
          <Card className="max-w-xl p-6">
            <SectionCard label={t("settings.notifications.label")}>
              <div className="divide-y">
                <NotificationRow
                  label={t("settings.notifications.weeklyDigest")}
                  checked={prefs.weekly_digest}
                  onChange={(v) => setPrefs({ ...prefs, weekly_digest: v })}
                />
                <NotificationRow
                  label={t("settings.notifications.atRiskAlerts")}
                  checked={prefs.at_risk_alerts}
                  onChange={(v) => setPrefs({ ...prefs, at_risk_alerts: v })}
                />
                <NotificationRow
                  label={t("settings.notifications.sessionMilestones")}
                  checked={prefs.session_milestones}
                  onChange={(v) => setPrefs({ ...prefs, session_milestones: v })}
                />
                <NotificationRow
                  label={t("settings.notifications.monthlyAutoReport")}
                  checked={prefs.monthly_auto_report}
                  onChange={(v) => setPrefs({ ...prefs, monthly_auto_report: v })}
                />
              </div>
            </SectionCard>
            <Button className="mt-4" onClick={saveNotifications} disabled={savingPrefs}>
              {savingPrefs && <Loader2 className="h-4 w-4 animate-spin" />} {t("settings.notifications.save")}
            </Button>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NotificationRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
      <span className="text-[13px]">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
