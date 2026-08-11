import { Target } from "lucide-react";
import { Card } from "@/components/ui/card";
import { GoalDialog, type AddGoalFn } from "./GoalDialog";

export function EmptyGoals({ onAdd, description }: { onAdd: AddGoalFn; description: string }) {
  return (
    <Card className="p-12 text-center">
      <Target className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
      <h3 className="font-semibold">Set your first goal</h3>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">{description}</p>
      <div className="flex justify-center">
        <GoalDialog onAdd={onAdd} />
      </div>
    </Card>
  );
}
