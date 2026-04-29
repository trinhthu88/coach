import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, User } from "lucide-react";

export default function CoacheeProfileEditor() {
  const { user, profile, refreshProfile } = useAuth();
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
      toast.error((pErr || cErr)?.message || "Failed to save");
      return;
    }
    toast.success("Profile updated");
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
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <User className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My profile</h1>
          <p className="text-sm text-muted-foreground">
            Coaches you book with see this information.
          </p>
        </div>
      </div>

      <Card className="space-y-5 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Email">
            <Input value={profile?.email || ""} disabled />
          </Field>
          <Field label="Job title">
            <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Engineering Manager" />
          </Field>
          <Field label="Industry">
            <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Software" />
          </Field>
          <Field label="Location">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City, Country" />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Timezone">
            <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="e.g. Asia/Ho_Chi_Minh" />
          </Field>
        </div>

        <Field label="About you">
          <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} />
        </Field>

        <Field label="Coaching goals">
          <Textarea
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            rows={3}
            placeholder="What do you want to achieve?"
          />
        </Field>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Save changes
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
