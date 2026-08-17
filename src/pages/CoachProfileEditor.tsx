import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Loader2, Save, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { getFriendlyErrorMessage } from "@/lib/errors";

interface CoachForm {
  title: string;
  bio: string;
  years_experience: string;
  nationality: string;
  country_based: string;
  specialties: string[];
  diplomas_certifications: string[];
  calendly_url: string;
}

const empty: CoachForm = {
  title: "",
  bio: "",
  years_experience: "",
  nationality: "",
  country_based: "",
  specialties: [],
  diplomas_certifications: [],
  calendly_url: "",
};

/**
 * Enter-to-add tag editor, previewing tags with the same pill style
 * `CoachDetail.tsx` / `CoachFindCoach.tsx` use to display them to coachees —
 * what a coach edits here is what they'll actually see rendered elsewhere.
 */
function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const value = draft.trim();
    if (value && !values.includes(value)) onChange([...values, value]);
    setDraft("");
  };

  return (
    <div className="space-y-2">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft py-1.5 pl-4 pr-2 text-2xs font-bold uppercase tracking-[0.16em] text-primary"
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="rounded-full p-0.5 hover:bg-primary/15"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        placeholder={placeholder}
      />
    </div>
  );
}

export default function CoachProfileEditor() {
  const { user, profile, refreshProfile } = useAuth();
  const { t } = useTranslation("profile");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string>("pending_approval");
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [form, setForm] = useState<CoachForm>(empty);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("coach_profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

      if (data) {
        setStatus(data.approval_status);
        setForm({
          title: data.title ?? "",
          bio: profile?.bio ?? "",
          years_experience: data.years_experience?.toString() ?? "",
          nationality: data.nationality ?? "",
          country_based: data.country_based ?? "",
          specialties: data.specialties ?? [],
          diplomas_certifications: data.diplomas_certifications ?? [],
          calendly_url: data.calendly_url ?? "",
        });
      }
      setLoading(false);
    })();
  }, [user, profile?.bio]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      const { error: pErr } = await supabase
        .from("profiles")
        .update({ full_name: fullName, bio: form.bio })
        .eq("id", user.id);
      if (pErr) throw pErr;

      const { error: cErr } = await supabase
        .from("coach_profiles")
        .update({
          title: form.title || null,
          years_experience: form.years_experience ? Number(form.years_experience) : null,
          nationality: form.nationality || null,
          country_based: form.country_based || null,
          specialties: form.specialties,
          diplomas_certifications: form.diplomas_certifications,
          calendly_url: form.calendly_url || null,
        })
        .eq("id", user.id);
      if (cErr) throw cErr;

      await refreshProfile();
      toast({ title: t("coachEditor.toast.savedTitle"), description: t("coachEditor.toast.savedDescription") });
    } catch (err) {
      toast({
        title: t("coachEditor.toast.failedTitle"),
        description: getFriendlyErrorMessage(err, t, { fallback: t("coachEditor.toast.failedDefaultDescription") }),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const statusVariant =
    status === "active" ? "default" : status === "rejected" ? "destructive" : "secondary" as const;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("coachEditor.header.eyebrow")}
        title={t("coachEditor.header.titleLead")}
        emphasis={t("coachEditor.header.titleEmphasis")}
        subtitle={t("coachEditor.header.subtitle")}
        actions={
          <Badge variant={statusVariant}>
            {t(`coachEditor.statusLabel.${status}`, { defaultValue: status.replace("_", " ") })}
          </Badge>
        }
      />

      {status === "pending_approval" && (
        <Card className="border-warning/30 bg-warning/5 p-4 text-sm">
          {t("coachEditor.pendingNotice")}
        </Card>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <Card className="p-6 space-y-5">
          <h2 className="text-lg font-semibold">{t("coachEditor.basicInfo.heading")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("coachEditor.basicInfo.fullNameLabel")}</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>{t("coachEditor.basicInfo.titleLabel")}</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder={t("coachEditor.basicInfo.titlePlaceholder")}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("coachEditor.basicInfo.bioLabel")}</Label>
            <Textarea
              rows={5}
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              placeholder={t("coachEditor.basicInfo.bioPlaceholder")}
            />
          </div>
        </Card>

        <Card className="p-6 space-y-5">
          <h2 className="text-lg font-semibold">{t("coachEditor.practiceDetails.heading")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("coachEditor.practiceDetails.yearsExperienceLabel")}</Label>
              <Input
                type="number"
                min={0}
                value={form.years_experience}
                onChange={(e) => setForm({ ...form, years_experience: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("coachEditor.practiceDetails.nationalityLabel")}</Label>
              <Input
                value={form.nationality}
                onChange={(e) => setForm({ ...form, nationality: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("coachEditor.practiceDetails.countryBasedLabel")}</Label>
              <Input
                value={form.country_based}
                onChange={(e) => setForm({ ...form, country_based: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("coachEditor.practiceDetails.calendlyLabel")}</Label>
              <Input
                type="url"
                value={form.calendly_url}
                onChange={(e) => setForm({ ...form, calendly_url: e.target.value })}
                placeholder={t("coachEditor.practiceDetails.calendlyPlaceholder")}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("coachEditor.practiceDetails.specialtiesLabel")}</Label>
            <TagInput
              values={form.specialties}
              onChange={(specialties) => setForm({ ...form, specialties })}
              placeholder={t("coachEditor.practiceDetails.specialtiesPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("coachEditor.practiceDetails.diplomasLabel")}</Label>
            <TagInput
              values={form.diplomas_certifications}
              onChange={(diplomas_certifications) => setForm({ ...form, diplomas_certifications })}
              placeholder={t("coachEditor.practiceDetails.diplomasPlaceholder")}
            />
          </div>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving} className="shadow-glow">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t("coachEditor.saveProfile")}
          </Button>
        </div>
      </form>
    </div>
  );
}
