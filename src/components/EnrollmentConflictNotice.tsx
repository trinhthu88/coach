import { Link } from "react-router-dom";
import type { OngoingEnrollmentConflict } from "@/lib/enrollments";

interface EnrollmentConflictNoticeProps {
  conflict: OngoingEnrollmentConflict;
  reviewHref: string;
}

const statusLabel: Record<OngoingEnrollmentConflict["status"], string> = {
  active: "Active",
  at_risk: "At risk",
  paused: "Paused",
};

export function EnrollmentConflictNotice({ conflict, reviewHref }: EnrollmentConflictNoticeProps) {
  return (
    <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
      <h3 className="font-semibold">Enrollment already in progress</h3>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Programme</dt>
        <dd>{conflict.programmeName ?? conflict.programmeId}</dd>
        <dt className="text-muted-foreground">Cohort</dt>
        <dd>{conflict.cohortName ?? conflict.cohortId ?? "—"}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd>{statusLabel[conflict.status]}</dd>
        <dt className="text-muted-foreground">Start date</dt>
        <dd>{conflict.startDate}</dd>
        <dt className="text-muted-foreground">End date</dt>
        <dd>{conflict.endDate ?? "—"}</dd>
      </dl>
      <Link className="mt-4 inline-flex text-primary underline-offset-4 hover:underline" to={reviewHref}>
        Review enrollment
      </Link>
    </section>
  );
}
