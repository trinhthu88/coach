import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Download,
  CheckCircle2,
  Loader2,
  Lightbulb,
  MessageSquareQuote,
  BookMarked,
  Video,
  Info,
  ListChecks,
  NotebookPen,
  ArrowUpRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useSkillCard, SkillCardElement, SkillCardElementType } from "@/hooks/training/useSkillCard";
import { useAssignments, AssignmentListItem } from "@/hooks/training/useAssignments";

export default function SkillCardView() {
  const { weekId } = useParams<{ weekId: string }>();
  const { t, i18n } = useTranslation("training");
  const isVi = i18n.language?.startsWith("vi");
  const { week, elements, progress, loading, completing, markComplete, downloadPdf } = useSkillCard(weekId);
  const { assignments, loading: assignmentsLoading } = useAssignments(weekId);

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
    <div className="mx-auto max-w-3xl">
      <BackLink t={t} />

      <header className="animate-rise mt-4 mb-8">
        <p className="eyebrow mb-2.5">{t("list.weekN", { n: week.week_number })}</p>
        <h1 className="font-display text-[clamp(1.9rem,3.8vw,2.7rem)] leading-[1.08] text-foreground">{title}</h1>
        {subtitle && <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}

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
      </header>

      {html && (
        // Skill card HTML is admin-authored only (same trust boundary as an
        // admin already holding full database write access) — never
        // user-submitted content.
        <Card className="p-6 sm:p-8">
          <div
            className="max-w-none text-sm leading-relaxed text-foreground [&_a]:text-primary [&_a]:underline [&_h1]:font-display [&_h1]:text-xl [&_h2]:font-display [&_h2]:text-lg [&_h2]:mt-6 [&_h3]:font-semibold [&_h3]:mt-4 [&_li]:ml-4 [&_ol]:list-decimal [&_p]:mb-3 [&_ul]:list-disc"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </Card>
      )}

      {elements.length > 0 && (
        <div className="mt-6 space-y-3">
          {elements.map((el) => (
            <SkillCardElementBlock key={el.id} element={el} isVi={isVi} t={t} />
          ))}
        </div>
      )}

      {!assignmentsLoading && assignments.length > 0 && (
        <div className="mt-8">
          <p className="eyebrow mb-3">{t("assignments.heading")}</p>
          <div className="space-y-3">
            {assignments.map((a) => (
              <AssignmentCard key={a.id} weekId={weekId!} assignment={a} isVi={isVi} t={t} />
            ))}
          </div>
        </div>
      )}
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
  const isQuiz = assignment.assignment_type === "quiz";
  const Icon = isQuiz ? ListChecks : NotebookPen;
  const href = isQuiz ? `/training/${weekId}/quiz/${assignment.id}` : `/training/${weekId}/reflect/${assignment.id}`;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
      <div className="flex items-center gap-2.5">
        <Icon className="h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">
            {assignment.submitted
              ? isQuiz
                ? t("assignments.quizScored", { score: assignment.score_pct })
                : t("assignments.reflectionSubmitted")
              : isQuiz
              ? t("assignments.quizPending")
              : t("assignments.reflectionPending")}
          </p>
        </div>
      </div>
      <Button asChild variant={assignment.submitted ? "outline" : "default"} size="sm">
        <Link to={href}>
          {assignment.submitted
            ? t("assignments.viewResults")
            : isQuiz
            ? t("assignments.takeQuiz")
            : t("assignments.writeReflection")}
          <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
        </Link>
      </Button>
    </Card>
  );
}

function BackLink({ t }: { t: (key: string) => string }) {
  return (
    <Link to="/training" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-primary">
      <ArrowLeft className="h-4 w-4" /> {t("card.back")}
    </Link>
  );
}

const ELEMENT_ICON: Record<SkillCardElementType, typeof Lightbulb> = {
  expandable_example: BookMarked,
  try_this_prompt: MessageSquareQuote,
  key_concept: Lightbulb,
  video_link: Video,
  tip: Info,
};

function SkillCardElementBlock({
  element,
  isVi,
  t,
}: {
  element: SkillCardElement;
  isVi: boolean;
  t: (key: string) => string;
}) {
  const title = (isVi && element.title_vi) || element.title;
  const content = (isVi && element.content_vi) || element.content;
  const Icon = ELEMENT_ICON[element.element_type];

  if (element.element_type === "expandable_example") {
    return (
      <Card className="px-5">
        <Accordion type="single" collapsible>
          <AccordionItem value={element.id} className="border-b-0">
            <AccordionTrigger className="text-sm font-semibold">
              <span className="inline-flex items-center gap-2">
                <Icon className="h-4 w-4 text-primary" /> {title}
              </span>
            </AccordionTrigger>
            <AccordionContent className="whitespace-pre-wrap text-sm text-muted-foreground">{content}</AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>
    );
  }

  if (element.element_type === "video_link") {
    return (
      <Card className="flex items-center justify-between gap-3 p-5">
        <div className="flex items-center gap-2.5">
          <Icon className="h-4 w-4 shrink-0 text-primary" />
          <p className="text-sm font-semibold">{title}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={content} target="_blank" rel="noreferrer">
            {t("card.watchVideo")}
          </a>
        </Button>
      </Card>
    );
  }

  const tone =
    element.element_type === "try_this_prompt"
      ? "border-primary/30 bg-primary-soft/40"
      : element.element_type === "key_concept"
      ? "border-secondary/30 bg-secondary/5"
      : "border-warning/30 bg-warning/5";

  return (
    <Card className={`${tone} p-5`}>
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-primary" />
        <p className="text-sm font-semibold">{title}</p>
      </div>
      <p className="whitespace-pre-wrap text-sm text-muted-foreground">{content}</p>
    </Card>
  );
}
