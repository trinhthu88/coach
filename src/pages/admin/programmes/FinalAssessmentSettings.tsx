import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { QuizQuestionEditor } from "../training/QuizQuestionEditor";

const FINAL_ASSESSMENT_TRANSCRIPT_MODES = ["none", "optional", "required"] as const;

/**
 * Programme Builder -> Final Assessment. Required / not is the shared Required
 * switch below (one requirement per cohort when required). Media is fixed:
 * MP3 only (audio/mpeg), 50 MB -- the database normalises the config and the
 * bucket and submit function enforce it.
 */
export function FinalAssessmentSettings({
  programmeId,
  config,
  onConfigChange,
}: {
  programmeId: string | undefined;
  config: Record<string, unknown>;
  onConfigChange: (patch: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation("admin");
  const quizEnabled = config.quiz_enabled === true;
  const transcript = typeof config.transcript === "string" ? config.transcript : "optional";
  const passMark = typeof config.pass_mark_pct === "number" ? config.pass_mark_pct : null;

  return (
    <div className="col-span-full space-y-3" data-testid="final-assessment-settings">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div>
          <p className="text-[10.5px] text-muted-foreground">{t("programmes.finalAssessment.media")}</p>
          <p className="text-[12px] font-medium" data-testid="final-assessment-media">{t("programmes.finalAssessment.mediaValue")}</p>
        </div>
        <div>
          <p className="text-[10.5px] text-muted-foreground">{t("programmes.finalAssessment.maxSize")}</p>
          <p className="text-[12px] font-medium">{t("programmes.finalAssessment.maxSizeValue")}</p>
        </div>
      </div>

      <div>
        <Label className="text-[10.5px] text-muted-foreground">{t("programmes.finalAssessment.transcript")}</Label>
        <div className="mt-1 flex flex-wrap gap-3" role="radiogroup" aria-label={t("programmes.finalAssessment.transcript")}>
          {FINAL_ASSESSMENT_TRANSCRIPT_MODES.map((mode) => (
            <label key={mode} className="flex items-center gap-1.5 text-[11px]">
              <input
                type="radio"
                name="final-assessment-transcript"
                value={mode}
                checked={transcript === mode}
                onChange={() => onConfigChange({ transcript: mode })}
              />
              {t(`programmes.finalAssessment.transcriptModes.${mode}`)}
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium">{t("programmes.finalAssessment.quiz")}</p>
          <p className="text-[10px] text-muted-foreground">{t("programmes.finalAssessment.quizHint")}</p>
        </div>
        <Switch
          aria-label={t("programmes.finalAssessment.quiz")}
          checked={quizEnabled}
          onCheckedChange={(v) => onConfigChange({ quiz_enabled: v, pass_mark_pct: v ? passMark ?? 70 : null })}
        />
      </div>
      {quizEnabled && (
        <>
          <div className="max-w-[12rem]">
            <Label htmlFor="final-assessment-pass-mark" className="text-[10.5px] text-muted-foreground">
              {t("programmes.finalAssessment.passMark")}
            </Label>
            <Input
              id="final-assessment-pass-mark"
              type="number"
              min={0}
              max={100}
              step={1}
              value={passMark ?? ""}
              onChange={(e) => onConfigChange({ pass_mark_pct: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </div>
          <FinalAssessmentQuiz programmeId={programmeId} />
        </>
      )}

      <div className="grid gap-2.5 sm:grid-cols-2">
        <div>
          <Label htmlFor="final-assessment-instructions" className="text-[10.5px] text-muted-foreground">
            {t("programmes.finalAssessment.instructions")}
          </Label>
          <Textarea
            id="final-assessment-instructions"
            rows={4}
            value={typeof config.instructions === "string" ? config.instructions : ""}
            onChange={(e) => onConfigChange({ instructions: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="final-assessment-instructions-vi" className="text-[10.5px] text-muted-foreground">
            {t("programmes.finalAssessment.instructionsVi")}
          </Label>
          <Textarea
            id="final-assessment-instructions-vi"
            rows={4}
            value={typeof config.instructions_vi === "string" ? config.instructions_vi : ""}
            onChange={(e) => onConfigChange({ instructions_vi: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

/** The quiz: one assignment owned by the programme's Final Assessment, edited with the Training question editor. */
function FinalAssessmentQuiz({ programmeId }: { programmeId: string | undefined }) {
  const { t } = useTranslation("admin");
  const { t: tTraining } = useTranslation("training");
  const queryClient = useQueryClient();
  const key = ["final-assessment-quiz", programmeId];
  const { data: assignment, isLoading } = useQuery({
    queryKey: key,
    enabled: !!programmeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assignments")
        .select("id")
        .eq("final_assessment_programme_id", programmeId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("assignments").insert({
        final_assessment_programme_id: programmeId!,
        training_week_id: null,
        assignment_type: "quiz",
        title: "Final Assessment quiz",
        title_vi: "Quiz Final Assessment",
        // Learners reach it only through learner_final_assessment_quiz.
        is_visible: true,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(getFriendlyErrorMessage(e, t)),
  });

  if (!programmeId) {
    return <p className="text-[10.5px] text-muted-foreground">{t("programmes.finalAssessment.saveFirst")}</p>;
  }
  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (!assignment) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => create.mutate()} disabled={create.isPending} data-testid="final-assessment-create-quiz">
        <Plus className="h-3.5 w-3.5" /> {t("programmes.finalAssessment.createQuiz")}
      </Button>
    );
  }
  return (
    <div className="rounded-lg border bg-card p-2.5" data-testid="final-assessment-quiz-editor">
      <QuizQuestionEditor assignmentId={assignment.id} t={tTraining} />
    </div>
  );
}
