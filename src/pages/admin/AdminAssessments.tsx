import { useTranslation } from "react-i18next";
import { AdminPageHeader } from "./_shared";
import { AssessmentQueue } from "./assessments/AssessmentQueue";

/** Admin -> Assessments: every Triad submission and Final Assessment, on admin_assessment_queue. */
export default function AdminAssessments() {
  const { t } = useTranslation("admin");
  return (
    <div>
      <AdminPageHeader eyebrow={t("assessments.eyebrow")} title={t("assessments.title")} subtitle={t("assessments.subtitle")} />
      <AssessmentQueue />
    </div>
  );
}
