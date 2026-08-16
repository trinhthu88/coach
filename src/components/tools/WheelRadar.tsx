import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
} from "recharts";

export interface WheelDomain {
  id: string;
  label: string;
  rating: number;
}

export interface WheelSeries {
  key: string;
  name: string;
  /** rating per axis label (lower-cased key) */
  values: Record<string, number>;
  latest?: boolean;
}

const SERIES_HUES = [200, 30, 150, 285, 50];

/** Wrap a label onto at most two short lines so long domain names stay readable. */
function wrap(label: string): string[] {
  const words = label.split(" ");
  if (words.length === 1) return [label.length > 16 ? `${label.slice(0, 15)}…` : label];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}

interface AngleTickProps {
  payload?: { value?: string };
  x?: number;
  y?: number;
  textAnchor?: string;
}

function AngleTick({ payload, x = 0, y = 0, textAnchor }: AngleTickProps) {
  const lines = wrap(String(payload?.value ?? ""));
  return (
    <text
      x={x}
      y={y}
      textAnchor={textAnchor}
      fill="hsl(var(--foreground))"
      fontSize={11}
      fontWeight={600}
    >
      {lines.map((line, i) => (
        <tspan key={line + i} x={x} dy={i === 0 ? 0 : 12}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

/**
 * Shared radar rendering for wheel-style tools.
 * `axes` drives the polygon shape; `series` are the overlaid rating sets.
 */
export function WheelRadar({
  axes,
  series,
  height = 360,
}: {
  axes: string[];
  series: WheelSeries[];
  height?: number;
}) {
  const data = axes.map((label) => {
    const point: Record<string, string | number> = { axis: label };
    series.forEach((s) => {
      point[s.key] = s.values[label.trim().toLowerCase()] ?? 0;
    });
    return point;
  });

  return (
    <div style={{ height: `clamp(240px, 68vw, ${height}px)` }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="70%" margin={{ top: 16, right: 32, bottom: 16, left: 32 }}>
          <PolarGrid stroke="hsl(var(--border))" />
          <PolarAngleAxis dataKey="axis" tick={<AngleTick />} />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 10]}
            tickCount={6}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
            stroke="transparent"
          />
          {series.map((s, idx) => {
            const hue = SERIES_HUES[idx % SERIES_HUES.length];
            const emphasise = s.latest ?? idx === series.length - 1;
            return (
              <Radar
                key={s.key}
                name={s.name}
                dataKey={s.key}
                stroke={`hsl(${hue} 70% ${emphasise ? "42%" : "60%"})`}
                fill={`hsl(${hue} 70% 50% / ${emphasise ? 0.28 : 0.08})`}
                strokeWidth={emphasise ? 2.5 : 1.5}
                dot={emphasise ? { r: 3, strokeWidth: 0, fill: `hsl(${hue} 70% 42%)` } : false}
                isAnimationActive={false}
              />
            );
          })}
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} iconType="line" />}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function domainsToSeries(
  domains: WheelDomain[],
  key: string,
  name: string,
  latest?: boolean
): WheelSeries {
  return {
    key,
    name,
    latest,
    values: Object.fromEntries(
      domains.map((d) => [d.label.trim().toLowerCase(), d.rating])
    ),
  };
}
