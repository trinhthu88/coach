import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

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
        setTimezone(data.timezone || "");
        setGoals(data.goals || "");
      }
      setLoading(false);
    })();
  }, [user]);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || "");
      setBio(profile.bio || "");
    }
  }, [profile]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);

    const { error: pErr } = await supabase
      .from("profiles")
      .update({ full_name: fullName, bio })
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
      toast.error((pErr || cErr)?.message || t("coacheeEditor.toast.saveFailedDefault"));
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
          <Field label={t("coacheeEditor.fields.fullNameLabel")}>
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
            <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder={t("coacheeEditor.fields.timezonePlaceholder")} />
          </Field>
        </div>

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
