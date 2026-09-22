import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, MailCheck } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  executeAdminInvite,
  isProblemStatus,
  previewAdminInvite,
  type AdminInvitePreviewRow,
  type AdminInviteRole,
  type InviteRowInput,
} from "@/lib/adminInvite";
import { useInviteOptions } from "./useInviteOptions";

interface AddPersonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Roles the admin may pick from here (first is the default unless defaultRole is set). */
  roles: AdminInviteRole[];
  defaultRole?: AdminInviteRole;
  /** Pre-selected organization (e.g. adding a sponsor from an organization card). */
  defaultOrganizationId?: string | null;
  onCreated?: () => void;
}

const NONE = "none";

interface FormState {
  full_name: string;
  email: string;
  role: AdminInviteRole;
  programme_id: string | null;
  cohort_id: string | null;
  organization_id: string | null;
  title: string;
  department: string;
}

/**
 * Admin single add (learner / coach / sponsor). Goes through the one admin
 * provisioning service: validates first (dry run), offers "enrollment only" /
 * "add sponsor access" when the email already has an account, then creates the
 * account and emails a setup link. No password is ever shown.
 */
export function AddPersonDialog({ open, onOpenChange, roles, defaultRole, defaultOrganizationId, onCreated }: AddPersonDialogProps) {
  const { t } = useTranslation("admin");
  const { programmes, cohorts, organizations } = useInviteOptions(open);
  const initial = (): FormState => ({
    full_name: "",
    email: "",
    role: defaultRole ?? roles[0] ?? "coachee",
    programme_id: null,
    cohort_id: null,
    organization_id: defaultOrganizationId ?? null,
    title: "",
    department: "",
  });
  const [form, setForm] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [offer, setOffer] = useState<AdminInvitePreviewRow | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initial());
      setProblem(null);
      setOffer(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultRole, defaultOrganizationId]);

  const isSponsor = form.role === "sponsor";
  const cohortChoices = form.programme_id ? cohorts.filter((c) => c.programme_id === form.programme_id) : cohorts;
  const selectedCohort = cohorts.find((c) => c.id === form.cohort_id) ?? null;

  const update = (patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    setProblem(null);
    setOffer(null);
  };

  const toRow = (acceptExisting: boolean): InviteRowInput => ({
    full_name: form.full_name,
    email: form.email,
    role: form.role,
    programme: isSponsor ? undefined : form.programme_id ?? undefined,
    cohort: isSponsor ? undefined : form.cohort_id ?? undefined,
    organization: form.organization_id ?? undefined,
    title: isSponsor ? form.title : undefined,
    department: isSponsor ? form.department : undefined,
    accept_existing: acceptExisting,
  });

  const execute = async (acceptExisting: boolean) => {
    const { results } = await executeAdminInvite([toRow(acceptExisting)]);
    const result = results[0];
    if (!result || result.status === "failed" || result.status === "skipped") {
      setProblem(result?.message ?? t("addPerson.failed"));
      return;
    }
    if (result.status === "partial") toast.warning(result.message ?? t("addPerson.partial"));
    else if (result.status === "enrolled") toast.success(t("addPerson.enrolledExisting", { email: result.email }));
    else if (result.status === "linked") toast.success(t("addPerson.sponsorLinked", { email: result.email }));
    else toast.success(t("addPerson.created", { email: result.email }));
    onCreated?.();
    onOpenChange(false);
  };

  const submit = async (acceptExisting = false) => {
    if (!form.full_name.trim() || !form.email.trim()) {
      setProblem(t("addPerson.nameEmailRequired"));
      return;
    }
    if (isSponsor && !form.organization_id) {
      setProblem(t("addPerson.organizationRequired"));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      if (acceptExisting) {
        await execute(true);
        return;
      }
      const [preview] = await previewAdminInvite([toRow(false)]);
      if (!preview) throw new Error(t("addPerson.failed"));
      if (isProblemStatus(preview.status)) {
        setProblem(t(`importUsers.status.${preview.status}`, { defaultValue: preview.message ?? preview.status }));
        return;
      }
      if (preview.status === "existing_user") {
        if (preview.offer) setOffer(preview);
        else setProblem(preview.message ?? t("addPerson.nothingToAdd"));
        return;
      }
      await execute(false);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : t("addPerson.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isSponsor ? t("addPerson.titleSponsor") : t("addPerson.title")}</DialogTitle>
          <DialogDescription>{t("addPerson.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>{t("addPerson.fullName")} <span className="text-destructive">*</span></Label>
              <Input value={form.full_name} onChange={(e) => update({ full_name: e.target.value })} />
            </div>
            <div>
              <Label>{t("addPerson.email")} <span className="text-destructive">*</span></Label>
              <Input type="email" value={form.email} onChange={(e) => update({ email: e.target.value })} />
            </div>
          </div>

          {roles.length > 1 && (
            <div>
              <Label>{t("addPerson.role")} <span className="text-destructive">*</span></Label>
              <Select value={form.role} onValueChange={(v) => update({ role: v as AdminInviteRole })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => <SelectItem key={r} value={r}>{t(`addPerson.roles.${r}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {!isSponsor && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>{t("addPerson.programme")}</Label>
                <Select
                  value={form.programme_id ?? NONE}
                  onValueChange={(v) => {
                    const programme_id = v === NONE ? null : v;
                    const keepCohort = !programme_id || selectedCohort?.programme_id === programme_id;
                    update({ programme_id, cohort_id: keepCohort ? form.cohort_id : null });
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("addPerson.none")}</SelectItem>
                    {programmes.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("addPerson.cohort")}</Label>
                <Select
                  value={form.cohort_id ?? NONE}
                  onValueChange={(v) => {
                    const cohort = v === NONE ? null : cohorts.find((c) => c.id === v) ?? null;
                    // The cohort owns the programme.
                    update({ cohort_id: cohort?.id ?? null, programme_id: cohort?.programme_id ?? form.programme_id });
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("addPerson.none")}</SelectItem>
                    {cohortChoices.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div>
            <Label>
              {t("addPerson.organization")}
              {isSponsor && <span className="text-destructive"> *</span>}
            </Label>
            <Select value={form.organization_id ?? NONE} onValueChange={(v) => update({ organization_id: v === NONE ? null : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {!isSponsor && (
                  <SelectItem value={NONE}>{t("addPerson.none")}</SelectItem>
                )}
                {organizations.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {!isSponsor && <p className="mt-1 text-[10px] text-muted-foreground">{t("addPerson.enrollmentHint")}</p>}
          </div>

          {isSponsor && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><Label>{t("addPerson.jobTitle")}</Label><Input value={form.title} onChange={(e) => update({ title: e.target.value })} /></div>
              <div><Label>{t("addPerson.department")}</Label><Input value={form.department} onChange={(e) => update({ department: e.target.value })} /></div>
            </div>
          )}

          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <MailCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t("addPerson.setupEmailHint")}
          </p>

          {offer && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-[12px]">
              <p>
                {offer.offer === "link_sponsor"
                  ? t("addPerson.existingSponsorOffer")
                  : offer.offer === "transition"
                    ? t("addPerson.existingTransitionOffer")
                    : t("addPerson.existingEnrollOffer")}
              </p>
            </div>
          )}
          {problem && <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-[12px] text-destructive">{problem}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("addPerson.cancel")}</Button>
          {offer ? (
            <Button onClick={() => submit(true)} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {offer.offer === "link_sponsor"
                ? t("addPerson.addSponsorAccess")
                : offer.offer === "transition"
                  ? t("addPerson.moveEnrollment")
                  : t("addPerson.addEnrollmentOnly")}
            </Button>
          ) : (
            <Button onClick={() => submit(false)} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("addPerson.submit")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
