import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { useSkillCard } from "@/hooks/training/useSkillCard";
import { useWeekReflection, ReflectionAnswerInput } from "@/hooks/training/useReflections";

export default function ReflectionView() {
  const { weekId } = useParams<{ weekId: string }>();
  const { t, i18n } = useTranslation("training");
  const isVi = i18n.language?.startsWith("vi");
  const { week, loading: weekLoading } = useSkillCard(weekId);
  const { reflection, questions, submission, answers, loading, submitting, submit } = useWeekReflection(
    week?.week_number,
    week?.programme_id
  );

  const initialTexts = useMemo(() => {
    const map: Record<string, string> = {};
    answers.forEach((a) => {
      if (a.answer_text != null) map[a.question_id] = a.answer_text;
    });
    return map;
  }, [answers]);
  const initialValues = useMemo(() => {
    const map: Record<string, number> = {};
    answers.forEach((a) => {
      if (a.answer_value != null) map[a.question_id] = a.answer_value;
    });
    return map;
  }, [answers]);

  const [texts, setTexts] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, number>>({});
  const [confidence, setConfidence] = useState(5);

  const getText = (id: string) => texts[id] ?? initialTexts[id] ?? "";
  const getValue = (id: string) => values[id] ?? initialValues[id] ?? 5;

  if (weekLoading || loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!reflection) {
    return (
      <div className="mx-auto max-w-2xl">
        <BackLink weekId={weekId} t={t} />
        <Card className="mt-6 p-12 text-center text-sm text-muted-foreground">{t("card.notFound")}</Card>
      </div>
    );
  }

  const title = (isVi && reflection.title_vi) || reflection.title;
  const instructions = (isVi && reflection.instructions_vi) || reflection.instructions;

  const canSubmit = questions.every((q) => !q.is_required || getText(q.id).trim() || getValue(q.id) != null);

  const handleSubmit = async () => {
    const answerInputs: ReflectionAnswerInput[] = questions.map((q) =>
      q.question_type === "scale_1_10" ? { questionId: q.id, value: getValue(q.id) } : { questionId: q.id, text: getText(q.id) }
    );
    await submit(confidence, answerInputs);
  };

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink weekId={weekId} t={t} />

      <header className="animate-rise mt-4 mb-6">
        <p className="eyebrow mb-2.5">{t("reflection.title")}</p>
        <h1 className="font-display text-[clamp(1.7rem,3.4vw,2.3rem)] leading-[1.1] text-foreground">{title}</h1>
        {instructions && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{instructions}</p>}
      </header>

      {submission ? (
        <div className="space-y-3">
          {questions.map((q) => (
            <Card key={q.id} className="p-5">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                {(isVi && q.question_text_vi) || q.question_text}
              </p>
              {q.question_type === "scale_1_10" ? (
                <p className="font-display text-2xl text-primary">{getValue(q.id)}/10</p>
              ) : (
                <p className="whitespace-pre-wrap text-sm text-foreground">{getText(q.id)}</p>
              )}
            </Card>
          ))}
          <Card className="p-5">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("reflection.confidenceLabel")}</p>
            <p className="font-display text-2xl text-primary">{submission.confidence_score}/10</p>
          </Card>
        </div>
      ) : (
        <Card className="space-y-5 p-5">
          {questions.map((q) => (
            <div key={q.id}>
              <p className="mb-2 text-sm font-semibold text-foreground">
                {(isVi && q.question_text_vi) || q.question_text}
                {q.is_required && <span className="ml-1 text-destructive">*</span>}
              </p>
              {q.question_type === "scale_1_10" ? (
                <div className="flex items-center gap-3">
                  <Slider
                    value={[getValue(q.id)]}
                    min={1}
                    max={10}
                    step={1}
                    onValueChange={(v) => setValues((prev) => ({ ...prev, [q.id]: v[0] }))}
                    className="flex-1"
                  />
                  <span className="font-display w-8 text-right text-2xl text-primary">{getValue(q.id)}</span>
                </div>
              ) : (
                <Textarea
                  rows={4}
                  placeholder={t("reflection.placeholder")}
                  value={getText(q.id)}
                  onChange={(e) => setTexts((prev) => ({ ...prev, [q.id]: e.target.value }))}
                />
              )}
            </div>
          ))}

          <div className="border-t pt-5">
            <p className="mb-2 text-sm font-semibold text-foreground">{t("reflection.confidenceLabel")}</p>
            <div className="flex items-center gap-3">
              <Slider value={[confidence]} min={1} max={10} step={1} onValueChange={(v) => setConfidence(v[0])} className="flex-1" />
              <span className="font-display w-8 text-right text-2xl text-primary">{confidence}</span>
            </div>
            <div className="mt-1.5 flex justify-between text-[10.5px] text-muted-foreground">
              <span>{t("reflection.confidenceLow")}</span>
              <span>{t("reflection.confidenceHigh")}</span>
            </div>
          </div>

          <Button onClick={handleSubmit} disabled={!canSubmit || submitting}>
            {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {t("reflection.submit")}
          </Button>
        </Card>
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
