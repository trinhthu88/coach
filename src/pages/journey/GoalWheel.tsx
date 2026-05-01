import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";

export interface GoalRatingRow {
  goalId: string;
  title: string;
  start: number;
  current: number;
  target: number;
}

const SHORT = (s: string, n = 14) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function GoalWheel({ rows }: { rows: GoalRatingRow[] }) {
  const data = useMemo(
    () =>
      rows.map((r) => ({
        axis: SHORT(r.title),
        Start: r.start,
        Current: r.current,
        Target: r.target,
      })),
    [rows]
  );

  if (rows.length < 3) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        Add at least 3 goals to see the goal wheel.
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Goal wheel
      </p>
      <div className="h-[320px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="78%">
            <PolarGrid stroke="hsl(var(--border))" />
            <PolarAngleAxis
              dataKey="axis"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
              stroke="hsl(var(--border))"
            />
            <Radar
              name="Start"
              dataKey="Start"
              stroke="hsl(var(--primary) / 0.55)"
              fill="hsl(var(--primary) / 0.05)"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              isAnimationActive={false}
            />
            <Radar
              name="Current"
              dataKey="Current"
              stroke="hsl(var(--primary))"
              fill="hsl(var(--primary) / 0.35)"
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Radar
              name="Target"
              dataKey="Target"
              stroke="hsl(var(--accent))"
              fill="transparent"
              strokeDasharray="6 4"
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              iconType="line"
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function GoalScoreCards({ rows }: { rows: GoalRatingRow[] }) {
  if (!rows.length) return null;
  const cards: { label: string; key: "start" | "current" | "target"; tone: string; barCls: string }[] = [
    { label: "Start", key: "start", tone: "text-primary/70", barCls: "bg-primary/40" },
    { label: "Current", key: "current", tone: "text-primary", barCls: "bg-primary" },
    { label: "Target", key: "target", tone: "text-accent", barCls: "bg-accent" },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {cards.map((c) => {
        const avg = Math.round(
          rows.reduce((s, r) => s + r[c.key], 0) / rows.length
        );
        return (
          <Card key={c.key} className="p-4">
            <div className="flex items-baseline justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {c.label}
              </p>
              <p className={cn("text-lg font-semibold", c.tone)}>{avg}</p>
            </div>
            <ul className="mt-3 space-y-2">
              {rows.map((r) => (
                <li key={r.goalId} className="space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px]">{r.title}</span>
                    <span className="shrink-0 text-[10px] font-semibold tabular-nums text-muted-foreground">
                      {r[c.key]}
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full", c.barCls)}
                      style={{ width: `${r[c.key]}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
