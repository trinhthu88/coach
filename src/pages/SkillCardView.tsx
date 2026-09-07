import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Download, CheckCircle2, Loader2, ListChecks, NotebookPen, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSkillCard } from "@/hooks/training/useSkillCard";
import { useAssignments, AssignmentListItem } from "@/hooks/training/useAssignments";
import { useWeekReflection } from "@/hooks/training/useReflections";

export default function SkillCardView() {
  const { weekId } = useParams<{ weekId: string }>();
  const { t, i18n } = useTranslation("training");
  const isVi = i18n.language?.startsWith("vi");
  const { week, progress, loading, completing, markComplete, downloadPdf } = useSkillCard(weekId);
  const { assignments, loading: assignmentsLoading } = useAssignments(weekId);
  const { reflection, submission: reflectionSubmission, loading: reflectionLoading } = useWeekReflection(
    week?.week_number,
    week?.programme_id
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!week) {
    return (
      <div>
        <BackLink t={t} />
        <Card className="mt-6 p-12 text-center text-sm text-muted-foreground">{t("card.notFound")}</Card>
      </div>
    );
  }

  const title = (isVi && week.title_vi) || week.title;
  const subtitle = (isVi && week.subtitle_vi) || week.subtitle;
  const html = (isVi && week.skill_card_html_vi) || week.skill_card_html;
  const pdfPath = (isVi && week.pdf_storage_path_vi) || week.pdf_storage_path;
  const isCompleted = !!progress?.completed_at;

  return (
    <div className="mx-auto max-w-[780px]">
      <BackLink t={t} />

      <header className="animate-rise mb-6 mt-4">
        <p className="text-[9.5px] font-bold uppercase tracking-[.22em] text-muted-foreground">{t("list.weekN", { n: week.week_number })}</p>
        <h1 className="font-display mt-2 text-[clamp(1.9rem,3.8vw,2.7rem)] leading-[1.08] text-foreground">{title}</h1>

        {week.skill_card_visible && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {pdfPath && (
              <Button variant="outline" onClick={() => downloadPdf(pdfPath)}>
                <Download className="mr-1.5 h-4 w-4" /> {t("card.downloadPdf")}
              </Button>
            )}
            <Button onClick={markComplete} disabled={completing || isCompleted} variant={isCompleted ? "secondary" : "default"}>
              {completing ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
              )}
              {isCompleted ? t("card.completed") : t("card.markComplete")}
            </Button>
          </div>
        )}
      </header>

      {week.skill_card_visible ? (
        <>
          {subtitle && (
            <div className="mb-6 rounded-r-[18px] border-l-4 border-primary bg-primary-soft px-6 py-5">
              <p className="text-[15px] leading-relaxed text-[#1d5a6b]">{subtitle}</p>
            </div>
          )}

          {week.video_url && (
            <div className="mb-6 aspect-video w-full overflow-hidden rounded-xl">
              <iframe
                src={week.video_url}
                className="h-full w-full"
                allowFullScreen
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              />
            </div>
          )}

          {html && (
            // Skill card HTML is admin-authored only (same trust boundary as an
            // admin already holding full database write access) — never
            // user-submitted content.
            <Card className="rounded-[20px] border-[#e8e2d8] p-6 sm:p-[28px]">
              <div
                className="max-w-none text-[15px] leading-[1.7] text-[#2f2b27] [&_a]:text-primary [&_a]:underline [&_h1]:font-display [&_h1]:text-xl [&_h2]:font-display [&_h2]:mt-6 [&_h2]:text-lg [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_p]:mb-3 [&_ul]:list-disc"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </Card>
          )}
        </>
      ) : (
        <Card className="p-6 text-center text-sm text-muted-foreground">{t("card.skillCardUnavailable")}</Card>
      )}

      {(!assignmentsLoading && assignments.length > 0) || (!reflectionLoading && reflection) ? (
        <div className="mt-8">
          <p className="text-[9.5px] font-bold uppercase tracking-[.22em] text-muted-foreground mb-3">{t("assignments.heading")}</p>
          <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
            {assignments.map((a) => (
              <AssignmentCard key={a.id} weekId={weekId!} assignment={a} isVi={isVi} t={t} />
            ))}
            {reflection && (
              <Card className="flex flex-col gap-3 rounded-[18px] border-[#e8e2d8] p-5">
                <div className="flex items-center gap-2.5">
                  <NotebookPen className="h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">{(isVi && reflection.title_vi) || reflection.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {reflectionSubmission ? t("assignments.reflectionSubmitted") : t("assignments.reflectionPending")}
                    </p>
                  </div>
                </div>
                <Button asChild variant={reflectionSubmission ? "outline" : "default"} size="sm" className="w-fit">
                  <Link to={`/training/${weekId}/reflect`}>
                    {reflectionSubmission ? t("assignments.viewResults") : t("assignments.writeReflection")}
                    <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </Card>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AssignmentCard({
  weekId,
  assignment,
  isVi,
  t,
}: {
  weekId: string;
  assignment: AssignmentListItem;
  isVi: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const title = (isVi && assignment.title_vi) || assignment.title;
  const Icon = ListChecks;
  const href = `/training/${weekId}/quiz/${assignment.id}`;

  return (
    <Card className="flex flex-col gap-3 rounded-[18px] border-[#e8e2d8] p-5">
      <div className="flex items-center gap-2.5">
        <Icon className="h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">
            {assignment.submitted ? t("assignments.quizScored", { score: assignment.score_pct }) : t("assignments.quizPending")}
          </p>
        </div>
      </div>
      <Button asChild variant={assignment.submitted ? "outline" : "default"} size="sm" className="w-fit">
        <Link to={href}>
          {assignment.submitted ? t("assignments.viewResults") : t("assignments.takeQuiz")}
          <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
        </Link>
      </Button>
    </Card>
  );
}

function BackLink({ t }: { t: (key: string) => string }) {
  return (
    <Link to="/training" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-[#2c8fa8]">
      <ArrowLeft className="h-4 w-4" /> {t("card.back")}
    </Link>
  );
}
