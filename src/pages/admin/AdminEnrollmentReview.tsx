import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";

export default function AdminEnrollmentReview() {
  const { userId, enrollmentId } = useParams<{ userId: string; enrollmentId: string }>();
  const { selectedEnrollment, loading } = useEnrollmentContext(userId, enrollmentId);

  if (loading) return <PageSkeleton />;

  if (!selectedEnrollment) {
    return (
      <div className="space-y-4 p6">
        <p className="text-sm text-muted-foreground">The selected enrollment could not be found.</p>
        <Button asChild variant="outline"><Link to="/admin/coachees">Back to coachees</Link></Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div>
        <p className="text-sm text-muted-foreground">Enrollment review</p>
        <h1 className="text-2xl font-semibold">Enrollment details</h1>
      </div>
      <Card className="max-w-xl p5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Status</dt><dd>{selectedEnrollment.status}</dd>
          <dt className="text-muted-foreground">Start date</dt><dd>{selectedEnrollment.start_date}</dd>
          <dt className="text-muted-foreground">End date</dt><dd>{selectedEnrollment.end_date ?? "—"}</dd>
          <dt className="text-muted-foreground">Programme ID</dt><dd>{selectedEnrollment.programme_id}</dd>
          <dt className="text-muted-foreground">Cohort ID</dt><dd>{selectedEnrollment.cohort_id ?? "—"}</dd>
        </dl>
      </Card>
      <Button asChild variant="outline"><Link to="/admin/coachees">Back to coachees</Link></Button>
    </div>
  );
}
