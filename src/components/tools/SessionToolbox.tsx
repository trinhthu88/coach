import { useState } from "react";
import { Compass, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { WheelOfLife } from "./WheelOfLife";
import { GrowWorksheet } from "./GrowWorksheet";

type ToolKey = "wheel_of_life" | "grow_worksheet";

const TOOLS: {
  key: ToolKey;
  label: string;
  blurb: string;
  icon: typeof Compass;
}[] = [
  {
    key: "wheel_of_life",
    label: "Wheel of Life",
    blurb: "Rate life domains and spot imbalance",
    icon: Compass,
  },
  {
    key: "grow_worksheet",
    label: "GROW worksheet",
    blurb: "Goal · Reality · Options · Will",
    icon: PenLine,
  },
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
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          const on = active === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              aria-pressed={on}
              className={cn(
                "flex items-start gap-3 rounded-[18px] border p-4 text-left transition-all",
                on
                  ? "border-primary/40 bg-primary-soft shadow-sm"
                  : "border-border bg-card hover:border-primary/30"
              )}
            >
              <span
                className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-full",
                  on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{t.label}</span>
                <span className="block text-xs text-muted-foreground">{t.blurb}</span>
              </span>
            </button>
          );
        })}
      </div>

      {active === "wheel_of_life" ? (
        <WheelOfLife sessionId={sessionId} />
      ) : (
        <GrowWorksheet sessionId={sessionId} onActionItemsChanged={onActionItemsChanged} />
      )}
    </div>
  );
}

export default SessionToolbox;
