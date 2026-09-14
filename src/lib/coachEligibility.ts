export type CoachEligibilityInput = {
  accountStatus: string | null | undefined;
  approvalStatus: string | null | undefined;
};

export function isCoachEligible(input: CoachEligibilityInput): boolean {
  return input.accountStatus === "active" && input.approvalStatus === "active";
}