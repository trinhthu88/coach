import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { useAssessmentFileUrl } from "@/hooks/assessments/useAssessmentFileUrl";

/** A file in the private assessment bucket, opened through a short-lived signed URL. */
export function AssessmentFileLink({ path, label }: { path: string; label?: string }) {
  const { t } = useTranslation("assessments");
  const { data: url, isError } = useAssessmentFileUrl(path);
  const name = label ?? path.split("/").pop() ?? path;
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
          {name}
        </a>
      ) : isError ? (
        <span className="text-destructive">{t("fileError")}</span>
      ) : (
        <span className="text-muted-foreground">{name}</span>
      )}
    </span>
  );
}
