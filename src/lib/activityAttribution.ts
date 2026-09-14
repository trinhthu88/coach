export type CadenceMilestone = {
  id: string;
  module: string;
  dueOn: string;
  requiredUnits: number;
};

export function resolveCadenceMilestone(input: {
  enrollmentId: string | null;
  module: string;
  activityId: string;
  occurredOn: string;
  milestones: CadenceMilestone[];
  alreadyAttributedMilestoneIds?: string[];
  historical?: boolean;
}): string | null {
  if (!input.enrollmentId || input.historical) return null;
  const alreadyAttributed = new Set(input.alreadyAttributedMilestoneIds ?? []);
  return (
    input.milestones
      .filter(
        (milestone) =>
          milestone.module === input.module &&
          milestone.dueOn <= input.occurredOn &&
          !alreadyAttributed.has(milestone.id),
      )
      .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.id.localeCompare(b.id))[0]?.id ?? null
  );
}