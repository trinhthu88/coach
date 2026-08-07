import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { WheelOfLife } from "./WheelOfLife";
import { GrowWorksheet } from "./GrowWorksheet";

type ToolKey = "wheel_of_life" | "grow_worksheet";

const TOOLS: { key: ToolKey; label: string }[] = [
  { key: "wheel_of_life", label: "Wheel of Life" },
  { key: "grow_worksheet", label: "GROW worksheet" },
];

export function SessionToolbox({
  sessionId,
  onActionItemsChanged,
}: {
  sessionId: string;
  onActionItemsChanged?: () => void;
}) {
  const [active, setActive] = useState<ToolKey>("wheel_of_life");

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <Wrench className="h-3.5 w-3.5" /> Toolbox
        </p>
        <div className="flex gap-1 rounded-full bg-muted p-1">
          {TOOLS.map((t) => (
            <Button
              key={t.key}
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setActive(t.key)}
              className={cn(
                "h-7 rounded-full px-3 text-xs",
                active === t.key && "bg-card shadow-sm"
              )}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      {active === "wheel_of_life" ? (
        <WheelOfLife sessionId={sessionId} />
      ) : (
        <GrowWorksheet sessionId={sessionId} onActionItemsChanged={onActionItemsChanged} />
      )}
    </Card>
  );
}

export default SessionToolbox;
