import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

// Intl.supportedValuesOf isn't in this project's ES2020 lib target, so it's
// typed manually here rather than widening tsconfig's lib for one call site.
function getTimezoneOptions(): string[] {
  try {
    const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf;
    if (supportedValuesOf) return supportedValuesOf("timeZone");
  } catch {
    // Older browser without Intl.supportedValuesOf — fall through to the default below.
  }
  return ["UTC"];
}

const TIMEZONES = getTimezoneOptions();

export default function CoacheeProfileEditor() {
  const { user, profile, refreshProfile } = useAuth();
  const { t } = useTranslation("profile");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [bio, setBio] = useState(profile?.bio || "");
  const [jobTitle, setJobTitle] = useState("");
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [timezone, setTimezone] = useState("");
  const [goals, setGoals] = useState("");
  const [timezoneOpen, setTimezoneOpen] = useState(false);
  const [spokenLanguages, setSpokenLanguages] = useState<string[]>(["vi"]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("coachee_profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      if (data) {
        setJobTitle(data.job_title || "");
        setIndustry(data.industry || "");
        setLocation(data.location || "");
        setPhone(data.phone || "");
        setTimezone(data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
        setGoals(data.goals || "");
      }
      setLoading(false);
    })();
  }, [user]);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || "");
      setBio(profile.bio || "");
      setSpokenLanguages(profile.spoken_languages?.length ? profile.spoken_languages : ["vi"]);
    }
  }, [profile]);

  const toggleLanguage = (lang: "vi" | "en", checked: boolean) => {
    setSpokenLanguages((prev) => {
      const next = checked ? [...new Set([...prev, lang])] : prev.filter((l) => l !== lang);
      return next.length > 0 ? next : prev; // at least one must stay selected
    });
  };

  const handleSave = async () => {
    if (!user) return;
    if (!fullName.trim()) {
      toast.error(t("coacheeEditor.toast.fullNameRequired"));
      return;
    }
    setSaving(true);

    const { error: pErr } = await supabase
      .from("profiles")
      .update({ full_name: fullName, bio, spoken_languages: spokenLanguages })
      .eq("id", user.id);

    const { error: cErr } = await supabase.from("coachee_profiles").upsert({
      id: user.id,
      job_title: jobTitle || null,
      industry: industry || null,
      location: location || null,
      phone: phone || null,
      timezone: timezone || null,
      goals: goals || null,
    });

    setSaving(false);
    if (pErr || cErr) {
      toast.error(getFriendlyErrorMessage(pErr || cErr, t, { fallback: t("coacheeEditor.toast.saveFailedDefault") }));
      return;
    }
    toast.success(t("coacheeEditor.toast.updated"));
    await refreshProfile();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
          className="mb-0"
          eyebrow={t("coacheeEditor.header.eyebrow")}
          title={t("coacheeEditor.header.titleLead")}
          emphasis={t("coacheeEditor.header.titleEmphasis")}
          subtitle={t("coacheeEditor.header.subtitle")}
        />

      <Card className="space-y-5 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("coacheeEditor.fields.fullNameLabel")} required>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label={t("coacheeEditor.fields.emailLabel")}>
            <Input value={profile?.email || ""} disabled />
          </Field>
          <Field label={t("coacheeEditor.fields.jobTitleLabel")}>
            <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder={t("coacheeEditor.fields.jobTitlePlaceholder")} />
          </Field>
          <Field label={t("coacheeEditor.fields.industryLabel")}>
            <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder={t("coacheeEditor.fields.industryPlaceholder")} />
          </Field>
          <Field label={t("coacheeEditor.fields.locationLabel")}>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t("coacheeEditor.fields.locationPlaceholder")} />
          </Field>
          <Field label={t("coacheeEditor.fields.phoneLabel")}>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("coacheeEditor.fields.phonePlaceholder")} />
          </Field>
          <Field label={t("coacheeEditor.fields.timezoneLabel")}>
            <Popover open={timezoneOpen} onOpenChange={setTimezoneOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={timezoneOpen}
                  className="w-full justify-between font-normal"
                >
                  {timezone || t("coacheeEditor.fields.timezoneButtonPlaceholder")}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command>
                  <CommandInput placeholder={t("coacheeEditor.fields.timezoneSearchPlaceholder")} />
                  <CommandList>
                    <CommandEmpty>{t("coacheeEditor.fields.timezoneNoMatch")}</CommandEmpty>
                    <CommandGroup>
                      {TIMEZONES.map((tz) => (
                        <CommandItem
                          key={tz}
                          value={tz}
                          onSelect={(value) => {
                            setTimezone(value);
                            setTimezoneOpen(false);
                          }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", timezone === tz ? "opacity-100" : "opacity-0")} />
                          {tz}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </Field>
        </div>

        <Field label={t("coacheeEditor.fields.spokenLanguagesLabel")} required>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={spokenLanguages.includes("vi")} onCheckedChange={(c) => toggleLanguage("vi", c === true)} />
              {t("coacheeEditor.fields.spokenLanguagesVietnamese")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={spokenLanguages.includes("en")} onCheckedChange={(c) => toggleLanguage("en", c === true)} />
              {t("coacheeEditor.fields.spokenLanguagesEnglish")}
            </label>
          </div>
        </Field>

        <Field label={t("coacheeEditor.fields.aboutYouLabel")}>
          <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} />
        </Field>

        <Field label={t("coacheeEditor.fields.coachingGoalsLabel")}>
          <Textarea
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            rows={3}
            placeholder={t("coacheeEditor.fields.coachingGoalsPlaceholder")}
          />
        </Field>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {t("coacheeEditor.saveChanges")}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
