import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { format } from "date-fns";
import { Loader2, Shuffle, Bell, UserPlus, Settings2, XCircle, CheckCircle2, CalendarClock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kpi, Pill, Avatar } from "./_shared";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { useConfirm } from "@/hooks/use-confirm";
import {
  useAdminTriadCandidates,
  useAdminTriadMutations,
  type AdminTriadCandidate,
  type AdminTriadRequirement,
} from "@/hooks/triads/useAdminTriads";

const NO_MEMBER = "__none__";

/**
 * One cohort Triad requirement unit (round). The due date is the cohort's
 * canonical requirement date — edited only in the Cohort requirement
 * schedule. Overdue / completed counts come from canonical progress.
 */
export function AdminTriadRequirementCard({ cohortId, requirement }: { cohortId: string; requirement: AdminTriadRequirement }) {
  const { t } = useTranslation("admin");
  const { confirm, ConfirmDialog } = useConfirm();
  const { candidates } = useAdminTriadCandidates(requirement.requirementId);
  const { runAutoAssign, sendReminders, createGroup, changeMember, setGroupActive, runningAutoAssignFor, sendingRemindersFor, isPending } =
    useAdminTriadMutations(cohortId);

  const [createOpen, setCreateOpen] = useState(false);
  const [picked, setPicked] = useState<[string, string, string]>(["", "", NO_MEMBER]);
  const [manageGroupId, setManageGroupId] = useState<string | null>(null);
  const [replaceEnrollment, setReplaceEnrollment] = useState<string | null>(null);
  const [replaceWith, setReplaceWith] = useState("");

  const unassigned = useMemo(() => candidates.filter((c) => !c.triad_group_id), [candidates]);
  const manageGroup = requirement.groups.find((g) => g.id === manageGroupId) ?? null;
  const activeGroups = requirement.groups.filter((g) => g.is_active);
  const summary = {
    groups: activeGroups.length,
    confirmed: activeGroups.filter((g) => g.session?.status === "confirmed").length,
    completed: requirement.completedEnrollments,
    overdue: requirement.overdueEnrollments,
  };

  const handleAutoAssign = async () => {
    const ok = await confirm({
      title: t("triads.runAutoAssignConfirmTitle"),
      description: t("triads.runAutoAssignConfirmBody"),
      confirmLabel: t("triads.runAutoAssign"),
    });
    if (!ok) return;
    try {
      const result = await runAutoAssign(requirement.requirementId);
      toast.success(t("triads.autoAssignSuccess", result));
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
  const languageOf = (c: AdminTriadCandidate | undefined) => (c?.spoken_languages.includes("en") && !c.spoken_languages.includes("vi") ? "en" : "vi");

  const handleCreateGroup = async () => {
    if (!membersValid) return;
    try {
      await createGroup({
        requirementId: requirement.requirementId,
        enrollmentIds: chosen,
        language: languageOf(candidates.find((c) => c.enrollment_id === picked[0])),
      });
      toast.success(t("triads.saved"));
      setCreateOpen(false);
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, t, { fallback: t("triads.saveFailed") }));
    }
  };

  const handleToggleActive = async (groupId: string, isActive: boolean) => {
    if (isActive) {
      const ok = await confirm({ title: t("triads.deactivateConfirmTitle"), description: t("triads.deactivateConfirmBody"), destructive: true });
      if (!ok) return;
    }
    try {
      await setGroupActive({ groupId, isActive: !isActive });
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

  return (
    <Card className="p-5" data-testid="admin-triad-requirement">
      {ConfirmDialog}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-normal tracking-tight">{t("triads.roundLabel", { n: requirement.unitNumber })}</p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="admin-triad-due">
            <CalendarClock className="h-3.5 w-3.5" />
            {t("triads.deadline", { date: format(new Date(`${requirement.dueOn}T00:00:00`), "MMM d, yyyy") })}
            <span className="opacity-70">· {t("triads.dueFromSchedule")}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={requirement.assignmentStatus === "failed" ? "destructive" : requirement.assignmentStatus === "completed" ? "success" : "muted"}>
            {t(`triads.autoAssignStatus.${requirement.assignmentStatus}`)}
          </Pill>
          <Button size="sm" variant="outline" onClick={handleAutoAssign} disabled={!requirement.isOperational || runningAutoAssignFor === requirement.requirementId}>
            {runningAutoAssignFor === requirement.requirementId ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Shuffle className="mr-1.5 h-3.5 w-3.5" />}
            {t("triads.runAutoAssign")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setPicked(["", "", NO_MEMBER]);
              setCreateOpen(true);
            }}
            disabled={!requirement.isOperational || unassigned.length < 2}
          >
            <UserPlus className="mr-1.5 h-3.5 w-3.5" /> {t("triads.createGroup")}
          </Button>
          <Button size="sm" variant="outline" onClick={handleSendReminders} disabled={sendingRemindersFor === requirement.requirementId}>
            {sendingRemindersFor === requirement.requirementId ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Bell className="mr-1.5 h-3.5 w-3.5" />}
            {t("triads.sendReminders")}
          </Button>
        </div>
      </div>
      {!requirement.isOperational && <p className="mt-2 text-xs text-warning">{t("triads.beyondRequirement")}</p>}

      <div className="mt-4 grid gap-2.5 sm:grid-cols-4">
        <Kpi label={t("triads.summary.groups")} value={summary.groups} icon={UserPlus} tone="primary" />
        <Kpi label={t("triads.summary.confirmed")} value={summary.confirmed} icon={CheckCircle2} tone="success" />
        <Kpi label={t("triads.summary.completedLearners")} value={`${summary.completed} / ${requirement.eligibleEnrollments}`} icon={CheckCircle2} tone="secondary" />
        <Kpi label={t("triads.summary.overdueLearners")} value={summary.overdue} icon={XCircle} tone="destructive" />
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("triads.groupsHeading")}</p>
        <p className="text-[11px] text-muted-foreground">{t("triads.unassignedCount", { count: unassigned.length })}</p>
      </div>

      {requirement.groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("triads.noGroups")}</p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {requirement.groups.map((g) => (
            <Card key={g.id} className="p-4" data-testid="admin-triad-group">
              <div className="flex items-center gap-2">
                <Pill tone="muted">{t(`triads.language.${g.group_language}`)}</Pill>
                {g.members.length === 2 && <Pill tone="warning">{t("triads.dyadBadge")}</Pill>}
                <span className="flex-1" />
                <Pill tone={g.is_active ? "success" : "muted"}>{t(g.is_active ? "triads.active" : "triads.inactive")}</Pill>
              </div>
              <div className="mt-3 flex flex-col gap-1.5">
                {g.members.map((m) => (
                  <div key={m.enrollment_id} className="flex items-center gap-2 text-[12.5px]">
                    <Avatar name={m.full_name || "?"} size={22} />
                    <span className="flex-1 truncate">{m.full_name || "—"}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between border-t pt-3 text-[11px] text-muted-foreground">
                <span>
                  {t(`triads.sessionStatus.${g.session?.status ?? "none"}`)}
                  {g.session?.scheduled_start_time ? ` · ${format(new Date(g.session.scheduled_start_time), "MMM d, p")}` : ""}
                </span>
                <span>{t("triads.reflectionsOf", { done: g.reflection_count, total: g.members.length })}</span>
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => setManageGroupId(g.id)}>
                  <Settings2 className="mr-1.5 h-3.5 w-3.5" /> {t("triads.manageGroup")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleToggleActive(g.id, g.is_active)} disabled={isPending}>
                  {g.is_active ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("triads.createGroupDialogTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">{t("triads.cohortPoolHint")}</p>
          <div className="space-y-3">
            {([0, 1, 2] as const).map((i) => (
              <MemberSelect
                key={i}
                label={t(i === 0 ? "triads.member1" : i === 1 ? "triads.member2" : "triads.member3")}
                value={picked[i]}
                onChange={(v) => setPicked((prev) => Object.assign([...prev], { [i]: v }) as [string, string, string])}
                options={unassigned}
                allowNone={i === 2}
              />
            ))}
            {chosen.length !== new Set(chosen).size && <p className="text-xs text-destructive">{t("triads.membersMustDiffer")}</p>}
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
            <DialogTitle>{t("triads.manageGroupDialogTitle")}</DialogTitle>
          </DialogHeader>
          {manageGroup && (
            <div className="space-y-3">
              {manageGroup.members.map((m) => (
                <div key={m.enrollment_id} className="flex items-center gap-2">
                  <Avatar name={m.full_name || "?"} size={24} />
                  <p className="flex-1 truncate text-sm">{m.full_name || "—"}</p>
                  {replaceEnrollment === m.enrollment_id ? (
                    <MemberSelect label="" value={replaceWith} onChange={setReplaceWith} options={unassigned} compact />
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setReplaceEnrollment(m.enrollment_id)}>
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
                    options={unassigned}
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
            <SelectItem key={p.enrollment_id} value={p.enrollment_id}>
              {p.full_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
