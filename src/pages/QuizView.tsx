import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { useQuiz, QuizQuestion } from "@/hooks/training/useQuiz";

export default function QuizView() {
  const { weekId, assignmentId } = useParams<{ weekId: string; assignmentId: string }>();
  const { t, i18n } = useTranslation("training");
  const isVi = i18n.language?.startsWith("vi");
  const { assignment, questions, submission, loading, submitting, submit } = useQuiz(assignmentId);
  const [answers, setAnswers] = useState<Record<string, string>>({});

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

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink weekId={weekId} t={t} />

      <header className="animate-rise mt-4 mb-6">
        <p className="eyebrow mb-2.5">{t("quiz.title")}</p>
        <h1 className="font-display text-[clamp(1.7rem,3.4vw,2.3rem)] leading-[1.1] text-foreground">{title}</h1>
        {instructions && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{instructions}</p>}
      </header>

      {submission ? (
        <div className="space-y-4">
          <Card className="p-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("quiz.yourScore")}</p>
            <p className="font-display mt-1 text-3xl text-foreground">
              {submission.score_pct}% <span className="text-base font-normal text-muted-foreground">({submission.correct_count}/{submission.total_count})</span>
            </p>
          </Card>
          {questions.map((q) => (
            <QuestionResult key={q.id} question={q} selectedId={submission.answers[q.id]} isVi={isVi} t={t} />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {questions.map((q, idx) => (
            <QuestionInput
              key={q.id}
              index={idx}
              question={q}
              selectedId={answers[q.id]}
              onSelect={(optionId) => setAnswers((prev) => ({ ...prev, [q.id]: optionId }))}
              isVi={isVi}
            />
          ))}
          <Button onClick={() => submit(answers)} disabled={!allAnswered || submitting} className="w-full sm:w-auto">
            {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {t("quiz.submit")}
          </Button>
        </div>
      )}
    </div>
  );
}

function BackLink({ weekId, t }: { weekId: string | undefined; t: (key: string) => string }) {
  return (
    <Link to={`/training/${weekId}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-primary">
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
    <Card className="p-5">
      <p className="mb-3 text-sm font-semibold text-foreground">
        {index + 1}. {text}
      </p>
      <RadioGroup value={selectedId} onValueChange={onSelect}>
        <div className="space-y-2">
          {question.options.map((opt) => (
            <label
              key={opt.id}
              htmlFor={`${question.id}-${opt.id}`}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 text-sm transition-colors",
                selectedId === opt.id ? "border-primary bg-primary-soft/40" : "hover:bg-muted/40"
              )}
            >
              <RadioGroupItem value={opt.id} id={`${question.id}-${opt.id}`} />
              {(isVi && opt.text_vi) || opt.text}
            </label>
          ))}
        </div>
      </RadioGroup>
    </Card>
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
    <Card className={cn("p-5", wasCorrect ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5")}>
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
