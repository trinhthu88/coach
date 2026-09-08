import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, Building2, UsersRound, RotateCcw, Copy, ChevronDown, X } from "lucide-react";
import { AdminPageHeader, Pill } from "./_shared";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import { getFriendlyErrorMessage } from "@/lib/errors";

type CompanySize = "1-50" | "50-200" | "200-1000" | "1000+";
type SubscriptionTier = "essentials" | "growth" | "enterprise";
type Contact = { name: string; email: string };

interface Organization {
  id: string;
  name: string;
  industry: string | null;
  logo_url: string | null;
  website: string | null;
  company_size: CompanySize | null;
  hq_country: string | null;
  timezone: string | null;
  contract_start: string | null;
  contract_end: string | null;
  coaching_budget: number | null;
  subscription_tier: SubscriptionTier | null;
  billing_contact: Contact | null;
  secondary_contact: Contact | null;
  account_manager_id: string | null;
  programme_objectives: string[] | null;
  focus_competencies: string[] | null;
  admin_notes: string | null;
}

interface Sponsor {
  user_id: string;
  organization_id: string;
  title: string | null;
  department: string | null;
  full_name: string;
  email: string;
}

const COMPANY_SIZES: CompanySize[] = ["1-50", "50-200", "200-1000", "1000+"];
const SUBSCRIPTION_TIERS: SubscriptionTier[] = ["essentials", "growth", "enterprise"];

