import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
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
  value: number | null;
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
        <span className="text-xs font-semibold tabular-nums text-foreground">{local ?? "—"}</span>
      </div>
      <Input
        type="number"
        aria-label={label}
        value={local ?? ""}
        min={0}
        max={100}
        step={1}
        disabled={disabled}
        onChange={(event) => setLocal(event.target.value === "" ? null : Number(event.target.value))}
        onBlur={() => { if (local != null && Number.isInteger(local) && local >= 0 && local <= 100 && local !== value) onChange(local); }}
        className={trackColor ? "border-primary/20" : undefined}
      />
    </div>
  );
}
