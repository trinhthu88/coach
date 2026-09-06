import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { format } from "date-fns";
import { Loader2, Shuffle, Bell, Eye, EyeOff, UserPlus, Settings2, XCircle, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kpi, Pill, Avatar } from "./_shared";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { useConfirm } from "@/hooks/use-confirm";
import {
  useAdminTriadGroups,
  useAdminTriadMutations,
  useAdminTriadParticipants,
  type TriadRoundRow,
} from "@/hooks/triads/useAdminTriads";

export function AdminTriadRoundCard({ round }: { round: TriadRoundRow }) {
  const { t } = useTranslation("admin");
  const { confirm, ConfirmDialog } = useConfirm();
  const { groups, loading } = useAdminTriadGroups(round.id);
  const { participants } = useAdminTriadParticipants(round.programme_id);
  const {
    runAutoAssign,
    sendReminders,
    setRoundVisible,
    createGroup,
    reassignMember,
    setGroupActive,
    isRunningAutoAssign,
    isSendingReminders,
    isPending,
  } = useAdminTriadMutations();

  const [createOpen, setCreateOpen] = useState(false);
  const [m1, setM1] = useState("");
  const [m2, setM2] = useState("");
  const [m3, setM3] = useState(NO_MEMBER);
  const [manageGroupId, setManageGroupId] = useState<string | null>(null);
  const [replaceSlot, setReplaceSlot] = useState<1 | 2 | 3 | null>(null);
  const [replaceWith, setReplaceWith] = useState("");

  const nameById = useMemo(() => new Map(participants.map((p) => [p.id, p.full_name])), [participants]);
  const langById = useMemo(() => new Map(participants.map((p) => [p.id, p.spoken_languages])), [participants]);
  const groupedIds = useMemo(() => {
    const s = new Set<string>();
    groups.forEach((g) => [g.member_1_id, g.member_2_id, g.member_3_id].forEach((id) => id && s.add(id)));
    return s;
  }, [groups]);
  const availableForNewGroup = participants.filter((p) => !groupedIds.has(p.id));

  const manageGroup = groups.find((g) => g.id === manageGroupId) ?? null;

  const summary = useMemo(() => {
    const confirmed = groups.filter((g) => g.session?.status === "confirmed").length;
    const completed = groups.filter((g) => g.session?.status === "completed").length;
    const today = new Date().toISOString().slice(0, 10);
    const overdue = round.completion_deadline < today ? groups.filter((g) => g.session?.status !== "completed").length : 0;
    return { groups: groups.length, confirmed, completed, overdue };
  }, [groups, round.completion_deadline]);

  const handleAutoAssign = async () => {
    const ok = await confirm({
      title: t("triads.runAutoAssignConfirmTitle"),
      description: t("triads.runAutoAssignConfirmBody"),
      confirmLabel: t("triads.runAutoAssign"),
    });
    if (!ok) return;
    try {
      const result = await runAutoAssign(round.id);
      toast.success(t("triads.autoAssignSuccess", result));
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, t, { fallback: t("triads.autoAssignError") }));
    }
  };

  const handleSendReminders = async () => {
    try {
      await sendReminders(round.id);
      toast.success(t("triads.sendRemindersSuccess"));
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, t, { fallback: t("triads.sendRemindersError") }));
    }
  };

  const handleToggleVisible = async () => {
    try {
      await setRoundVisible({ roundId: round.id, isVisible: !round.is_visible, programmeId: round.programme_id });
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, t));
    }
  };

  const openCreateGroup = () => {
    setM1("");
    setM2("");
    setM3(NO_MEMBER);
    setCreateOpen(true);
  };

  const membersValid = m1 && m2 && m1 !== m2 && (m3 === NO_MEMBER || (m3 !== m1 && m3 !== m2));

  const handleCreateGroup = async () => {
    if (!membersValid) return;
    try {
      await createGroup({
        roundId: round.id,
        programmeId: round.programme_id,
        memberIds: [m1, m2, m3 === NO_MEMBER ? null : m3],
        language: langById.get(m1)?.includes("en") && !langById.get(m1)?.includes("vi") ? "en" : "vi",
      });
      toast.success(t("triads.saved"));
      setCreateOpen(false);
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, t, { fallback: t("triads.saveFailed") }));
    }
  };

  const handleToggleActive = async (groupId: string, isActive: boolean) => {
    if (isActive) {
      const ok = await confirm({
        title: t("triads.deactivateConfirmTitle"),
        description: t("triads.deactivateConfirmBody"),
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      await setGroupActive({ groupId, roundId: round.id, isActive: !isActive });
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, t, { fallback: t("triads.saveFailed") }));
    }
  };

  const handleReplace = async () => {
    if (!manageGroup || !replaceSlot || !replaceWith) return;
    try {
      await reassignMember({ groupId: manageGroup.id, roundId: round.id, slot: replaceSlot, newMemberId: replaceWith });
      toast.success(t("triads.saved"));
      setReplaceSlot(null);
      setReplaceWith("");
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, t, { fallback: t("triads.saveFailed") }));
    }
  };

  return (
    <Card className="p-5">
      {ConfirmDialog}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-normal tracking-tight">
            {t("triads.roundLabel", { n: round.round_number })} — {round.title}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("triads.deadline", { date: format(new Date(`${round.completion_deadline}T00:00:00`), "MMM d, yyyy") })} ·{" "}
            {t("triads.autoAssignDateLabel", { date: format(new Date(`${round.auto_assign_date}T00:00:00`), "MMM d, yyyy") })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={round.auto_assign_status === "failed" ? "destructive" : round.auto_assign_status === "completed" ? "success" : "muted"}>
            {t(`triads.autoAssignStatus.${round.auto_assign_status}`)}
          </Pill>
          <Button size="sm" variant="ghost" onClick={handleToggleVisible} disabled={isPending}>
            {round.is_visible ? <Eye className="mr-1.5 h-3.5 w-3.5" /> : <EyeOff className="mr-1.5 h-3.5 w-3.5" />}
            {t(round.is_visible ? "triads.active" : "triads.inactive")}
          </Button>
          <Button size="sm" variant="outline" onClick={handleAutoAssign} disabled={isRunningAutoAssign}>
            {isRunningAutoAssign ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Shuffle className="mr-1.5 h-3.5 w-3.5" />}
            {t("triads.runAutoAssign")}
          </Button>
          <Button size="sm" variant="outline" onClick={handleSendReminders} disabled={isSendingReminders}>
            {isSendingReminders ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Bell className="mr-1.5 h-3.5 w-3.5" />}
            {t("triads.sendReminders")}
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-4">
        <Kpi label={t("triads.summary.groups")} value={summary.groups} icon={UserPlus} tone="primary" />
        <Kpi label={t("triads.summary.confirmed")} value={summary.confirmed} icon={CheckCircle2} tone="success" />
        <Kpi label={t("triads.summary.completed")} value={summary.completed} icon={CheckCircle2} tone="secondary" />
        <Kpi label={t("triads.summary.overdue")} value={summary.overdue} icon={XCircle} tone="destructive" />
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("triads.groupsHeading")}</p>
        <Button size="sm" variant="outline" onClick={openCreateGroup} disabled={availableForNewGroup.length < 2}>
          <UserPlus className="mr-1.5 h-3.5 w-3.5" /> {t("triads.createGroup")}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("triads.noGroups")}</p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => {
            const memberIds = [g.member_1_id, g.member_2_id, g.member_3_id].filter(Boolean) as string[];
            const expectedReflections = memberIds.length;
            return (
              <Card key={g.id} className="p-4">
                <div className="flex items-center gap-2">
                  <Pill tone="muted">{t(`triads.language.${g.group_language}`)}</Pill>
                  {!g.member_3_id && <Pill tone="warning">{t("triads.dyadBadge")}</Pill>}
                  <span className="flex-1" />
                  <Pill tone={g.is_active ? "success" : "muted"}>{t(g.is_active ? "triads.active" : "triads.inactive")}</Pill>
                </div>
                <div className="mt-3 flex flex-col gap-1.5">
                  {memberIds.map((id) => (
                    <div key={id} className="flex items-center gap-2 text-[12.5px]">
                      <Avatar name={nameById.get(id) || "?"} size={22} />
                      <span className="flex-1 truncate">{nameById.get(id) || "—"}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between border-t pt-3 text-[11px] text-muted-foreground">
                  <span>{t(`triads.sessionStatus.${g.session?.status ?? "none"}`)}</span>
                  <span>{t("triads.reflectionsOf", { done: g.reflectionCount, total: expectedReflections })}</span>
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
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("triads.createGroupDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <MemberSelect label={t("triads.member1")} value={m1} onChange={setM1} options={availableForNewGroup} />
            <MemberSelect label={t("triads.member2")} value={m2} onChange={setM2} options={availableForNewGroup} />
            <MemberSelect label={t("triads.member3")} value={m3} onChange={setM3} options={availableForNewGroup} allowNone />
            {(m1 || m2) && m1 === m2 && <p className="text-xs text-destructive">{t("triads.membersMustDiffer")}</p>}
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
            setReplaceSlot(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("triads.manageGroupDialogTitle")}</DialogTitle>
          </DialogHeader>
          {manageGroup && (
            <div className="space-y-3">
              {([1, 2, 3] as const).map((slot) => {
                const idKey = slot === 1 ? "member_1_id" : slot === 2 ? "member_2_id" : "member_3_id";
                const currentId = manageGroup[idKey];
                if (!currentId && slot === 3) {
                  return (
                    <div key={slot} className="flex items-center gap-2">
                      <p className="flex-1 text-sm text-muted-foreground">{t("triads.addThirdMember")}</p>
                      {replaceSlot === slot ? (
                        <MemberSelect label="" value={replaceWith} onChange={setReplaceWith} options={availableForNewGroup} compact />
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setReplaceSlot(slot)}>
                          <UserPlus className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  );
                }
                return (
                  <div key={slot} className="flex items-center gap-2">
                    <Avatar name={nameById.get(currentId) || "?"} size={24} />
                    <p className="flex-1 truncate text-sm">{nameById.get(currentId) || "—"}</p>
                    {replaceSlot === slot ? (
                      <MemberSelect label="" value={replaceWith} onChange={setReplaceWith} options={availableForNewGroup} compact />
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setReplaceSlot(slot)}>
                        {t("triads.replaceMember", { slot })}
                      </Button>
                    )}
                  </div>
                );
              })}
              {replaceSlot && (
                <Button size="sm" onClick={handleReplace} disabled={!replaceWith || isPending} className="w-full">
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

const NO_MEMBER = "__none__";

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
  options: { id: string; full_name: string }[];
  allowNone?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "flex-1" : undefined}>
      {label && <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allowNone && <SelectItem value={NO_MEMBER}>—</SelectItem>}
          {options.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.full_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