export default function AdminOrganizations() {
  const { t } = useTranslation("admin");
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [sponsorsByOrg, setSponsorsByOrg] = useState<Record<string, Sponsor>>({});
  const [enrollmentCounts, setEnrollmentCounts] = useState<Record<string, number>>({});
  const [adminOpts, setAdminOpts] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Organization> | null>(null);
  const [saving, setSaving] = useState(false);
  const [inviting, setInviting] = useState<Organization | null>(null);
  const [inviteForm, setInviteForm] = useState({ email: "", full_name: "", title: "", department: "" });
  const [inviteBusy, setInviteBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState<string | null>(null);
  const [credential, setCredential] = useState<{ email: string; password: string; full_name: string } | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();

  const load = async () => {
    setLoading(true);
    const [{ data: o }, { data: sp }, { data: enr }, { data: adminRoles }] = await Promise.all([
      supabase.from("organizations").select("*").order("name"),
      supabase.from("sponsor_profiles").select("user_id, organization_id, title, department, profiles(full_name, email)"),
      supabase.from("programme_enrollments").select("organization_id").not("organization_id", "is", null),
      supabase.from("user_roles").select("user_id").eq("role", "admin"),
    ]);
    // user_roles has no FK to profiles (see useMyCoachCardData.ts for the
    // same pattern) — resolve admin ids, then their profiles, as two steps.
    const adminIds = (adminRoles || []).map((r) => r.user_id);
    let admins: { id: string; name: string }[] = [];
    if (adminIds.length) {
      const { data: adminProfiles } = await supabase.from("profiles").select("id, full_name").in("id", adminIds);
      admins = (adminProfiles || []).map((p) => ({ id: p.id, name: p.full_name }));
    }
    const byOrg: Record<string, Sponsor> = {};
    (sp || []).forEach((row) => {
      const profile = row.profiles as unknown as { full_name: string; email: string } | null;
      if (!profile) return;
      byOrg[row.organization_id] = {
        user_id: row.user_id,
        organization_id: row.organization_id,
        title: row.title,
        department: row.department,
        full_name: profile.full_name,
        email: profile.email,
      };
    });
    const counts: Record<string, number> = {};
    (enr || []).forEach((e) => {
      if (e.organization_id) counts[e.organization_id] = (counts[e.organization_id] || 0) + 1;
    });
    setOrgs((o || []) as Organization[]);
    setSponsorsByOrg(byOrg);
    setEnrollmentCounts(counts);
    setAdminOpts(admins);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const saveOrg = async () => {
    if (!editing?.name?.trim()) { toast.error(t("organizations.nameRequired")); return; }
    setSaving(true);
    try {
      const payload: Omit<Organization, "id"> = {
        name: editing.name,
        industry: editing.industry || null,
        logo_url: editing.logo_url || null,
        website: editing.website || null,
        company_size: editing.company_size || null,
        hq_country: editing.hq_country || null,
        timezone: editing.timezone || null,
        contract_start: editing.contract_start || null,
        contract_end: editing.contract_end || null,
        coaching_budget: editing.coaching_budget ?? null,
        subscription_tier: editing.subscription_tier || null,
        billing_contact: editing.billing_contact?.name || editing.billing_contact?.email ? editing.billing_contact : null,
        secondary_contact: editing.secondary_contact?.name || editing.secondary_contact?.email ? editing.secondary_contact : null,
        account_manager_id: editing.account_manager_id || null,
        programme_objectives: editing.programme_objectives?.length ? editing.programme_objectives : null,
        focus_competencies: editing.focus_competencies?.length ? editing.focus_competencies : null,
        admin_notes: editing.admin_notes || null,
      };
      if (editing.id) {
        const { error } = await supabase.from("organizations").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("organizations").insert(payload);
        if (error) throw error;
      }
      toast.success(t("organizations.orgSaved"));
      setEditing(null);
      load();
    } catch (e) { toast.error(getFriendlyErrorMessage(e, t)); }
    finally { setSaving(false); }
  };

  const removeOrg = async (id: string) => {
    const ok = await confirm({
      title: t("organizations.delete"),
      description: t("organizations.deleteConfirm"),
      confirmLabel: t("organizations.delete"),
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("organizations").delete().eq("id", id);
    if (error) toast.error(getFriendlyErrorMessage(error, t)); else { toast.success(t("organizations.deleted")); load(); }
  };

  const openInvite = (org: Organization) => {
    setInviting(org);
    setInviteForm({ email: "", full_name: "", title: "", department: "" });
  };

  const submitInvite = async () => {
    if (!inviting) return;
    if (!inviteForm.email.trim() || !inviteForm.full_name.trim()) {
      toast.error(t("organizations.emailNameRequired"));
      return;
    }
    setInviteBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("invite-sponsor", {
        body: {
          organization_id: inviting.id,
          email: inviteForm.email.trim(),
          full_name: inviteForm.full_name.trim(),
          title: inviteForm.title.trim() || undefined,
          department: inviteForm.department.trim() || undefined,
        },
      });
      if (error) throw error;
      const result = data as { error?: string; temp_password?: string; email?: string; full_name?: string };
      if (result?.error) throw new Error(result.error);
      setCredential({ email: result.email!, password: result.temp_password!, full_name: result.full_name! });
      toast.success(t("organizations.sponsorAccountCreated"));
      setInviting(null);
      await load();
    } catch (e) {
      toast.error(getFriendlyErrorMessage(e, t, { fallback: t("organizations.couldNotInviteSponsor") }));
    } finally {
      setInviteBusy(false);
    }
  };

  const resetSponsorPassword = async (org: Organization) => {
    setResetBusy(org.id);
    try {
      const { data, error } = await supabase.functions.invoke("invite-sponsor", {
        body: { organization_id: org.id, force_reset_password: true },
      });
      if (error) throw error;
      const result = data as { error?: string; temp_password?: string; email?: string; full_name?: string };
      if (result?.error) throw new Error(result.error);
      setCredential({ email: result.email!, password: result.temp_password!, full_name: result.full_name! });
      toast.success(t("organizations.tempPasswordReset"));
    } catch (e) {
      toast.error(getFriendlyErrorMessage(e, t, { fallback: t("organizations.couldNotResetPassword") }));
    } finally {
      setResetBusy(null);
    }
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div>
      <AdminPageHeader
        title={t("organizations.title")}
        emphasize={t("organizations.titleEmphasis")}
        subtitle={t("organizations.subtitle")}
        right={<Button onClick={() => setEditing({ name: "" })}><Plus className="h-4 w-4" /> {t("organizations.newOrganization")}</Button>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {orgs.map((o) => {
          const sponsor = sponsorsByOrg[o.id];
          return (
            <Card key={o.id} className="p-4">
              <div className="mb-2 flex items-start justify-between">
                <div className="flex min-w-0 items-center gap-2">
                  {o.logo_url ? (
                    <img src={o.logo_url} alt="" className="h-4 w-4 shrink-0 rounded-sm object-contain" />
                  ) : (
                    <Building2 className="h-4 w-4 shrink-0 text-primary" />
                  )}
                  <h3 className="truncate text-base font-semibold">{o.name}</h3>
                </div>
                {o.industry && <Pill tone="secondary" className="shrink-0">{o.industry}</Pill>}
              </div>

              <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <UsersRound className="h-3 w-3" /> {t("organizations.enrolledLeaders", { count: enrollmentCounts[o.id] || 0 })}
              </p>

              <div className="mt-3 rounded-lg border bg-muted/20 p-2.5">
                {sponsor ? (
                  <>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("organizations.sponsor")}</p>
                    <p className="mt-1 truncate text-[12px] font-medium">{sponsor.full_name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{sponsor.email}</p>
                    {sponsor.title && <p className="text-[11px] text-muted-foreground">{sponsor.title}{sponsor.department ? ` · ${sponsor.department}` : ""}</p>}
                    <Button
                      variant="outline" size="sm" className="mt-2 w-full"
                      onClick={() => resetSponsorPassword(o)}
                      disabled={resetBusy === o.id}
                    >
                      {resetBusy === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                      {t("organizations.resetPassword")}
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] text-muted-foreground">{t("organizations.noSponsorYet")}</p>
                    <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => openInvite(o)}>
                      <Plus className="h-3.5 w-3.5" /> {t("organizations.inviteSponsor")}
                    </Button>
                  </>
                )}
              </div>

              <div className="mt-3 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(o)}><Pencil className="h-3.5 w-3.5" /> {t("organizations.edit")}</Button>
                <Button variant="ghost" size="sm" onClick={() => removeOrg(o.id)}><Trash2 className="h-3.5 w-3.5" /> {t("organizations.delete")}</Button>
              </div>
            </Card>
          );
        })}
        {orgs.length === 0 && (
          <Card className="col-span-full p-12 text-center text-sm text-muted-foreground">
            {t("organizations.empty")}
          </Card>
        )}
      </div>

      {/* Create/edit organization */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? t("organizations.dialogTitleEdit") : t("organizations.dialogTitleNew")}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div><Label>{t("organizations.nameLabel")}</Label><Input value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div><Label>{t("organizations.industryLabel")}</Label><Input value={editing.industry || ""} onChange={(e) => setEditing({ ...editing, industry: e.target.value })} /></div>

              <EditSection title={t("organizations.sections.identity")} defaultOpen>
                <div>
                  <Label>{t("organizations.logoUrlLabel")}</Label>
                  <div className="flex items-center gap-2">
                    {editing.logo_url && (
                      <img src={editing.logo_url} alt="" className="h-8 w-8 shrink-0 rounded border object-contain" />
                    )}
                    <Input className="flex-1" value={editing.logo_url || ""} onChange={(e) => setEditing({ ...editing, logo_url: e.target.value })} />
                  </div>
                </div>
                <div><Label>{t("organizations.websiteLabel")}</Label><Input value={editing.website || ""} onChange={(e) => setEditing({ ...editing, website: e.target.value })} /></div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label>{t("organizations.companySizeLabel")}</Label>
                    <Select value={editing.company_size || "none"} onValueChange={(v) => setEditing({ ...editing, company_size: v === "none" ? null : (v as CompanySize) })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("organizations.noneOption")}</SelectItem>
                        {COMPANY_SIZES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>{t("organizations.hqCountryLabel")}</Label><Input value={editing.hq_country || ""} onChange={(e) => setEditing({ ...editing, hq_country: e.target.value })} /></div>
                </div>
                <div><Label>{t("organizations.timezoneLabel")}</Label><Input placeholder="Asia/Ho_Chi_Minh" value={editing.timezone || ""} onChange={(e) => setEditing({ ...editing, timezone: e.target.value })} /></div>
              </EditSection>

              <EditSection title={t("organizations.sections.contract")}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div><Label>{t("organizations.contractStartLabel")}</Label><Input type="date" value={editing.contract_start || ""} onChange={(e) => setEditing({ ...editing, contract_start: e.target.value })} /></div>
                  <div><Label>{t("organizations.contractEndLabel")}</Label><Input type="date" value={editing.contract_end || ""} onChange={(e) => setEditing({ ...editing, contract_end: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label>{t("organizations.coachingBudgetLabel")}</Label>
                    <Input
                      type="number" min={0} step="0.01"
                      value={editing.coaching_budget ?? ""}
                      onChange={(e) => setEditing({ ...editing, coaching_budget: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label>{t("organizations.subscriptionTierLabel")}</Label>
                    <Select value={editing.subscription_tier || "none"} onValueChange={(v) => setEditing({ ...editing, subscription_tier: v === "none" ? null : (v as SubscriptionTier) })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("organizations.noneOption")}</SelectItem>
                        {SUBSCRIPTION_TIERS.map((s) => <SelectItem key={s} value={s}>{t(`organizations.tiers.${s}`)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>{t("organizations.accountManagerLabel")}</Label>
                  <Select value={editing.account_manager_id || "none"} onValueChange={(v) => setEditing({ ...editing, account_manager_id: v === "none" ? null : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("organizations.noneOption")}</SelectItem>
                      {adminOpts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </EditSection>

              <EditSection title={t("organizations.sections.contacts")}>
                <div>
                  <Label>{t("organizations.billingContactLabel")}</Label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Input
                      placeholder={t("organizations.contactNamePlaceholder")}
                      value={editing.billing_contact?.name || ""}
                      onChange={(e) => setEditing({ ...editing, billing_contact: { name: e.target.value, email: editing.billing_contact?.email || "" } })}
                    />
                    <Input
                      type="email"
                      placeholder={t("organizations.contactEmailPlaceholder")}
                      value={editing.billing_contact?.email || ""}
                      onChange={(e) => setEditing({ ...editing, billing_contact: { name: editing.billing_contact?.name || "", email: e.target.value } })}
                    />
                  </div>
                </div>
                <div>
                  <Label>{t("organizations.secondaryContactLabel")}</Label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Input
                      placeholder={t("organizations.contactNamePlaceholder")}
                      value={editing.secondary_contact?.name || ""}
                      onChange={(e) => setEditing({ ...editing, secondary_contact: { name: e.target.value, email: editing.secondary_contact?.email || "" } })}
                    />
                    <Input
                      type="email"
                      placeholder={t("organizations.contactEmailPlaceholder")}
                      value={editing.secondary_contact?.email || ""}
                      onChange={(e) => setEditing({ ...editing, secondary_contact: { name: editing.secondary_contact?.name || "", email: e.target.value } })}
                    />
                  </div>
                </div>
              </EditSection>

              <EditSection title={t("organizations.sections.programme")}>
                <div>
                  <Label>{t("organizations.programmeObjectivesLabel")}</Label>
                  <TagInput
                    value={editing.programme_objectives || []}
                    onChange={(v) => setEditing({ ...editing, programme_objectives: v })}
                    placeholder={t("organizations.tagInputPlaceholder")}
                  />
                </div>
                <div>
                  <Label>{t("organizations.focusCompetenciesLabel")}</Label>
                  <TagInput
                    value={editing.focus_competencies || []}
                    onChange={(v) => setEditing({ ...editing, focus_competencies: v })}
                    placeholder={t("organizations.tagInputPlaceholder")}
                  />
                </div>
                <div><Label>{t("organizations.adminNotesLabel")}</Label><Textarea rows={3} value={editing.admin_notes || ""} onChange={(e) => setEditing({ ...editing, admin_notes: e.target.value })} /></div>
              </EditSection>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>{t("organizations.cancel")}</Button>
            <Button onClick={saveOrg} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}{t("organizations.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite sponsor */}
      <Dialog open={!!inviting} onOpenChange={(o) => !o && setInviting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("organizations.inviteSponsorFor", { name: inviting?.name })}</DialogTitle>
            <DialogDescription>{t("organizations.inviteSponsorHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>{t("organizations.fullNameLabel")}</Label><Input value={inviteForm.full_name} onChange={(e) => setInviteForm({ ...inviteForm, full_name: e.target.value })} /></div>
            <div><Label>{t("organizations.emailLabel")}</Label><Input type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} /></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><Label>{t("organizations.titleLabelOptional")}</Label><Input value={inviteForm.title} onChange={(e) => setInviteForm({ ...inviteForm, title: e.target.value })} /></div>
              <div><Label>{t("organizations.departmentLabelOptional")}</Label><Input value={inviteForm.department} onChange={(e) => setInviteForm({ ...inviteForm, department: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviting(null)}>{t("organizations.cancel")}</Button>
            <Button onClick={submitInvite} disabled={inviteBusy}>{inviteBusy && <Loader2 className="h-4 w-4 animate-spin" />}{t("organizations.createSponsorAccount")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One-time credential display */}
      <Dialog open={!!credential} onOpenChange={(o) => !o && setCredential(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("organizations.accountReadyFor", { name: credential?.full_name })}</DialogTitle>
            <DialogDescription>{t("organizations.shareCredentialsHint")}</DialogDescription>
          </DialogHeader>
          {credential && (
            <div className="space-y-3 text-sm">
              <CopyRow label={t("organizations.email")} value={credential.email} />
              <CopyRow label={t("organizations.tempPassword")} value={credential.password} mono />
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCredential(null)}>{t("organizations.done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {ConfirmDialog}
    </div>
  );
}

function EditSection({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
      <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-bold uppercase tracking-widest text-muted-foreground hover:bg-muted/30">
        {title}
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-3 pb-3 pt-1">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft("");
  };
  return (
    <div>
      {value.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 pr-1.5">
              {tag}
              <button type="button" onClick={() => onChange(value.filter((tg) => tg !== tag))} className="opacity-60 hover:opacity-100">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); add(); }
        }}
        onBlur={add}
      />
    </div>
  );
}

function CopyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const { t } = useTranslation("admin");
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <code className={mono ? "flex-1 font-mono text-[13px]" : "flex-1 text-[13px]"}>{value}</code>
        <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(value); toast.success(t("organizations.copied")); }}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
