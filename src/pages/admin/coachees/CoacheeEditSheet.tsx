import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { useAdminCoacheeMutations } from "@/hooks/admin/useAdminCoacheeMutations";
import type { ProgrammeOpt, NamedOpt, CohortOpt } from "@/hooks/admin/useAdminCoacheesData";
import { STATUS_KEYS, type Row, type Status } from "./coacheeDisplay";

interface CoacheeEditSheetProps {
  row: Row | null;
  original: Row | undefined;
  onClose: () => void;
  onSaved: () => void;
  programmes: ProgrammeOpt[];
  cohorts: CohortOpt[];
  organizations: NamedOpt[];
  /** No longer used: programme Coaching is assigned per cohort, not per
   *  learner. Kept so existing call sites stay valid. */
  coachOpts?: NamedOpt[];
}

export function CoacheeEditSheet({
  row,
  original,
  onClose,
  onSaved,
  programmes,
  cohorts,
  organizations,
}: CoacheeEditSheetProps) {
  const { t } = useTranslation("admin");
  const { saving, saveEdit, resendingLink, resendLoginLink, resentLink, setResentLink } = useAdminCoacheeMutations(onSaved);
  const [editing, setEditing] = useState<Row | null>(row);
  // The cohort owns the programme: offer only the selected programme's cohorts.
  const cohortChoices = editing?.programme_id
    ? cohorts.filter((c) => c.programme_id === editing.programme_id)
    : cohorts;
  const enrollmentWillMove =
    !!original?.enrollment_id && !!editing?.cohort_id &&
    (editing.cohort_id !== original.cohort_id || editing.programme_id !== original.programme_id);

  // Reseed the local edit copy whenever a different row is opened.
  if (row && editing?.id !== row.id) {
    setEditing({ ...row, selected_coaches: [...row.selected_coaches] });
  }
  if (!row && editing) {
    setEditing(null);
  }

  const handleSave = async () => {
    if (!editing) return;
    const ok = await saveEdit(editing, original);
    if (ok) onClose();
  };

  return (
    <>
      <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("coacheeEditSheet.title")}</SheetTitle>
            <SheetDescription>{editing?.email}</SheetDescription>
          </SheetHeader>
          {editing && (
            <div className="mt-4 space-y-5">
              {/* PROFILE — the person (identity, account status, languages). */}
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground" data-testid="edit-section-profile">
                {t("coacheeEditSheet.profileSection")}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><Label>{t("coacheeEditSheet.fullName")}</Label><Input value={editing.full_name} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} /></div>
                <div>
                  <Label>{t("coacheeEditSheet.status")}</Label>
                  <Select value={editing.status} onValueChange={(v) => setEditing({ ...editing, status: v as Status })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_KEYS.map((s) => <SelectItem key={s} value={s}>{t(`coachees.statusLabels.${s}`)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* CURRENT ENROLLMENT — programme / cohort / organization. A person
                  without an enrollment is valid: leave the cohort empty. */}
              <div className="border-t pt-4" data-testid="edit-section-enrollment">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("coacheeEditSheet.enrollmentSection")}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">{t("coacheeEditSheet.enrollmentSectionHint")}</p>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <Label>{t("coacheeEditSheet.programme")}</Label>
                  <Select
                    value={editing.programme_id || "none"}
                    onValueChange={(value) => {
                      const v = value === "none" ? null : value;
                      const prog = programmes.find((p) => p.id === v);
                      const cohortStillFits = !v || cohorts.find((c) => c.id === editing.cohort_id)?.programme_id === v;
                      setEditing({
                        ...editing,
                        programme_id: v,
                        cohort_id: cohortStillFits ? editing.cohort_id : null,
                        programme_name: prog?.name || null,
                        programme_duration_months: prog?.duration_months ?? null,
                      });
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder={t("coacheeEditSheet.selectProgrammePlaceholder")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("coacheeEditSheet.noneOption")}</SelectItem>
                      {programmes.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[10px] text-muted-foreground">{t("coacheeEditSheet.programmeFromCohortHint")}</p>
                </div>
              </div>

              <div>
                <Label>{t("coacheeEditSheet.cohort")}</Label>
                <Select
                  value={editing.cohort_id || "none"}
                  onValueChange={(v) => {
                    const cohort = v === "none" ? null : cohorts.find((c) => c.id === v) ?? null;
                    const prog = cohort?.programme_id ? programmes.find((p) => p.id === cohort.programme_id) : null;
                    setEditing({
                      ...editing,
                      cohort_id: cohort?.id ?? null,
                      ...(prog ? {
                        programme_id: prog.id,
                        programme_name: prog.name,
                        programme_duration_months: prog.duration_months,
                      } : {}),
                       // Organization is an enrollment property. A cohort may
                       // contain learners from multiple organizations.
                    });
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("coacheeEditSheet.noneOption")}</SelectItem>
                    {cohortChoices.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {enrollmentWillMove && (
                  <p className="mt-1 text-[10px] text-warning">{t("coacheeEditSheet.enrollmentTransitionHint")}</p>
                )}
              </div>

              <div>
                <Label>{t("coacheeEditSheet.sponsorOrganization")}</Label>
                <Select value={editing.organization_id || "none"} onValueChange={(v) => setEditing({ ...editing, organization_id: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("coacheeEditSheet.noneOption")}</SelectItem>
                    {organizations.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {t("coacheeEditSheet.sponsorOrgHint")}
                </p>
              </div>

              <div>
                <Label>{t("coacheeEditSheet.spokenLanguages")}</Label>
                <div className="mt-1.5 flex gap-4">
                  {(["vi", "en"] as const).map((lang) => (
                    <label key={lang} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={editing.spoken_languages.includes(lang)}
                        onCheckedChange={(v) => {
                          const next = v
                            ? [...editing.spoken_languages, lang]
                            : editing.spoken_languages.filter((l) => l !== lang);
                          setEditing({ ...editing, spoken_languages: next });
                        }}
                      />
                      <span className="text-[13px]">{t(`coacheeEditSheet.spokenLanguages${lang === "vi" ? "Vietnamese" : "English"}`)}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">{t("coacheeEditSheet.spokenLanguagesHint")}</p>
              </div>

              {/* Programme Coaching eligibility is the COHORT Coach pool
                  (Admin -> Cohorts -> Coaching), not a per-learner allowlist.
                  The checkbox list that used to live here still wrote
                  coachee_coach_allowlist, which no longer governs programme
                  Coaching -- leaving it would have let an Admin make an
                  assignment that changed nothing.

                  The allowlist rows themselves are untouched: RULES.md section 3
                  documents non-programme relationships that still depend on
                  them, so nothing is deleted here. */}
              <div className="rounded-lg border border-dashed p-3">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("coacheeEditSheet.selectedCoachesLabel")}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t("coacheeEditSheet.coachAssignmentMovedToCohort")}
                </p>
              </div>

              <div className="rounded-lg bg-muted/40 p-3 text-[11px] text-muted-foreground">
                <p>{t("coacheeEditSheet.sessionsSummaryPrefix")} <strong>{editing.required_units == null ? "—" : `${editing.completed_units}/${editing.required_units}`}</strong> {t("coacheeEditSheet.sessionsSummaryCompleted")} · <strong>{editing.booked}</strong> {t("coacheeEditSheet.sessionsSummaryBooked")}</p>
              </div>

              <div className="rounded-lg border p-3">
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("coacheeEditSheet.loginLink")}</p>
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      {t("coacheeEditSheet.loginLinkHintPrefix")} <strong>{t("coacheeEditSheet.resendLoginLink")}</strong> {t("coacheeEditSheet.loginLinkHintSuffix")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => resendLoginLink(editing)}
                    disabled={resendingLink}
                  >
                    {resendingLink ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {t("coacheeEditSheet.resendLoginLink")}
                  </Button>
                </div>
              </div>
            </div>
          )}
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={onClose}>{t("coacheeEditSheet.cancel")}</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t("coacheeEditSheet.save")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Login link resent confirmation dialog */}
      <Dialog open={!!resentLink} onOpenChange={(o) => !o && setResentLink(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("coacheeEditSheet.loginLinkForTitle", { name: resentLink?.full_name })}</DialogTitle>
            <DialogDescription>
              {resentLink?.email_sent
                ? t("coacheeEditSheet.loginLinkSent")
                : t("coacheeEditSheet.loginLinkFailed")}
            </DialogDescription>
          </DialogHeader>
          {resentLink && (
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("coacheeEditSheet.email")}</p>
                <div className="mt-1 flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                  <code className="flex-1 text-[13px]">{resentLink.email}</code>
                  <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(resentLink.email); toast.success(t("coacheeEditSheet.copied")); }}>{t("coacheeEditSheet.copy")}</Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setResentLink(null)}>{t("coacheeEditSheet.done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
