import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, Users, UserPlus, Shuffle, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { AdminPageHeader, Kpi, Pill, Avatar } from "./_shared";

interface CohortOption {
  id: string;
  name: string;
  programme_id: string | null;
}

interface Participant {
  id: string;
  full_name: string;
}

interface TriadGroupRow {
  id: string;
  cohort_id: string;
  programme_id: string;
  name: string | null;
  member_1_id: string;
  member_2_id: string;
  member_3_id: string;
  is_active: boolean;
}

export default function AdminTriads() {
  const { t } = useTranslation("admin");

  const [cohorts, setCohorts] = useState<CohortOption[]>([]);
  const [cohortId, setCohortId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [groups, setGroups] = useState<TriadGroupRow[]>([]);
  const [sessionCountByGroup, setSessionCountByGroup] = useState<Map<string, number>>(new Map());
  const [reflectionCountByGroup, setReflectionCountByGroup] = useState<Map<string, number>>(new Map());
  const [maxTriads, setMaxTriads] = useState<number | null>(null);
  const [programmeGroupCount, setProgrammeGroupCount] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [m1, setM1] = useState("");
  const [m2, setM2] = useState("");
  const [m3, setM3] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("cohorts").select("id, name, programme_id").order("name");
      setCohorts((data || []) as CohortOption[]);
      setLoading(false);
    })();
  }, []);

  const loadCohortData = useCallback(async (id: string) => {
    if (!id) {
      setParticipants([]);
      setGroups([]);
      setSessionCountByGroup(new Map());
      setReflectionCountByGroup(new Map());
      setMaxTriads(null);
      setProgrammeGroupCount(0);
      return;
    }
    setBusy(true);
    const [{ data: enrollments }, { data: groupRows }, { data: cohortRow }] = await Promise.all([
      supabase.from("programme_enrollments").select("user_id").eq("cohort_id", id).eq("status", "active"),
      supabase.from("triad_groups").select("*").eq("cohort_id", id).order("created_at"),
      supabase.from("cohorts").select("programme_id").eq("id", id).maybeSingle(),
    ]);

    // The "how many triads can be made" cap lives on the programme's triads
    // module config (set in AdminProgrammes.tsx), not per-cohort — so it's
    // checked against every active group across the whole programme, not
    // just this cohort's.
    const programmeId = (cohortRow?.programme_id as string | null) ?? null;
    if (programmeId) {
      const [{ data: moduleRow }, { count }] = await Promise.all([
        supabase.from("programme_modules").select("config").eq("programme_id", programmeId).eq("module", "triads").maybeSingle(),
        supabase.from("triad_groups").select("id", { count: "exact", head: true }).eq("programme_id", programmeId).eq("is_active", true),
      ]);
      const cfg = (moduleRow?.config as { max_triads?: number | null } | null) ?? {};
      setMaxTriads(cfg.max_triads ?? null);
      setProgrammeGroupCount(count ?? 0);
    } else {
      setMaxTriads(null);
      setProgrammeGroupCount(0);
    }

    const userIds = [...new Set((enrollments || []).map((e) => e.user_id as string))];
    const { data: profileRows } = userIds.length
      ? await supabase.from("profiles").select("id, full_name").in("id", userIds)
      : { data: [] };
    setParticipants(((profileRows || []) as Participant[]).sort((a, b) => a.full_name.localeCompare(b.full_name)));

    const groupList = (groupRows || []) as TriadGroupRow[];
    setGroups(groupList);

    if (groupList.length > 0) {
      const groupIds = groupList.map((g) => g.id);
      const { data: sessionRows } = await supabase.from("triad_sessions").select("id, triad_group_id").in("triad_group_id", groupIds);
      const sCount = new Map<string, number>();
      (sessionRows || []).forEach((s) => sCount.set(s.triad_group_id as string, (sCount.get(s.triad_group_id as string) || 0) + 1));
      setSessionCountByGroup(sCount);

      const sessionIds = (sessionRows || []).map((s) => s.id as string);
      const rCount = new Map<string, number>();
      if (sessionIds.length > 0) {
        const { data: reflectionRows } = await supabase.from("triad_reflections").select("triad_session_id").in("triad_session_id", sessionIds);
        const sessionToGroup = new Map((sessionRows || []).map((s) => [s.id as string, s.triad_group_id as string]));
        (reflectionRows || []).forEach((r) => {
          const gid = sessionToGroup.get(r.triad_session_id as string);
          if (gid) rCount.set(gid, (rCount.get(gid) || 0) + 1);
        });
      }
      setReflectionCountByGroup(rCount);
    } else {
      setSessionCountByGroup(new Map());
      setReflectionCountByGroup(new Map());
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    loadCohortData(cohortId);
  }, [cohortId, loadCohortData]);

  const cohort = cohorts.find((c) => c.id === cohortId);
  const nameById = useMemo(() => new Map(participants.map((p) => [p.id, p.full_name])), [participants]);

  const groupedMemberIds = useMemo(() => {
    const s = new Set<string>();
    groups.filter((g) => g.is_active).forEach((g) => [g.member_1_id, g.member_2_id, g.member_3_id].forEach((id) => s.add(id)));
    return s;
  }, [groups]);
  const unassigned = participants.filter((p) => !groupedMemberIds.has(p.id));

  const openCreate = () => {
    setNewName("");
    setM1("");
    setM2("");
    setM3("");
    setCreateOpen(true);
  };

  const atCapacity = maxTriads != null && programmeGroupCount >= maxTriads;

  const createTriad = async () => {
    if (!cohort || !m1 || !m2 || !m3 || m1 === m2 || m1 === m3 || m2 === m3) return;
    if (atCapacity) {
      toast.error(t("triads.maxTriadsReached", { max: maxTriads }));
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("triad_groups").insert({
      cohort_id: cohort.id,
      programme_id: cohort.programme_id,
      name: newName.trim() || null,
      member_1_id: m1,
      member_2_id: m2,
      member_3_id: m3,
    });
    setBusy(false);
    if (error) {
      toast.error(getFriendlyErrorMessage(error, t, { fallback: t("triads.saveFailed") }));
      return;
    }
    toast.success(t("triads.saved"));
    setCreateOpen(false);
    loadCohortData(cohortId);
  };

  const autoAssign = async () => {
    if (!cohort) return;
    setBusy(true);
    const pool = [...unassigned];
    const rows: { cohort_id: string; programme_id: string | null; member_1_id: string; member_2_id: string; member_3_id: string }[] = [];
    while (pool.length >= 3) {
      const [a, b, c] = pool.splice(0, 3);
      rows.push({ cohort_id: cohort.id, programme_id: cohort.programme_id, member_1_id: a.id, member_2_id: b.id, member_3_id: c.id });
    }
    if (rows.length === 0) {
      setBusy(false);
      toast.info(t("triads.noneToAssign"));
      return;
    }
    if (maxTriads != null) {
      const capacity = Math.max(0, maxTriads - programmeGroupCount);
      if (capacity === 0) {
        setBusy(false);
        toast.error(t("triads.maxTriadsReached", { max: maxTriads }));
        return;
      }
      rows.length = Math.min(rows.length, capacity);
    }
    const { error } = await supabase.from("triad_groups").insert(rows);
    setBusy(false);
    if (error) {
      toast.error(getFriendlyErrorMessage(error, t, { fallback: t("triads.saveFailed") }));
      return;
    }
    toast.success(t("triads.autoAssigned", { count: rows.length }));
    loadCohortData(cohortId);
  };

  const toggleActive = async (group: TriadGroupRow) => {
    setBusy(true);
    const { error } = await supabase.from("triad_groups").update({ is_active: !group.is_active }).eq("id", group.id);
    setBusy(false);
    if (error) {
      toast.error(getFriendlyErrorMessage(error, t, { fallback: t("triads.saveFailed") }));
      return;
    }
    toast.success(t("triads.saved"));
    loadCohortData(cohortId);
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const activeCount = groups.filter((g) => g.is_active).length;
  const totalSessions = [...sessionCountByGroup.values()].reduce((a, b) => a + b, 0);

  return (
    <div>
      <AdminPageHeader eyebrow={t("triads.eyebrow")} title={t("triads.title")} subtitle={t("triads.subtitle")} />

      <div className="mb-6 max-w-xs">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("triads.cohortLabel")}</p>
        <Select value={cohortId} onValueChange={setCohortId}>
          <SelectTrigger>
            <SelectValue placeholder={t("triads.selectCohortPrompt")} />
          </SelectTrigger>
          <SelectContent>
            {cohorts.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!cohortId ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">{t("triads.selectCohortPrompt")}</Card>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <Kpi label={t("triads.kpiGroups")} value={activeCount} icon={Users} tone="primary" />
            <Kpi label={t("triads.kpiParticipants")} value={groupedMemberIds.size} icon={CheckCircle2} tone="success" />
            <Kpi label={t("triads.kpiSessions")} value={totalSessions} icon={Shuffle} tone="secondary" />
          </div>

          {maxTriads != null && (
            <p className="mb-3 text-[11px] text-muted-foreground">
              {t("triads.programmeLimit", { count: programmeGroupCount, max: maxTriads })}
            </p>
          )}

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("triads.title")}</p>
            <div className="flex gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={busy || atCapacity}>
                    <Shuffle className="mr-1.5 h-3.5 w-3.5" /> {t("triads.autoAssign")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("triads.autoAssignConfirmTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>{t("triads.autoAssignConfirmBody")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("triads.cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={autoAssign}>{t("triads.autoAssign")}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button size="sm" onClick={openCreate} disabled={busy || unassigned.length < 3 || atCapacity}>
                <UserPlus className="mr-1.5 h-3.5 w-3.5" /> {t("triads.createGroup")}
              </Button>
            </div>
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-semibold">{t("triads.tableHeaders.group")}</th>
                    <th className="px-3 py-2.5 text-left font-semibold">{t("triads.tableHeaders.members")}</th>
                    <th className="px-3 py-2.5 text-left font-semibold">{t("triads.tableHeaders.status")}</th>
                    <th className="px-3 py-2.5 text-left font-semibold">{t("triads.tableHeaders.sessions")}</th>
                    <th className="px-3 py-2.5 text-left font-semibold">{t("triads.tableHeaders.reflectionRate")}</th>
                    <th className="px-3 py-2.5 text-right font-semibold">{t("triads.tableHeaders.actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {groups.map((g, i) => {
                    const sessions = sessionCountByGroup.get(g.id) || 0;
                    const reflections = reflectionCountByGroup.get(g.id) || 0;
                    const expected = sessions * 3;
                    return (
                      <tr key={g.id} className="hover:bg-muted/30">
                        <td className="px-3 py-2.5 font-medium">{g.name || `${t("triads.title")} ${i + 1}`}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex -space-x-1.5">
                            {[g.member_1_id, g.member_2_id, g.member_3_id].map((id) => (
                              <Avatar key={id} name={nameById.get(id) || "?"} />
                            ))}
                          </div>
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {[g.member_1_id, g.member_2_id, g.member_3_id].map((id) => nameById.get(id) || "—").join(", ")}
                          </p>
                        </td>
                        <td className="px-3 py-2.5">
                          <Pill tone={g.is_active ? "success" : "muted"}>{g.is_active ? t("triads.active") : t("triads.inactive")}</Pill>
                        </td>
                        <td className="px-3 py-2.5">{sessions}</td>
                        <td className="px-3 py-2.5">{expected > 0 ? t("triads.reflectionsOf", { done: reflections, total: expected }) : "—"}</td>
                        <td className="px-3 py-2.5 text-right">
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => toggleActive(g)}>
                            {g.is_active ? (
                              <>
                                <XCircle className="mr-1 h-3.5 w-3.5" /> {t("triads.deactivate")}
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> {t("triads.reactivate")}
                              </>
                            )}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {groups.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-sm text-muted-foreground">{t("triads.empty")}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("triads.dialogTitleNew")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("triads.nameLabel")}</p>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("triads.namePlaceholder")} />
            </div>
            {[
              { label: t("triads.member1"), value: m1, onChange: setM1 },
              { label: t("triads.member2"), value: m2, onChange: setM2 },
              { label: t("triads.member3"), value: m3, onChange: setM3 },
            ].map((field, idx) => (
              <div key={idx}>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{field.label}</p>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("triads.selectMember")} />
                  </SelectTrigger>
                  <SelectContent>
                    {unassigned.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            {(m1 || m2 || m3) && (m1 === m2 || m1 === m3 || m2 === m3) && (
              <p className="text-xs text-destructive">{t("triads.membersMustDiffer")}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("triads.cancel")}</Button>
            <Button onClick={createTriad} disabled={busy || !m1 || !m2 || !m3 || m1 === m2 || m1 === m3 || m2 === m3}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t("triads.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
