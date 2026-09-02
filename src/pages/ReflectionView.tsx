import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Loader2, Pencil } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useReflection } from "@/hooks/training/useReflection";

export default function ReflectionView() {
  const { weekId, assignmentId } = useParams<{ weekId: string; assignmentId: string }>();
  const { t, i18n } = useTranslation("training");
  const isVi = i18n.language?.startsWith("vi");
  const { assignment, submission, loading, submitting, submit } = useReflection(assignmentId);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (submission?.reflection_text) setText(submission.reflection_text);
  }, [submission?.reflection_text]);

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
  const showForm = !submission || editing;

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink weekId={weekId} t={t} />

      <header className="animate-rise mt-4 mb-6">
        <p className="eyebrow mb-2.5">{t("reflection.title")}</p>
        <h1 className="font-display text-[clamp(1.7rem,3.4vw,2.3rem)] leading-[1.1] text-foreground">{title}</h1>
        {instructions && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{instructions}</p>}
      </header>

      {showForm ? (
        <Card className="p-5">
          <Textarea
            rows={8}
            placeholder={t("reflection.placeholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-4 flex gap-2">
            <Button onClick={() => submit(text).then(() => setEditing(false))} disabled={!text.trim() || submitting}>
              {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t("reflection.submit")}
            </Button>
            {submission && (
              <Button variant="outline" onClick={() => setEditing(false)}>
                {t("card.back")}
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <Card className="p-5">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("reflection.yourReflection")}</p>
          <p className="whitespace-pre-wrap text-sm text-foreground">{submission!.reflection_text}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => setEditing(true)}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" /> {t("admin.edit")}
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
