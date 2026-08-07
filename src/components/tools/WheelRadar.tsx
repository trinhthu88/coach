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

const SHORT = (s: string, n = 14) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const SERIES_HUES = [200, 30, 150, 285, 50];

/**
 * Shared radar rendering for wheel-style tools.
 * `axes` drives the polygon shape; `series` are the overlaid rating sets.
 */
export function WheelRadar({
  axes,
  series,
  height = 320,
}: {
  axes: string[];
  series: WheelSeries[];
  height?: number;
}) {
  const data = axes.map((label) => {
    const point: Record<string, string | number> = { axis: SHORT(label) };
    series.forEach((s) => {
      point[s.key] = s.values[label.trim().toLowerCase()] ?? 0;
    });
    return point;
  });

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="78%">
          <PolarGrid stroke="hsl(var(--border))" />
          <PolarAngleAxis
            dataKey="axis"
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 10]}
            tickCount={6}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
            stroke="hsl(var(--border))"
          />
          {series.map((s, idx) => {
            const hue = SERIES_HUES[idx % SERIES_HUES.length];
            const emphasise = s.latest ?? idx === series.length - 1;
            return (
              <Radar
                key={s.key}
                name={s.name}
                dataKey={s.key}
                stroke={`hsl(${hue} 70% ${emphasise ? "45%" : "60%"})`}
                fill={`hsl(${hue} 70% 50% / ${emphasise ? 0.32 : 0.1})`}
                strokeWidth={emphasise ? 2.5 : 1.5}
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
