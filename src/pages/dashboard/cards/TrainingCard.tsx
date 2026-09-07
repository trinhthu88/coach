import { ThisWeekSkillCard } from "@/components/training/ThisWeekSkillCard";
import { DailyPromptCard } from "@/components/training/DailyPromptCard";

/** Wraps the existing training widgets — each already renders nothing when
 * its module isn't enabled, so this component needs no gating of its own. */
export function TrainingCard() {
  return (
    <>
      <ThisWeekSkillCard />
      <DailyPromptCard />
    </>
  );
}
