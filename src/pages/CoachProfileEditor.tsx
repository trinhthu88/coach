import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Loader2, Save } from "lucide-react";

interface CoachForm {
  title: string;
  bio: string;
  hourly_rate: string;
  years_experience: string;
  nationality: string;
  country_based: string;
  specialties: string;
  diplomas_certifications: string;
}

const empty: CoachForm = {
  title: "",
  bio: "",
  hourly_rate: "",
  years_experience: "",
  nationality: "",
  country_based: "",
  specialties: "",
  diplomas_certifications: "",
};

export default function CoachProfileEditor() {
  const { user, profile, refreshProfile } = useAuth();
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
          hourly_rate: data.hourly_rate?.toString() ?? "",
          years_experience: data.years_experience?.toString() ?? "",
          nationality: data.nationality ?? "",
          country_based: data.country_based ?? "",
          specialties: (data.specialties ?? []).join(", "),
          diplomas_certifications: (data.diplomas_certifications ?? []).join(", "),
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
          hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : null,
          years_experience: form.years_experience ? Number(form.years_experience) : null,
          nationality: form.nationality || null,
          country_based: form.country_based || null,
          specialties: form.specialties
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          diplomas_certifications: form.diplomas_certifications
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        })
        .eq("id", user.id);
      if (cErr) throw cErr;

      await refreshProfile();
      toast({ title: "Profile saved", description: "Your coach profile has been updated." });
    } catch (err: any) {
      toast({
        title: "Save failed",
        description: err.message ?? "Please try again.",
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
    status === "active" ? "default" : status === "rejected" ? "destructive" : "secondary";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Coach</p>
          <h1 className="text-3xl font-semibold tracking-tight">My coach profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This is what coachees see when browsing the directory.
          </p>
        </div>
        <Badge variant={statusVariant as any} className="capitalize">
          {status.replace("_", " ")}
        </Badge>
      </div>

      {status === "pending_approval" && (
        <Card className="border-warning/30 bg-warning/5 p-4 text-sm">
          Your profile is awaiting admin approval. Once approved, it will appear in the public coach
          directory.
        </Card>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <Card className="p-6 space-y-5">
          <h2 className="text-lg font-semibold">Basic information</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Full name</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Headline / title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Executive Leadership Coach"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Bio</Label>
            <Textarea
              rows={5}
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              placeholder="Tell coachees about your approach, experience and the outcomes you help create."
            />
          </div>
        </Card>

        <Card className="p-6 space-y-5">
          <h2 className="text-lg font-semibold">Practice details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Hourly rate (USD)</Label>
              <Input
                type="number"
                min={0}
                value={form.hourly_rate}
                onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Years of experience</Label>
              <Input
                type="number"
                min={0}
                value={form.years_experience}
                onChange={(e) => setForm({ ...form, years_experience: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Nationality</Label>
              <Input
                value={form.nationality}
                onChange={(e) => setForm({ ...form, nationality: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Country based in</Label>
              <Input
                value={form.country_based}
                onChange={(e) => setForm({ ...form, country_based: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Specialties (comma separated)</Label>
            <Input
              value={form.specialties}
              onChange={(e) => setForm({ ...form, specialties: e.target.value })}
              placeholder="Leadership, Career transition, Executive presence"
            />
          </div>
          <div className="space-y-2">
            <Label>Diplomas & certifications (comma separated)</Label>
            <Input
              value={form.diplomas_certifications}
              onChange={(e) => setForm({ ...form, diplomas_certifications: e.target.value })}
              placeholder="ICF PCC, Erickson Solution-Focused Coach"
            />
          </div>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving} className="shadow-glow">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save profile
          </Button>
        </div>
      </form>
    </div>
  );
}
