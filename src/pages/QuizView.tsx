import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useQuiz, QuizQuestion } from "@/hooks/training/useQuiz";

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];

export default function QuizView() {
  const { weekId, assignmentId } = useParams<{ weekId: string; assignmentId: string }>();
  const { t, i18n } = useTranslation("training");
  const isVi = i18n.language?.startsWith("vi");
  const { assignment, questions, submission, loading, submitting, submit } = useQuiz(assignmentId);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!assignment) {
    return (
      <div className="mx-auto max-w-2xl">
        <BackLink weekId={weekId} t={t} />
        <Card className="mt-6 p-12 text-center text-sm text-muted-foreground">{t("card.notFound")}</Card>
      </div>
    );
  }

  const title = (isVi && assignment.title_vi) || assignment.title;
  const instructions = (isVi && assignment.instructions_vi) || assignment.instructions;
  const allAnswered = questions.length > 0 && questions.every((q) => !!answers[q.id]);
  const current = questions[currentIndex];
  const progressPct = questions.length > 0 ? ((currentIndex + 1) / questions.length) * 100 : 0;

  return (
    <div className="mx-auto max-w-[760px]">
      <BackLink weekId={weekId} t={t} />

      <header className="animate-rise mb-6 mt-4">
        <p className="eyebrow mb-2.5">{t("quiz.title")}</p>
        <h1 className="font-display text-[clamp(1.7rem,3.4vw,2.3rem)] leading-[1.1] text-foreground">{title}</h1>
        {instructions && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{instructions}</p>}
      </header>

      {submission ? (
        <div className="space-y-4">
          <Card className="rounded-[22px] border-[#e8e2d8] p-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("quiz.yourScore")}</p>
            <p className="font-display mt-1 text-3xl text-foreground">
              {submission.score_pct}% <span className="text-base font-normal text-muted-foreground">({submission.correct_count}/{submission.total_count})</span>
            </p>
          </Card>
          {questions.map((q) => (
            <QuestionResult key={q.id} question={q} selectedId={submission.answers[q.id]} isVi={isVi} t={t} />
          ))}
        </div>
      ) : current ? (
        <div>
          <div className="h-[5px] overflow-hidden rounded-full bg-[#e6e0d6]">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
          </div>

          <Card className="mt-5 rounded-[22px] border-[#e8e2d8] p-[26px] shadow-[0_14px_40px_-30px_rgba(6,47,62,0.5)] sm:p-8">
            <QuestionInput
              index={currentIndex}
              question={current}
              selectedId={answers[current.id]}
              onSelect={(optionId) => setAnswers((prev) => ({ ...prev, [current.id]: optionId }))}
              isVi={isVi}
            />
          </Card>

          <div className="mt-5 flex items-center justify-between gap-4">
            <Button
              variant="outline"
              onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
              disabled={currentIndex === 0}
            >
              {t("quiz.previous")}
            </Button>

            <div className="flex items-center gap-2">
              {questions.map((q, idx) => (
                <button
                  key={q.id}
                  type="button"
                  aria-label={t("quiz.jumpToQuestion", { n: idx + 1 })}
                  onClick={() => setCurrentIndex(idx)}
                  className={cn(
                    "h-2 w-2 rounded-full transition-colors",
                    idx === currentIndex ? "bg-primary" : answers[q.id] ? "bg-[#2c8fa8]" : "bg-[#e2dbd0]"
                  )}
                />
              ))}
            </div>

            {currentIndex < questions.length - 1 ? (
              <Button onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))} disabled={!answers[current.id]}>
                {t("quiz.next")}
              </Button>
            ) : (
              <Button onClick={() => submit(answers)} disabled={!allAnswered || submitting}>
                {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {t("quiz.submit")}
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BackLink({ weekId, t }: { weekId: string | undefined; t: (key: string) => string }) {
  return (
    <Link to={`/training/${weekId}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-[#2c8fa8]">
      <ArrowLeft className="h-4 w-4" /> {t("card.back")}
    </Link>
  );
}

function QuestionInput({
  index,
  question,
  selectedId,
  onSelect,
  isVi,
}: {
  index: number;
  question: QuizQuestion;
  selectedId: string | undefined;
  onSelect: (optionId: string) => void;
  isVi: boolean;
}) {
  const text = (isVi && question.question_text_vi) || question.question_text;
  return (
    <div>
      <p className="text-[19px] font-medium leading-[1.45] text-foreground">
        {index + 1}. {text}
      </p>
      <div role="radiogroup" aria-label={text} className="mt-5 space-y-2.5">
        {question.options.map((opt, i) => {
          const isSelected = selectedId === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(opt.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-[14px] border-[1.5px] px-[18px] py-4 text-left text-[14.5px] transition-colors",
                isSelected ? "border-primary bg-primary-soft" : "border-[#e8e2d8] hover:bg-muted/30"
              )}
            >
              <span
                className={cn(
                  "grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px] text-[11px] font-bold",
                  isSelected ? "bg-primary text-secondary" : "bg-[#f2eee6] text-[#4a463f]"
                )}
              >
                {OPTION_LETTERS[i] ?? i + 1}
              </span>
              {(isVi && opt.text_vi) || opt.text}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function QuestionResult({
  question,
  selectedId,
  isVi,
  t,
}: {
  question: QuizQuestion;
  selectedId: string | undefined;
  isVi: boolean;
  t: (key: string) => string;
}) {
  const text = (isVi && question.question_text_vi) || question.question_text;
  const explanation = (isVi && question.explanation_vi) || question.explanation;
  const correctOption = question.options.find((o) => o.is_correct);
  const wasCorrect = selectedId === correctOption?.id;

  return (
    <Card className={cn("rounded-[22px] p-5", wasCorrect ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5")}>
      <div className="mb-2 flex items-start gap-2">
        {wasCorrect ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        ) : (
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        )}
        <p className="text-sm font-semibold text-foreground">{text}</p>
      </div>
      <div className="ml-6 space-y-1 text-sm">
        {question.options.map((opt) => {
          const label = (isVi && opt.text_vi) || opt.text;
          const isSelected = selectedId === opt.id;
          return (
            <p
              key={opt.id}
              className={cn(
                opt.is_correct ? "font-semibold text-success" : isSelected ? "font-semibold text-destructive" : "text-muted-foreground"
              )}
            >
              {label}
              {opt.is_correct && ` — ${t("quiz.correct")}`}
              {!opt.is_correct && isSelected && ` — ${t("quiz.incorrect")}`}
            </p>
          );
        })}
      </div>
      {explanation && (
        <p className="ml-6 mt-2 text-xs text-muted-foreground">
          <span className="font-semibold">{t("quiz.explanation")}:</span> {explanation}
        </p>
      )}
    </Card>
  );
}
