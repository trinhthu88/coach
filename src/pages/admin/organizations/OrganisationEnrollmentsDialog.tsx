import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Database } from "@/integrations/supabase/types";
import { Pill } from "../_shared";

type EnrollmentRow = Database["public"]["Functions"]["admin_organization_enrollments"]["Returns"][number];

const STATUS_TONE: Record<string, "success" | "warning" | "muted" | "destructive" | "primary"> = {
  active: "primary",
  at_risk: "destructive",
  paused: "warning",
  completed: "success",
};

/**
 * Every enrollment of one organisation (admin_organization_enrollments): the
 * leaders are the enrollments whose organization_id is this organisation --
 * the same relationship Sponsor visibility uses -- with each enrollment's
 * canonical progress. A cohort may mix organisations; the cohort is shown,
 * never used to decide membership.
 */
export function OrganisationEnrollmentsDialog({
  organisation,
  onClose,
}: {
  organisation: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("admin");
  const [rows, setRows] = useState<EnrollmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!organisation) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    supabase
      .rpc("admin_organization_enrollments", { p_organization_id: organisation.id })
      .then(({ data, error: rpcError }) => {
        if (cancelled) return;
        if (rpcError) setError(true);
        setRows(data ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organisation]);

  const ongoing = rows.filter((r) => r.is_ongoing);
  const historical = rows.filter((r) => !r.is_ongoing);

  const table = (list: EnrollmentRow[]) => (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-[12px]">
        <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">{t("organizations.leaders.leader")}</th>
            <th className="px-3 py-2 text-left font-semibold">{t("organizations.leaders.cohort")}</th>
            <th className="px-3 py-2 text-left font-semibold">{t("organizations.leaders.status")}</th>
            <th className="px-3 py-2 text-left font-semibold">{t("organizations.leaders.progress")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {list.map((r) => (
            <tr key={r.enrollment_id} data-testid="organisation-enrollment">
              <td className="px-3 py-2">
                <Link to={`/admin/coachees/${r.user_id}`} className="font-medium text-foreground hover:text-primary hover:underline">
                  {r.learner_name ?? "—"}
                </Link>
                <p className="text-[10px] text-muted-foreground">{r.learner_email}</p>
              </td>
              <td className="px-3 py-2">
                <p>{r.cohort_name ?? "—"}</p>
                <p className="text-[10px] text-muted-foreground">{r.programme_name}</p>
              </td>
              <td className="px-3 py-2">
                <Pill tone={STATUS_TONE[r.effective_enrollment_status ?? r.stored_enrollment_status] ?? "muted"}>
                  {t(`coachees.enrollmentStatus.${r.effective_enrollment_status ?? r.stored_enrollment_status}`, {
                    defaultValue: r.effective_enrollment_status ?? r.stored_enrollment_status,
                  })}
                </Pill>
              </td>
              <td className="px-3 py-2 font-mono text-[11px]">
                {r.progress_available ? (
                  <>
                    {r.completed_units}/{r.required_units}
                    {r.overdue_units > 0 && (
                      <span className="ml-1.5 font-sans text-[10px] text-destructive">
                        {t("organizations.leaders.overdue", { count: r.overdue_units })}
                      </span>
                    )}
                  </>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <Dialog open={!!organisation} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("organizations.leaders.title", { name: organisation?.name ?? "" })}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : error ? (
          <p role="alert" className="text-sm text-destructive">{t("organizations.leaders.loadError")}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("organizations.leaders.empty")}</p>
        ) : (
          <div className="space-y-4">
            <section>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("organizations.leaders.ongoing", { count: ongoing.length })}
              </p>
              {ongoing.length > 0 ? table(ongoing) : <p className="text-[12px] text-muted-foreground">—</p>}
            </section>
            {historical.length > 0 && (
              <section>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("organizations.leaders.historical", { count: historical.length })}
                </p>
                {table(historical)}
              </section>
            )}
            <p className="text-[10.5px] text-muted-foreground">{t("organizations.leaders.note")}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
