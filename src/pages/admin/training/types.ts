import type { AssignmentType } from "@/hooks/training/useAssignments";
import type { QuizOption } from "@/hooks/training/useQuiz";

export interface TrainingWeekRow {
  id: string;
  programme_id: string;
  week_number: number;
  title: string;
  title_vi: string | null;
  subtitle: string | null;
  subtitle_vi: string | null;
  skill_card_html: string | null;
  skill_card_html_vi: string | null;
  video_url: string | null;
  pdf_storage_path: string | null;
  pdf_storage_path_vi: string | null;
  is_visible: boolean;
  skill_card_visible: boolean;
  unlock_date: string | null;
}

export const emptyWeek = (programmeId: string, nextWeekNumber: number): Partial<TrainingWeekRow> => ({
  id: crypto.randomUUID(),
  programme_id: programmeId,
  week_number: nextWeekNumber,
  title: "",
  title_vi: "",
  subtitle: "",
  subtitle_vi: "",
  skill_card_html: "",
  skill_card_html_vi: "",
  video_url: "",
  is_visible: false,
  skill_card_visible: true,
  unlock_date: null,
});

export interface AssignmentRow {
  id: string;
  training_week_id: string;
  assignment_type: AssignmentType;
  title: string;
  title_vi: string | null;
  instructions: string | null;
  instructions_vi: string | null;
  is_visible: boolean;
  due_offset_days: number | null;
  sort_order: number;
}

export const emptyAssignment = (weekId: string, nextSort: number): Partial<AssignmentRow> & { training_week_id: string } => ({
  training_week_id: weekId,
  assignment_type: "quiz",
  title: "",
  title_vi: "",
  instructions: "",
  instructions_vi: "",
  is_visible: false,
  due_offset_days: 7,
  sort_order: nextSort,
});

export interface QuizQuestionRow {
  id: string;
  assignment_id: string;
  question_text: string;
  question_text_vi: string | null;
  options: QuizOption[];
  explanation: string | null;
  explanation_vi: string | null;
  sort_order: number;
}

export const emptyOption = (): QuizOption => ({ id: crypto.randomUUID().slice(0, 8), text: "", text_vi: "", is_correct: false });

export const emptyQuestion = (assignmentId: string, nextSort: number): Partial<QuizQuestionRow> & { assignment_id: string } => ({
  assignment_id: assignmentId,
  question_text: "",
  question_text_vi: "",
  options: [emptyOption(), emptyOption()],
  explanation: "",
  explanation_vi: "",
  sort_order: nextSort,
});

export interface DailyPromptRow {
  id: string;
  training_week_id: string;
  day_offset: number | null;
  prompt_text: string;
  prompt_text_vi: string | null;
  is_visible: boolean;
  sort_order: number;
}

export const emptyDailyPrompt = (weekId: string, nextSort: number): Partial<DailyPromptRow> & { training_week_id: string } => ({
  training_week_id: weekId,
  day_offset: null,
  prompt_text: "",
  prompt_text_vi: "",
  is_visible: true,
  sort_order: nextSort,
});

export type ReflectionQuestionType = "open_text" | "scale_1_10";

export interface ReflectionRow {
  id: string;
  programme_id: string;
  reflection_number: number;
  title: string;
  title_vi: string | null;
  instructions: string | null;
  instructions_vi: string | null;
  appears_at_week: number;
  is_visible: boolean;
}

export interface ReflectionQuestionRow {
  id: string;
  reflection_id: string;
  question_text: string;
  question_text_vi: string | null;
  question_type: ReflectionQuestionType;
  is_required: boolean;
  sort_order: number;
}

export const emptyReflectionQuestion = (
  reflectionId: string,
  nextSort: number
): Partial<ReflectionQuestionRow> & { reflection_id: string } => ({
  reflection_id: reflectionId,
  question_text: "",
  question_text_vi: "",
  question_type: "open_text",
  is_required: true,
  sort_order: nextSort,
});
