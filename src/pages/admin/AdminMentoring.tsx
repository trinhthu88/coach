import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { Loader2, Search, Users, Pencil, Save, Handshake } from "lucide-react";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { AdminPageHeader, Kpi, Pill, Avatar, TablePager } from "./_shared";
import { usePagination } from "@/hooks/use-pagination";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";

type Role = "coach" | "coachee";

interface AccessRow {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  mentoring_enabled: boolean;
  assigned_mentors: { id: string; name: string }[];
}

const PAGE_SIZE = 25;

export default function AdminMentoring() {
  const { t } = useTranslation("admin");
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<AccessRow[]>([]);

  const [accessQ, setAccessQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all");

  const [editingAccess, setEditingAccess] = useState<AccessRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  /** Distinct Coaches assigned as Mentor for at least one cohort. */
  const [cohortMentorCount, setCohortMentorCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const [
      { data: roles },
      { data: profiles },
      { data: allowlist },
      { data: moduleAccess },
      { data: cohortMentorRows },
    ] = await Promise.all([
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("profiles").select("id, full_name, email"),
      supabase.from("mentoring_allowlist").select("id, mentee_user_id, mentor_user_id"),
      supabase.from("user_module_access").select("user_id, enabled").eq("module", "mentoring"),
      // Mentor identity is a Coach with a cohort assignment; this is only used
      // for the headline count, never to decide eligibility.
      supabase.from("cohort_mentors").select("mentor_user_id").eq("is_active", true),
    ]);

    const profileById = new Map((profiles || []).map((p) => [p.id, p]));
    const coachIds = (roles || []).filter((r) => r.role === "coach").map((r) => r.user_id);
    const coacheeIds = (roles || []).filter((r) => r.role === "coachee").map((r) => r.user_id);
    const coachNameById = new Map<string, string>();
    coachIds.forEach((id) => {
      const p = profileById.get(id);
      if (p) coachNameById.set(id, p.full_name);
    });

    const menteeCountByMentor = new Map<string, number>();
    const mentorsByMentee = new Map<string, { id: string; name: string }[]>();
    (allowlist || []).forEach((a) => {
      menteeCountByMentor.set(a.mentor_user_id, (menteeCountByMentor.get(a.mentor_user_id) || 0) + 1);
      const arr = mentorsByMentee.get(a.mentee_user_id) || [];
      arr.push({ id: a.mentor_user_id, name: coachNameById.get(a.mentor_user_id) || "—" });
      mentorsByMentee.set(a.mentee_user_id, arr);
    });

    const enabledByUser = new Map((moduleAccess || []).map((m) => [m.user_id, m.enabled]));

    const accessRows: AccessRow[] = [...coachIds, ...coacheeIds]
      .map((id) => {
        const p = profileById.get(id);
        if (!p) return null;
        return {
          id,
          full_name: p.full_name,
          email: p.email,
          role: coachIds.includes(id) ? "coach" : "coachee",
          mentoring_enabled: enabledByUser.get(id) ?? false,
          assigned_mentors: mentorsByMentee.get(id) || [],
        } as AccessRow;
      })
      .filter(Boolean) as AccessRow[];

    setCohortMentorCount(
      new Set((cohortMentorRows || []).map((r) => r.mentor_user_id)).size,
    );
    setAccess(accessRows.sort((a, b) => a.full_name.localeCompare(b.full_name)));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);


  const filteredAccess = useMemo(() => access.filter((a) => {
    const query = accessQ.trim().toLowerCase();
    const okQ = !query || a.full_name.toLowerCase().includes(query) || a.email.toLowerCase().includes(query);
    const okR = roleFilter === "all" || a.role === roleFilter;
    return okQ && okR;
  }), [access, accessQ, roleFilter]);

  const accessPager = usePagination(filteredAccess, [accessQ, roleFilter], PAGE_SIZE);

  const toggleModuleAccess = async (row: AccessRow, next: boolean) => {
    try {
      const { error } = await supabase
        .from("user_module_access")
        .upsert(
          { user_id: row.id, module: "mentoring", enabled: next, updated_by: user?.id },
          { onConflict: "user_id,module" }
        );
      if (error) throw error;
      toast.success(t("mentoring.saved"));
      await load();
    } catch (e) {
      toast.error(getFriendlyErrorMessage(e, t, { fallback: t("mentoring.saveFailed") }));
    }
  };

  const saveAccessEdit = async () => {
    if (!editingAccess) return;
    setSaving(true);
    try {
      await supabase
        .from("user_module_access")
        .upsert(
          { user_id: editingAccess.id, module: "mentoring", enabled: editingAccess.mentoring_enabled, updated_by: user?.id },
          { onConflict: "user_id,module" }
        );

      // assigned_mentors is no longer editable here: programme Mentoring
      // eligibility is the COHORT mentor pool (Admin -> Cohorts -> Mentoring),
      // so this save covers module access only and leaves mentoring_allowlist
      // exactly as it is.

      toast.success(t("mentoring.saved"));
      setEditingAccess(null);
      await load();
    } catch (e) {
      toast.error(getFriendlyErrorMessage(e, t, { fallback: t("mentoring.saveFailed") }));
    } finally {
      setSaving(false);
    }
  };

  const bulkEnable = async (role: Role) => {
    setBulkBusy(true);
    try {
      const ids = access.filter((a) => a.role === role).map((a) => a.id);
      if (ids.length) {
        const { error } = await supabase.from("user_module_access").upsert(
          ids.map((id) => ({ user_id: id, module: "mentoring", enabled: true, updated_by: user?.id })),
          { onConflict: "user_id,module" }
        );
        if (error) throw error;
      }
      toast.success(t("mentoring.bulkEnabled", { count: ids.length }));
      await load();
    } catch (e) {
      toast.error(getFriendlyErrorMessage(e, t, { fallback: t("mentoring.saveFailed") }));
    } finally {
      setBulkBusy(false);
    }
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const totalMentors = cohortMentorCount;
  const totalWithAccess = access.filter((a) => a.mentoring_enabled).length;
  const totalPairs = access.reduce((sum, a) => sum + a.assigned_mentors.length, 0);

  return (
    <div>
      <AdminPageHeader
        eyebrow={t("mentoring.eyebrow")}
        title={t("mentoring.title")}
        emphasize={t("mentoring.titleEmphasis")}
        trailing=""
        subtitle={t("mentoring.subtitle")}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Kpi label={t("mentoring.kpiMentors")} value={totalMentors} icon={Users} tone="primary" />
        <Kpi label={t("mentoring.kpiWithAccess")} value={totalWithAccess} icon={Handshake} tone="success" />
        <Kpi label={t("mentoring.kpiPairs")} value={totalPairs} icon={Handshake} tone="secondary" />
      </div>

      {/* Mentor assignment lives with the cohort, not here.
          A Mentor is not a separate account: it is a Coach with a Mentoring
          assignment for a specific cohort. This page used to create and toggle
          mentor_profiles rows, which made "Mentor" look like its own provider
          identity and meant a Coach without one could not be assigned at all. */}
      <Card className="mb-6 p-4 sm:p-5" data-testid="mentoring-assignment-notice">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("mentoring.mentorsSection")}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("mentoring.assignmentMovedBody")}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/cohorts">{t("mentoring.goToCohorts")}</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/coaches">{t("mentoring.goToCoaches")}</Link>
          </Button>
        </div>
      </Card>

      {/* Access & pairing */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("mentoring.accessSection")}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={bulkBusy} onClick={() => bulkEnable("coach")}>
            {t("mentoring.bulkEnableCoaches")}
          </Button>
          <Button variant="outline" size="sm" disabled={bulkBusy} onClick={() => bulkEnable("coachee")}>
            {t("mentoring.bulkEnableCoachees")}
          </Button>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-64 flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={accessQ} onChange={(e) => setAccessQ(e.target.value)} placeholder={t("mentoring.searchPlaceholder")} className="pl-9" />
        </div>
        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as "all" | Role)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("mentoring.allRoles")}</SelectItem>
            <SelectItem value="coach">{t("mentoring.roleCoach")}</SelectItem>
            <SelectItem value="coachee">{t("mentoring.roleCoachee")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold">{t("mentoring.tableHeaders.user")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("mentoring.tableHeaders.role")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("mentoring.tableHeaders.access")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("mentoring.tableHeaders.assignedMentors")}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{t("mentoring.tableHeaders.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {accessPager.paged.map((a) => (
                <tr key={a.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Avatar name={a.full_name} />
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-medium text-foreground">{a.full_name}</p>
                        <p className="truncate text-[10px] text-muted-foreground">{a.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5"><Pill tone={a.role === "coach" ? "secondary" : "primary"}>{t(`mentoring.role${a.role === "coach" ? "Coach" : "Coachee"}`)}</Pill></td>
                  <td className="px-3 py-2.5"><Switch checked={a.mentoring_enabled} onCheckedChange={(v) => toggleModuleAccess(a, v)} /></td>
                  <td className="px-3 py-2.5 text-[11px]">
                    {a.assigned_mentors.length === 0 ? <span className="italic text-muted-foreground">—</span> : t("mentoring.assignedMentorsCount", { count: a.assigned_mentors.length })}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Button variant="ghost" size="icon" title={t("mentoring.edit")} aria-label={t("mentoring.edit")} onClick={() => setEditingAccess({ ...a, assigned_mentors: [...a.assigned_mentors] })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
              {filteredAccess.length === 0 && (
                <tr><td colSpan={5} className="p-12 text-center text-sm text-muted-foreground">{t("mentoring.noMatch")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePager page={accessPager.page} totalPages={accessPager.totalPages} onChange={accessPager.setPage} />
      </Card>

      {/* Edit mentor drawer */}

      {/* Edit access & pairing drawer */}
      <Sheet open={!!editingAccess} onOpenChange={(o) => !o && setEditingAccess(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("mentoring.editAccess")}</SheetTitle>
            <SheetDescription>{editingAccess?.email}</SheetDescription>
          </SheetHeader>
          {editingAccess && (
            <div className="mt-4 space-y-5">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <p className="text-[12px] font-medium">{t("mentoring.moduleAccessLabel")}</p>
                <Switch
                  checked={editingAccess.mentoring_enabled}
                  onCheckedChange={(v) => setEditingAccess({ ...editingAccess, mentoring_enabled: v })}
                />
              </div>
              {/* Programme Mentoring eligibility is the COHORT mentor pool
                  (Admin -> Cohorts -> Mentoring), not a per-learner pairing.
                  The checkbox list that used to live here wrote
                  mentoring_allowlist, which no longer governs programme
                  Mentoring -- leaving it would let an Admin make an assignment
                  that changes nothing. The allowlist rows are untouched: they
                  remain historical attribution and still grant mentor-profile
                  visibility for past pairings. */}
              <div className="rounded-lg border border-dashed p-3">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("mentoring.assignedMentorsLabel")}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t("mentoring.mentorAssignmentMovedToCohort")}
                </p>
              </div>
            </div>
          )}
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setEditingAccess(null)}>{t("mentoring.cancel")}</Button>
            <Button onClick={saveAccessEdit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t("mentoring.save")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
