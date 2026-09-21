import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageSkeleton } from "@/components/PageSkeleton";
import { canonicalCompletionPct, formatPercent, formatProfileDate } from "@/lib/programmeProfile";
import { ONGOING_STATUSES, useAdminUser, type AdminUserEnrollment } from "@/hooks/admin/useAdminUserDetail";
import { AdminPageHeader, Avatar, Pill } from "./_shared";
import { EnrollmentDetailPanel } from "./userDetail/EnrollmentDetailPanel";
import { ENROLLMENT_STATUS_TONE } from "./userDetail/display";

/**
 * Admin → user detail. The person's FULL enrollment history, one expandable
 * section per enrollment (never a blended lifetime view). Each section loads
 * its own canonical data only when opened; see EnrollmentDetailPanel.
 *
 * Also serves /admin/coachees/:userId/enrollments/:enrollmentId (the former
 * single-enrollment review page): that enrollment is opened and scrolled to.
 */
export default function AdminUserDetail() {
  const { t } = useTranslation("admin");
  const { userId, enrollmentId: routeEnrollmentId } = useParams<{ userId: string; enrollmentId?: string }>();
  const [searchParams] = useSearchParams();
  const focusEnrollmentId = routeEnrollmentId ?? searchParams.get("enrollment") ?? undefined;
  const { data, isLoading, error } = useAdminUser(userId);
  const enrollments = useMemo(() => data?.enrollments ?? [], [data]);

  const defaultOpen = useMemo(() => {
    if (focusEnrollmentId && enrollments.some((e) => e.enrollment_id === focusEnrollmentId)) return [focusEnrollmentId];
    const current = enrollments.find((e) => ONGOING_STATUSES.includes(e.stored_enrollment_status));
    return current ? [current.enrollment_id] : [];
  }, [enrollments, focusEnrollmentId]);
  const [open, setOpen] = useState<string[] | null>(null);
  useEffect(() => setOpen(null), [userId, focusEnrollmentId]);
  const openIds = open ?? defaultOpen;

  useEffect(() => {
    if (!focusEnrollmentId || !data) return;
    document.getElementById(`enrollment-${focusEnrollmentId}`)?.scrollIntoView?.({ block: "start" });
  }, [focusEnrollmentId, data]);

  if (isLoading) return <PageSkeleton />;

  const back = (
    <Button asChild variant="outline" size="sm">
      <Link to="/admin/coachees"><ArrowLeft className="h-4 w-4" /> {t("userDetail.back")}</Link>
    </Button>
  );

  if (error || !data) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("userDetail.loadError")}</p>
        {back}
      </div>
    );
  }

  const name = data.profile?.full_name || data.profile?.email || t("userDetail.unknownUser");

  return (
    <div>
      <AdminPageHeader
        eyebrow={t("userDetail.eyebrow")}
        title={name}
        subtitle={data.profile?.email}
        right={back}
      />

      <div className="mb-3 flex items-center gap-2">
        <Avatar name={name} />
        <p className="text-[12px] text-muted-foreground">{t("userDetail.enrollmentCount", { count: enrollments.length })}</p>
      </div>

      {enrollments.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground" data-testid="no-enrollments">
          {t("userDetail.noEnrollments")}
        </Card>
      ) : (
        <Accordion type="multiple" value={openIds} onValueChange={setOpen} className="space-y-3">
          {enrollments.map((enrollment) => (
            <AccordionItem
              key={enrollment.enrollment_id}
              value={enrollment.enrollment_id}
              id={`enrollment-${enrollment.enrollment_id}`}
              data-testid="enrollment-section"
              className="rounded-lg border bg-card px-4"
            >
              <AccordionTrigger className="py-3 hover:no-underline">
                <EnrollmentSummary enrollment={enrollment} />
              </AccordionTrigger>
              <AccordionContent>
                <EnrollmentDetailPanel userId={userId as string} enrollment={enrollment} />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}

function EnrollmentSummary({ enrollment }: { enrollment: AdminUserEnrollment }) {
  const { t } = useTranslation("admin");
  const status = enrollment.effective_enrollment_status;
  const pct = enrollment.progress_available ? canonicalCompletionPct(enrollment.full_completion_pct) : null;
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 pr-3 text-left">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-foreground">{enrollment.programme_name ?? "—"}</p>
        <p className="truncate text-[11px] font-normal text-muted-foreground">
          {[enrollment.cohort_name, enrollment.organization_name].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>
      <span className="text-[11px] font-normal text-muted-foreground">
        {formatProfileDate(enrollment.start_date)} – {enrollment.end_date ? formatProfileDate(enrollment.end_date) : t("userDetail.noEndDate")}
      </span>
      <Pill tone={ENROLLMENT_STATUS_TONE[status] ?? "muted"}>{t(`userDetail.status.${status}`, { defaultValue: status })}</Pill>
      <span className="ml-auto text-[11px] font-normal text-muted-foreground" data-testid="enrollment-completion">
        {t("userDetail.completion", { value: formatPercent(pct) })}
      </span>
    </div>
  );
}
