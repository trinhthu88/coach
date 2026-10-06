import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Option = { id: string; name: string };
const NONE = "none";

/**
 * Admin -> Cohorts -> "New coaching engagement" (decision 4, 20261006170000).
 * admin_create_coaching_engagement() creates the 1:1 cohort, assigns the coach
 * as its only Coach, spreads the Coaching requirement dates from start to end
 * and enrolls the learner, in one transaction. Nothing is derived here.
 */
export function NewCoachingEngagementDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation("admin");
  const [learners, setLearners] = useState<Option[]>([]);
  const [coaches, setCoaches] = useState<Option[]>([]);
  const [programmes, setProgrammes] = useState<Option[]>([]);
  const [orgs, setOrgs] = useState<Option[]>([]);
  const [learnerId, setLearnerId] = useState("");
  const [coachId, setCoachId] = useState("");
  const [programmeId, setProgrammeId] = useState("");
  const [orgId, setOrgId] = useState(NONE);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const [roles, profiles, coachProfiles, modules, progs, organisations] = await Promise.all([
        supabase.from("user_roles").select("user_id, role").in("role", ["coachee", "coach"]),
        supabase.from("profiles").select("id, full_name, email, status").eq("status", "active"),
        supabase.from("coach_profiles").select("id, approval_status").eq("approval_status", "active"),
        supabase.from("programme_modules").select("programme_id, module").eq("enabled", true),
        supabase.from("programmes").select("id, name").eq("is_active", true).order("name"),
        supabase.from("organizations").select("id, name").order("name"),
      ]);
      const nameOf = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name || p.email || p.id]));
      const learnerIds = new Set((roles.data ?? []).filter((r) => r.role === "coachee").map((r) => r.user_id));
      const approved = new Set((coachProfiles.data ?? []).map((c) => c.id));
      const byName = (a: Option, b: Option) => a.name.localeCompare(b.name);
      setLearners([...learnerIds].filter((id) => nameOf.has(id)).map((id) => ({ id, name: nameOf.get(id)! })).sort(byName));
      setCoaches([...approved].filter((id) => nameOf.has(id)).map((id) => ({ id, name: nameOf.get(id)! })).sort(byName));
      // Only programmes whose one enabled module is Coaching can run as an engagement
      // (the server refuses anything else).
      const modulesByProgramme = new Map<string, string[]>();
      for (const m of modules.data ?? []) modulesByProgramme.set(m.programme_id, [...(modulesByProgramme.get(m.programme_id) ?? []), m.module]);
      setProgrammes((progs.data ?? []).filter((p) => {
        const mods = modulesByProgramme.get(p.id) ?? [];
        return mods.length === 1 && mods[0] === "coaching";
      }));
      setOrgs(organisations.data ?? []);
    })();
  }, [open]);

  const reset = () => {
    setLearnerId("");
    setCoachId("");
    setProgrammeId("");
    setOrgId(NONE);
    setStart("");
    setEnd("");
  };

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const canSave = !!learnerId && !!coachId && !!programmeId && !!start && !!end;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const { error } = await supabase.rpc("admin_create_coaching_engagement", {
      p_learner_id: learnerId,
      p_coach_id: coachId,
      p_programme_id: programmeId,
      p_start: start,
      p_end: end,
      p_organization_id: orgId === NONE ? undefined : orgId,
    });
    setSaving(false);
    if (error) {
      toast.error(getFriendlyErrorMessage(error, t));
      return;
    }
    toast.success(t("cohorts.engagement.created"));
    close(false);
    onCreated();
  };

  const picker = (label: string, value: string, onChange: (v: string) => void, options: Option[], testId: string, placeholder?: string) => (
    <div>
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger data-testid={testId}>
          <SelectValue placeholder={placeholder ?? t("cohorts.engagement.choose")} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("cohorts.engagement.title")}</DialogTitle>
          <DialogDescription>{t("cohorts.engagement.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {picker(t("cohorts.engagement.learner"), learnerId, setLearnerId, learners, "engagement-learner")}
          {picker(t("cohorts.engagement.coach"), coachId, setCoachId, coaches, "engagement-coach")}
          {picker(t("cohorts.engagement.programme"), programmeId, setProgrammeId, programmes, "engagement-programme")}
          {programmes.length === 0 && <p className="text-[11px] text-muted-foreground">{t("cohorts.engagement.noProgramme")}</p>}
          <div>
            <Label>{t("cohorts.engagement.organisation")}</Label>
            <Select value={orgId} onValueChange={setOrgId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("cohorts.engagement.noOrganisation")}</SelectItem>
                {orgs.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="engagement-start">{t("cohorts.engagement.start")}</Label>
              <Input id="engagement-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="engagement-end">{t("cohorts.engagement.end")}</Label>
              <Input id="engagement-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("cohorts.engagement.datesHint")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>{t("cohorts.cancel")}</Button>
          <Button onClick={save} disabled={!canSave || saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("cohorts.engagement.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
