import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { format } from "date-fns";
import { AlertTriangle, Bell, CalendarClock, CheckCircle2, Loader2, Settings2, Shuffle, UserPlus, Users, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, Kpi, Pill } from "./_shared";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { useConfirm } from "@/hooks/use-confirm";
import {
  useAdminCohortTriadGroups,
  useAdminCohortTriadLearners,
  useAdminCohortTriadRequirementStats,
  useAdminTriadMutations,
  useAdminTriadRequirementCandidates,
  type AdminTriadCandidate,
  type AdminTriadGroup,
  type AdminTriadLearner,
  type AdminTriadRequirementStats,
} from "@/hooks/triads/useAdminTriads";

const NO_MEMBER = "__none__";

function groupLetter(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Letters per requirement, in creation order: "Triad 2 · Group A". */
function lettersFor(groups: AdminTriadGroup[]): Map<string, string> {
  const byRequirement = new Map<string, AdminTriadGroup[]>();
  for (const g of groups) byRequirement.set(g.requirementId, [...(byRequirement.get(g.requirementId) ?? []), g]);
  const letters = new Map<string, string>();
  for (const list of byRequirement.values()) {
    [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).forEach((g, i) => letters.set(g.id, groupLetter(i)));
  }
  return letters;
}

/**
 * GROUP MANAGEMENT for one cohort. EVERY REQUIRED TRIAD HAS ITS OWN GROUP
 * ASSIGNMENT: one card per Triad requirement (Triad 1, Triad 2, …) with its
 * own auto assign, manual group creation, reminders, groups and sessions.
 * Every learner number is the canonical Triad completion — there is no
 * Admin formula here.
 */
export function AdminTriadGroupManagement({ cohortId, programmeNames = {} }: { cohortId: string; programmeNames?: Record<string, string> }) {
  const { t } = useTranslation("admin");
  const statsQuery = useAdminCohortTriadRequirementStats(cohortId);
  const groupsQuery = useAdminCohortTriadGroups(cohortId);
  const learnersQuery = useAdminCohortTriadLearners(cohortId);
  const groups = groupsQuery.groups;
  const learners = learnersQuery.learners;
  const letterById = useMemo(() => lettersFor(groups), [groups]);

  if (statsQuery.loading || groupsQuery.loading || learnersQuery.loading) {
    return (
      <Card className="flex justify-center p-10">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </Card>
    );
  }
  if (statsQuery.error || groupsQuery.error || learnersQuery.error) {
    // STATE C — the requirement above stays correct; only operations failed.
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center text-sm" role="alert" data-testid="admin-triads-operational-error">
        <AlertTriangle className="h-5 w-5 text-destructive" />
        <p className="text-destructive">{t("triads.operationalLoadError")}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void statsQuery.refetch();
            void groupsQuery.refetch();
            void learnersQuery.refetch();
          }}
        >
          {t("triads.retry")}
        </Button>
      </Card>
    );
  }

  const units = statsQuery.requirements;
  const showProgramme = new Set(units.map((r) => r.programmeId)).size > 1;

  return (
    <div className="space-y-4" data-testid="admin-triad-management">
      {units.map((r) => (
        <TriadRequirementCard
          key={r.requirementId}
          cohortId={cohortId}
          requirement={r}
          groups={groups.filter((g) => g.requirementId === r.requirementId)}
          learners={learners}
          letterById={letterById}
          programmeLabel={showProgramme ? (programmeNames[r.programmeId] ?? null) : null}
        />
      ))}

      <Card className="p-5">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("triads.progressHeading")}</p>
        <p className="text-[11px] text-muted-foreground">{t("triads.progressHint")}</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-[12px]" data-testid="admin-triad-progress">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-3">{t("triads.progressColumns.learner")}</th>
                <th className="py-1.5 pr-3">{t("triads.progressColumns.completed")}</th>
                {[...new Set(units.map((u) => u.unitNumber))].map((n) => (
                  <th key={n} className="py-1.5 pr-3">{t("triads.triadN", { n })}</th>
                ))}
                <th className="py-1.5 pr-3">{t("triads.progressColumns.raw")}</th>
                <th className="py-1.5 pr-3">{t("triads.progressColumns.overdue")}</th>
                <th className="py-1.5">{t("triads.progressColumns.next")}</th>
              </tr>
            </thead>
            <tbody>
              {learners.map((l) => (
                <tr key={l.enrollmentId} className="border-t" data-testid="admin-triad-learner">
                  <td className="py-1.5 pr-3">{l.fullName || "—"}</td>
                  <td className="py-1.5 pr-3" data-testid="admin-triad-learner-completed">{`${l.completedUnits} / ${l.requiredUnits}`}</td>
                  {[...new Set(units.map((u) => u.unitNumber))].map((n) => {
                    const r = l.requirements.find((x) => x.milestone === n);
                    return (
                      <td key={n} className="py-1.5 pr-3" data-testid="admin-triad-learner-unit" data-unit={n}>
                        {!r ? "—" : r.fulfilled ? (
                          <span className="text-success">✓ {r.fulfilledOn ? format(new Date(`${r.fulfilledOn}T00:00:00`), "dd MMM") : ""}</span>
                        ) : (
                          <span className={r.overdue ? "font-semibold text-destructive" : undefined}>
                            {r.triadGroupId && letterById.has(r.triadGroupId)
                              ? t("triads.groupLabel", { letter: letterById.get(r.triadGroupId) })
                              : t("triads.assignmentPending")}
                            {r.overdue ? ` · ${t("triads.overdue")}` : ""}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="py-1.5 pr-3">{l.rawCompletedSessions}</td>
                  <td className={l.overdueUnits > 0 ? "py-1.5 pr-3 font-semibold text-destructive" : "py-1.5 pr-3"}>{l.overdueUnits}</td>
                  <td className="py-1.5">{l.nextDueOn ? format(new Date(`${l.nextDueOn}T00:00:00`), "dd MMM yyyy") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/** One Triad requirement ("Triad N"): its own assignment, groups and sessions. */
function TriadRequirementCard({
  cohortId,
  requirement,
  groups,
  learners,
  letterById,
  programmeLabel,
}: {
  cohortId: string;
  requirement: AdminTriadRequirementStats;
  groups: AdminTriadGroup[];
  learners: AdminTriadLearner[];
  letterById: Map<string, string>;
  programmeLabel: string | null;
}) {
  const { t } = useTranslation("admin");
  const { confirm, ConfirmDialog } = useConfirm();
  const candidatesQuery = useAdminTriadRequirementCandidates(requirement.requirementId);
  const { runAutoAssign, sendReminders, createGroup, changeMember, setGroupActive, autoAssignRunning, remindersSending, isPending } =
    useAdminTriadMutations(cohortId);

  const [createOpen, setCreateOpen] = useState(false);
  const [picked, setPicked] = useState<[string, string, string]>(["", "", NO_MEMBER]);
  const [manageGroupId, setManageGroupId] = useState<string | null>(null);
  const [replaceEnrollment, setReplaceEnrollment] = useState<string | null>(null);
  const [replaceWith, setReplaceWith] = useState("");

  const n = requirement.unitNumber;
  const candidates = candidatesQuery.candidates;
  const manageGroup = groups.find((g) => g.id === manageGroupId) ?? null;
  const dueLabel = format(new Date(`${requirement.dueOn}T00:00:00`), "dd MMM yyyy");
  const reminderTargets = requirement.eligible - requirement.fulfilled;

  const handleAutoAssign = async () => {
    const ok = await confirm({
      title: t("triads.runAutoAssignConfirmTitle", { n }),
      description: t("triads.runAutoAssignConfirmBody", { n }),
      confirmLabel: t("triads.runAutoAssign"),
    });
    if (!ok) return;
    try {
      const result = await runAutoAssign(requirement.requirementId);
      toast.success(t("triads.autoAssignSuccess", { ...result, n, repeated: result.repeated_pairs ?? 0 }));
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, t, { fallback: t("triads.autoAssignError") }));
    }
  };

  const handleSendReminders = async () => {
    try {
      await sendReminders(requirement.requirementId);
      toast.success(t("triads.sendRemindersSuccess"));
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, t, { fallback: t("triads.sendRemindersError") }));
    }
  };

  const chosen = picked.filter((id) => id && id !== NO_MEMBER);
  const membersValid = !!picked[0] && !!picked[1] && new Set(chosen).size === chosen.length;
  const languageOf = (c: AdminTriadCandidate | undefined) => (c?.spokenLanguages.includes("en") && !c.spokenLanguages.includes("vi") ? "en" : "vi");
  const byEnrollment = new Map(candidates.map((c) => [c.enrollmentId, c]));
  const repeatedPairs = chosen.flatMap((a, i) =>
    chosen.slice(i + 1).filter((b) => byEnrollment.get(a)?.priorPartnerEnrollmentIds.includes(b)).map((b) => [a, b] as const),
  );

  const handleCreateGroup = async () => {
    if (!membersValid) return;
    try {
      await createGroup({ requirementId: requirement.requirementId, enrollmentIds: chosen, language: languageOf(byEnrollment.get(picked[0])) });
      toast.success(t("triads.saved"));
      setCreateOpen(false);
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, t, { fallback: t("triads.saveFailed") }));
    }
  };

  const handleToggleActive = async (group: AdminTriadGroup) => {
    if (group.isActive) {
      const ok = await confirm({ title: t("triads.closeGroupConfirmTitle"), description: t("triads.closeGroupConfirmBody", { n }), destructive: true });
      if (!ok) return;
    }
    try {
      await setGroupActive({ groupId: group.id, isActive: !group.isActive });
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, t, { fallback: t("triads.saveFailed") }));
    }
  };

  const handleChangeMember = async () => {
    if (!manageGroup || !replaceWith) return;
    try {
      await changeMember({ groupId: manageGroup.id, removeEnrollmentId: replaceEnrollment, addEnrollmentId: replaceWith });
      toast.success(t("triads.saved"));
      setReplaceEnrollment(null);
      setReplaceWith("");
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, t, { fallback: t("triads.saveFailed") }));
    }
  };

  const nameOf = (enrollmentId: string) =>
    byEnrollment.get(enrollmentId)?.fullName || learners.find((l) => l.enrollmentId === enrollmentId)?.fullName || "—";

  return (
    <Card className="p-5" data-testid="admin-triad-requirement" data-unit={n}>
      {ConfirmDialog}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-normal" data-testid="admin-triad-requirement-title">
            {t("triads.triadN", { n })}
            {programmeLabel ? <span className="ml-2 text-xs text-muted-foreground">{programmeLabel}</span> : null}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" /> {t("triads.dueOn", { date: dueLabel })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleAutoAssign} disabled={autoAssignRunning || candidates.length < 2}>
            {autoAssignRunning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Shuffle className="mr-1.5 h-3.5 w-3.5" />}
            {t("triads.runAutoAssign")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setPicked(["", "", NO_MEMBER]);
              setCreateOpen(true);
            }}
            disabled={candidates.length < 2}
          >
            <UserPlus className="mr-1.5 h-3.5 w-3.5" /> {t("triads.createGroup")}
          </Button>
          <Button size="sm" variant="outline" onClick={handleSendReminders} disabled={remindersSending || reminderTargets === 0}>
            {remindersSending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Bell className="mr-1.5 h-3.5 w-3.5" />}
            {t("triads.sendReminders")}
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label={t("triads.summary.eligible")} value={requirement.eligible} icon={Users} tone="primary" />
        <Kpi label={t("triads.summary.grouped")} value={requirement.assigned} icon={Users} tone="secondary" />
        <Kpi label={t("triads.summary.ungrouped")} value={requirement.eligible - requirement.assigned} icon={UserPlus} tone="warning" />
        <Kpi label={t("triads.summary.completedLearners")} value={`${requirement.fulfilled} / ${requirement.eligible}`} icon={CheckCircle2} tone="success" />
        <Kpi label={t("triads.summary.overdueLearners")} value={requirement.overdue} icon={XCircle} tone="destructive" />
        <Kpi
          label={t("triads.summary.reflections")}
          value={`${requirement.reflectionsSubmitted} / ${requirement.reflectionsExpected}`}
          icon={CheckCircle2}
          tone="primary"
        />
      </div>

      <div className="mt-5">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("triads.ungroupedHeading", { n })}</p>
        {candidates.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">{t("triads.ungroupedNone", { n })}</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2" data-testid="admin-triad-ungrouped">
            {candidates.map((c) => (
              <span key={c.enrollmentId} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
                <Avatar name={c.fullName || "?"} size={18} /> {c.fullName || "—"}
              </span>
            ))}
          </div>
        )}
      </div>

      <p className="mt-5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("triads.groupsHeading", { n })}</p>
      {groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("triads.noGroups", { n })}</p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <Card key={g.id} className="p-4" data-testid="admin-triad-group">
              <div className="flex items-center gap-2">
                <p className="font-display text-base font-normal">{t("triads.groupLabel", { letter: letterById.get(g.id) })}</p>
                <Pill tone="muted">{t(`triads.language.${g.groupLanguage}`)}</Pill>
                {g.members.length === 2 && <Pill tone="warning">{t("triads.dyadBadge")}</Pill>}
                <span className="flex-1" />
                <Pill tone={g.isActive ? "success" : "muted"}>{t(g.isActive ? "triads.active" : "triads.closed")}</Pill>
              </div>
              <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("triads.membersHeading")}</p>
              <div className="mt-1.5 flex flex-col gap-1.5">
                {g.members.map((m) => (
                  <div key={m.enrollmentId} className="flex items-center gap-2 text-[12.5px]">
                    <Avatar name={m.fullName || "?"} size={22} />
                    <span className="flex-1 truncate">{m.fullName || "—"}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("triads.sessionsHeading")}</p>
              {g.sessions.length === 0 ? (
                <p className="mt-1.5 text-[11px] text-muted-foreground">{t("triads.noSessions")}</p>
              ) : (
                <ul className="mt-1.5 space-y-1 text-[11.5px]" data-testid="admin-triad-sessions">
                  {g.sessions.map((s) => (
                    <li key={s.id} className="flex justify-between gap-2" data-status={s.status}>
                      <span>
                        {t("triads.sessionLine", { n, status: t(`triads.sessionStatus.${s.status}`) })}
                        {s.scheduledStartTime ? ` · ${format(new Date(s.scheduledStartTime), "dd MMM yyyy, p")}` : ""}
                      </span>
                      {s.status === "completed" && (
                        <span className="text-muted-foreground">{t("triads.reflectionsOf", { done: s.reflectionCount, total: g.members.length })}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex gap-2 border-t pt-3">
                {g.isActive && g.sessions.length === 0 && (
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => setManageGroupId(g.id)}>
                    <Settings2 className="mr-1.5 h-3.5 w-3.5" /> {t("triads.manageGroup")}
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="flex-1" onClick={() => handleToggleActive(g)} disabled={isPending}>
                  {g.isActive ? <XCircle className="mr-1.5 h-3.5 w-3.5" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                  {t(g.isActive ? "triads.closeGroup" : "triads.reopenGroup")}
                </Button>
              </div>
              {g.isActive && g.sessions.length > 0 && <p className="mt-2 text-[10.5px] text-muted-foreground">{t("triads.manageGroupLocked", { n })}</p>}
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("triads.createGroupDialogTitle", { n })}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">{t("triads.cohortPoolHint", { n })}</p>
          <div className="space-y-3">
            {([0, 1, 2] as const).map((i) => (
              <MemberSelect
                key={i}
                label={t(i === 0 ? "triads.member1" : i === 1 ? "triads.member2" : "triads.member3")}
                value={picked[i]}
                onChange={(v) => setPicked((prev) => Object.assign([...prev], { [i]: v }) as [string, string, string])}
                options={candidates}
                allowNone={i === 2}
              />
            ))}
            {chosen.length !== new Set(chosen).size && <p className="text-xs text-destructive">{t("triads.membersMustDiffer")}</p>}
            {repeatedPairs.length > 0 && (
              <p className="text-xs text-warning" data-testid="admin-triad-repeated-pairs">
                {t("triads.repeatedPartnersWarning", {
                  pairs: repeatedPairs.map(([a, b]) => `${nameOf(a)} & ${nameOf(b)}`).join(", "),
                })}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("triads.cancel")}</Button>
            <Button onClick={handleCreateGroup} disabled={!membersValid || isPending}>
              {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t("triads.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!manageGroup}
        onOpenChange={(open) => {
          if (!open) {
            setManageGroupId(null);
            setReplaceEnrollment(null);
            setReplaceWith("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("triads.manageGroupDialogTitle", { n })}</DialogTitle>
          </DialogHeader>
          {manageGroup && (
            <div className="space-y-3">
              {manageGroup.members.map((m) => (
                <div key={m.enrollmentId} className="flex items-center gap-2">
                  <Avatar name={m.fullName || "?"} size={24} />
                  <p className="flex-1 truncate text-sm">{m.fullName || "—"}</p>
                  {replaceEnrollment === m.enrollmentId ? (
                    <MemberSelect label="" value={replaceWith} onChange={setReplaceWith} options={candidates} compact />
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setReplaceEnrollment(m.enrollmentId)}>
                      {t("triads.replaceMemberAction")}
                    </Button>
                  )}
                </div>
              ))}
              {manageGroup.members.length < 3 && (
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-sm text-muted-foreground">{t("triads.addThirdMember")}</p>
                  <MemberSelect
                    label=""
                    value={replaceEnrollment === null ? replaceWith : ""}
                    onChange={(v) => {
                      setReplaceEnrollment(null);
                      setReplaceWith(v);
                    }}
                    options={candidates}
                    compact
                  />
                </div>
              )}
              {replaceWith && (
                <Button size="sm" onClick={handleChangeMember} disabled={isPending} className="w-full">
                  {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  {t("triads.save")}
                </Button>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageGroupId(null)}>{t("triads.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function MemberSelect({
  label,
  value,
  onChange,
  options,
  allowNone,
  compact,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: AdminTriadCandidate[];
  allowNone?: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation("admin");
  return (
    <div className={compact ? "flex-1" : undefined}>
      {label && <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={t("triads.selectMember")} />
        </SelectTrigger>
        <SelectContent>
          {allowNone && <SelectItem value={NO_MEMBER}>—</SelectItem>}
          {options.map((p) => (
            <SelectItem key={p.enrollmentId} value={p.enrollmentId}>
              {p.fullName}
              {p.priorPartnerNames.length > 0 && (
                <span className="ml-1.5 text-[11px] text-muted-foreground">{t("triads.priorPartners", { names: p.priorPartnerNames.join(", ") })}</span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
