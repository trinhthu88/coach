import { useEffect, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export function RatingSlider({
  label,
  hint,
  value,
  trackColor,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  trackColor: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <div className={cn(disabled && "opacity-60")}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div>
          <span className="text-[11px] font-semibold">{label}</span>
          {hint && <span className="ml-2 text-[10px] text-muted-foreground">{hint}</span>}
        </div>
        <span className="text-xs font-semibold tabular-nums text-foreground">{local}</span>
      </div>
      <Slider
        value={[local]}
        min={0}
        max={100}
        step={1}
        disabled={disabled}
        onValueChange={(v) => setLocal(v[0])}
        onValueCommit={(v) => onChange(v[0])}
        className={cn("[&_[data-orientation=horizontal]>span]:h-1.5", trackColor && "")}
      />
    </div>
  );
}
