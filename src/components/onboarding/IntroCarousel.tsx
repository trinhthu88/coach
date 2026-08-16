import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OnboardingBullet, OnboardingStep, BulletKind, OnboardingRole } from "@/lib/onboarding/content";
import clarivaLogo from "@/assets/clariva-logo-dark.png";

// ─── Graphic type per role + step index ──────────────────────────────────────

type GraphicType =
  | "journey" | "goals" | "match" | "calendar" | "privacy" | "growth"
  | "practice" | "cohort" | "report";

const STEP_GRAPHICS: Record<OnboardingRole, GraphicType[]> = {
  coachee:  ["journey",  "goals",    "match",    "calendar", "privacy", "growth"],
  coach:    ["practice", "match",    "calendar", "practice", "privacy", "practice"],
  sponsor:  ["cohort",   "journey",  "practice", "privacy",  "report"],
};

const ROLE_LABEL: Record<OnboardingRole, string> = {
  coachee: "Coachee",
  coach: "Coach",
  sponsor: "Sponsor",
};

// ─── Journey SVG — S-curve coaching path ─────────────────────────────────────
// Arc points extracted directly from the design prototype data.
const ARC_PTS = [
  { x: 20,  y: 160, r: 7, fill: "#3db4d0", stroke: "#3db4d0" },   // start — solid sky
  { x: 84,  y: 140, r: 5, fill: "#062f3e", stroke: "#3db4d0" },   // past  — hollow sky
  { x: 128, y: 84,  r: 5, fill: "#062f3e", stroke: "#3db4d0" },   // past  — hollow sky
  { x: 170, y: 60,  r: 8, fill: "#e8874a", stroke: "#e8874a" },   // current — amber filled
  { x: 232, y: 106, r: 5, fill: "#062f3e", stroke: "rgba(207,230,238,.35)" }, // future
  { x: 288, y: 74,  r: 5, fill: "#062f3e", stroke: "rgba(207,230,238,.35)" }, // future
  { x: 320, y: 46,  r: 5, fill: "#062f3e", stroke: "rgba(207,230,238,.35)" }, // future
];

function JourneySVG() {
  const solid = "M 20 160 C 55 155 72 148 84 140 C 96 132 114 96 128 84 C 142 72 156 62 170 60";
  const dashed = "M 170 60 C 194 58 218 100 232 106 C 246 112 272 78 288 74 C 302 70 312 52 320 46";
  return (
    <svg viewBox="0 0 340 190" className="w-full max-w-[320px]" aria-hidden="true">
      {/* Glow behind current dot */}
      <circle cx="170" cy="60" r="18" fill="#e8874a" fillOpacity="0.15" />
      {/* Solid past path */}
      <path d={solid} fill="none" stroke="#3db4d0" strokeWidth="2.5" strokeLinecap="round" />
      {/* Dashed future path */}
      <path d={dashed} fill="none" stroke="rgba(207,230,238,.3)" strokeWidth="2"
            strokeDasharray="6 5" strokeLinecap="round" />
      {/* Circles */}
      {ARC_PTS.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.r}
          fill={p.fill} stroke={p.stroke} strokeWidth="2" />
      ))}
      {/* Labels */}
      <text x="20" y="178" fontSize="10" fill="rgba(207,230,238,.55)"
            fontFamily="Montserrat, sans-serif">Session 1</text>
      <text x="268" y="38" fontSize="10" fill="rgba(207,230,238,.55)"
            fontFamily="Montserrat, sans-serif">Ongoing</text>
    </svg>
  );
}

// ─── Goals SVG ────────────────────────────────────────────────────────────────

function GoalsSVG() {
  const rows = [
    { label: "Hard conversations", from: 40, to: 50 },
    { label: "Delegate the report",  from: 30, to: 50 },
    { label: "Protect deep work",    from: 50, to: 50 },
  ];
  return (
    <svg viewBox="0 0 300 160" className="w-full max-w-[300px]" aria-hidden="true">
      {/* Scale ticks */}
      {[0,1,2,3,4,5,6,7,8,9,10].map(n => (
        <line key={n} x1={n * 24 + 30} y1="8" x2={n * 24 + 30} y2="148"
          stroke="rgba(207,230,238,.06)" strokeWidth="1" />
      ))}
      {/* Scale labels */}
      {[1,5,10].map(n => (
        <text key={n} x={n * 24 + 28} y="158" fontSize="8" fill="rgba(207,230,238,.3)"
              textAnchor="middle" fontFamily="Montserrat, sans-serif">{n}</text>
      ))}
      {rows.map((row, i) => {
        const y = i * 46 + 20;
        const barY = y + 14;
        const fromX = row.from / 100 * 240 + 30;
        const toX = row.to / 100 * 240 + 30;
        return (
          <g key={i}>
            <text x="28" y={y + 10} fontSize="9.5" fill="rgba(207,230,238,.7)"
                  textAnchor="end" fontFamily="Montserrat, sans-serif"
                  className="truncate">{row.label.length > 18 ? row.label.slice(0,17) + "…" : row.label}</text>
            {/* Track */}
            <rect x="30" y={barY} width="240" height="6" rx="3" fill="rgba(207,230,238,.1)" />
            {/* Past progress */}
            <rect x="30" y={barY} width={row.from / 100 * 240} height="6" rx="3" fill="#3db4d0" fillOpacity="0.5" />
            {/* New progress */}
            <rect x="30" y={barY} width={row.to / 100 * 240} height="6" rx="3" fill="#3db4d0" />
            {/* Current dot */}
            <circle cx={toX} cy={barY + 3} r="5" fill="#e8874a" stroke="#062f3e" strokeWidth="1.5" />
            {/* Rating label */}
            <text x={toX + 8} y={barY + 7} fontSize="9" fill="#e8874a"
                  fontFamily="Montserrat, sans-serif">{row.to / 10}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Match SVG ────────────────────────────────────────────────────────────────

function MatchSVG() {
  const coaches = [
    { ini: "MT", name: "Minh Tran",  spec: "Leadership",   bg: true },
    { ini: "HN", name: "Hai Nguyen", spec: "Transition",   bg: false },
  ];
  return (
    <svg viewBox="0 0 300 180" className="w-full max-w-[300px]" aria-hidden="true">
      {coaches.map((c, i) => {
        const y = i * 78;
        const alpha = c.bg ? 1 : 0.55;
        return (
          <g key={i} opacity={alpha}>
            {/* Card */}
            <rect x="0" y={y} width="298" height="68" rx="10"
              fill={c.bg ? "rgba(255,255,255,.09)" : "rgba(255,255,255,.04)"}
              stroke={c.bg ? "rgba(61,180,208,.35)" : "rgba(207,230,238,.1)"} strokeWidth="1" />
            {/* Avatar */}
            <circle cx="28" cy={y + 34} r="18"
              fill={c.bg ? "#3db4d0" : "rgba(61,180,208,.3)"} />
            <text x="28" y={y + 38} fontSize="11" fontWeight="600" fill="white"
                  textAnchor="middle" fontFamily="Montserrat, sans-serif">{c.ini}</text>
            {/* Name */}
            <text x="54" y={y + 27} fontSize="12" fontWeight="600" fill="rgba(255,255,255,.9)"
                  fontFamily="Montserrat, sans-serif">{c.name}</text>
            {/* Chip */}
            <rect x="54" y={y + 36} width={c.spec.length * 7 + 8} height="16" rx="8"
              fill="rgba(232,135,74,.2)" stroke="rgba(232,135,74,.4)" strokeWidth="1" />
            <text x={54 + c.spec.length * 3.5 + 4} y={y + 48} fontSize="9" fill="#f0a875"
                  textAnchor="middle" fontFamily="Montserrat, sans-serif">{c.spec}</text>
            {/* Match badge */}
            {c.bg && (
              <>
                <rect x="238" y={y + 22} width="52" height="22" rx="11"
                  fill="#e8874a" />
                <text x="264" y={y + 37} fontSize="10" fontWeight="600" fill="white"
                      textAnchor="middle" fontFamily="Montserrat, sans-serif">Match</text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Calendar SVG ─────────────────────────────────────────────────────────────

function CalendarSVG() {
  const days = ["M", "T", "W", "T", "F"];
  // slots[col][row]: 0=empty, 1=sky(available), 2=muted(taken), 3=amber(selected)
  const slots = [
    [0, 1, 2, 1],
    [1, 0, 1, 2],
    [2, 1, 3, 1],
    [1, 2, 0, 1],
    [0, 1, 1, 2],
  ];
  const slotColor: Record<number, string> = {
    0: "rgba(207,230,238,.05)",
    1: "rgba(61,180,208,.25)",
    2: "rgba(207,230,238,.1)",
    3: "#e8874a",
  };
  const slotStroke: Record<number, string> = {
    0: "rgba(207,230,238,.08)",
    1: "rgba(61,180,208,.5)",
    2: "rgba(207,230,238,.15)",
    3: "#e8874a",
  };
  return (
    <svg viewBox="0 0 300 180" className="w-full max-w-[300px]" aria-hidden="true">
      {/* Day headers */}
      {days.map((d, i) => (
        <text key={i} x={i * 57 + 28 + 12} y="18" fontSize="10" fill="rgba(207,230,238,.5)"
              textAnchor="middle" fontFamily="Montserrat, sans-serif" fontWeight="600">{d}</text>
      ))}
      {/* Slots */}
      {slots.map((col, ci) =>
        col.map((type, ri) => {
          const x = ci * 57 + 28;
          const y = ri * 36 + 26;
          return (
            <g key={`${ci}-${ri}`}>
              <rect x={x} y={y} width="24" height="28" rx="5"
                fill={slotColor[type]} stroke={slotStroke[type]} strokeWidth="1" />
              {type === 3 && (
                <text x={x + 12} y={y + 18} fontSize="8" fill="white"
                      textAnchor="middle" fontFamily="Montserrat, sans-serif">Book</text>
              )}
              {type === 1 && (
                <circle cx={x + 12} cy={y + 14} r="2.5" fill="#3db4d0" fillOpacity="0.7" />
              )}
            </g>
          );
        })
      )}
      {/* Legend */}
      <circle cx="50" cy="168" r="3" fill="#3db4d0" fillOpacity="0.5" />
      <text x="57" y="172" fontSize="8.5" fill="rgba(207,230,238,.4)" fontFamily="Montserrat, sans-serif">Available</text>
      <rect x="118" y="165" width="6" height="6" rx="1" fill="#e8874a" />
      <text x="128" y="172" fontSize="8.5" fill="rgba(207,230,238,.4)" fontFamily="Montserrat, sans-serif">Selected</text>
    </svg>
  );
}

// ─── Privacy SVG ──────────────────────────────────────────────────────────────

function PrivacySVG() {
  const items = [
    { ok: true,  label: "Session attended",       sub: "Visible to you" },
    { ok: true,  label: "Self-rated progress",    sub: "Visible to you" },
    { ok: false, label: "Session notes",          sub: "Withheld" },
    { ok: false, label: "Goal wording",           sub: "Withheld" },
  ];
  return (
    <svg viewBox="0 0 300 185" className="w-full max-w-[300px]" aria-hidden="true">
      {/* Lock shield */}
      <path d="M150 8 L180 20 L180 48 Q180 72 150 82 Q120 72 120 48 L120 20 Z"
        fill="rgba(61,180,208,.15)" stroke="rgba(61,180,208,.4)" strokeWidth="1.5" />
      <rect x="140" y="42" width="20" height="16" rx="4"
        fill="rgba(61,180,208,.4)" />
      <path d="M144 42 L144 36 Q144 28 150 28 Q156 28 156 36 L156 42"
        fill="none" stroke="#3db4d0" strokeWidth="2" strokeLinecap="round" />
      <circle cx="150" cy="50" r="2.5" fill="#3db4d0" />
      <text x="150" y="96" fontSize="9" fill="#3db4d0" textAnchor="middle"
            fontFamily="Montserrat, sans-serif" fontWeight="600" letterSpacing="1">CLOSED ROOM</text>
      {/* Divider */}
      <line x1="20" y1="106" x2="280" y2="106" stroke="rgba(207,230,238,.1)" strokeWidth="1" />
      {/* Items */}
      {items.map((item, i) => {
        const y = i * 18 + 116;
        return (
          <g key={i}>
            <circle cx="32" cy={y + 4} r="5"
              fill={item.ok ? "rgba(47,122,82,.3)" : "rgba(168,86,58,.3)"}
              stroke={item.ok ? "#2f7a52" : "#a8563a"} strokeWidth="1" />
            <text x="32" y={y + 8} fontSize="8" fontWeight="700"
              fill={item.ok ? "#2f7a52" : "#a8563a"}
              textAnchor="middle" fontFamily="Montserrat, sans-serif">
              {item.ok ? "✓" : "✕"}
            </text>
            <text x="44" y={y + 8} fontSize="10" fill="rgba(207,230,238,.8)"
                  fontFamily="Montserrat, sans-serif">{item.label}</text>
            <text x="260" y={y + 8} fontSize="9" fill={item.ok ? "rgba(61,180,208,.7)" : "rgba(207,230,238,.3)"}
                  textAnchor="end" fontFamily="Montserrat, sans-serif">{item.sub}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Growth SVG ───────────────────────────────────────────────────────────────

function GrowthSVG() {
  // Three goal lines trending upward: (session, rating) pairs
  const lines = [
    { label: "Goal 1", color: "#3db4d0", pts: [[0,68],[1,62],[2,52],[3,44]] },
    { label: "Goal 2", color: "#e8874a", pts: [[0,76],[1,70],[2,58],[3,48]] },
    { label: "Goal 3", color: "rgba(207,230,238,.45)", pts: [[0,60],[1,56],[2,54],[3,50]] },
  ] as const;
  const toPath = (pts: readonly (readonly number[])[]) =>
    pts.map(([s, r], i) => `${i === 0 ? "M" : "L"} ${s * 72 + 50} ${r}`).join(" ");
  return (
    <svg viewBox="0 0 340 120" className="w-full max-w-[320px]" aria-hidden="true">
      {/* Grid */}
      {[0,1,2,3].map(s => (
        <line key={s} x1={s * 72 + 50} y1="20" x2={s * 72 + 50} y2="88"
          stroke="rgba(207,230,238,.06)" strokeWidth="1" />
      ))}
      {[20,54,88].map(y => (
        <line key={y} x1="50" y1={y} x2="266" y2={y}
          stroke="rgba(207,230,238,.06)" strokeWidth="1" />
      ))}
      {/* Session axis labels */}
      {["S1","S2","S3","S4"].map((l, i) => (
        <text key={i} x={i * 72 + 50} y="100" fontSize="9" fill="rgba(207,230,238,.3)"
              textAnchor="middle" fontFamily="Montserrat, sans-serif">{l}</text>
      ))}
      {/* Rating axis labels */}
      {[10,5,1].map((v, i) => (
        <text key={i} x="42" y={[24,54,84][i]} fontSize="8" fill="rgba(207,230,238,.3)"
              textAnchor="end" fontFamily="Montserrat, sans-serif">{v}</text>
      ))}
      {/* Lines */}
      {lines.map((line, i) => (
        <g key={i}>
          <path d={toPath(line.pts)} fill="none" stroke={line.color} strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round" />
          {/* End dot */}
          <circle cx={3 * 72 + 50} cy={line.pts[3][1]} r="4.5"
            fill={line.color} stroke="#062f3e" strokeWidth="1.5" />
        </g>
      ))}
      {/* Legend */}
      {lines.map((line, i) => (
        <g key={i}>
          <circle cx={i * 90 + 40} cy="114" r="3.5" fill={line.color} />
          <text x={i * 90 + 48} y="118" fontSize="8.5" fill="rgba(207,230,238,.5)"
                fontFamily="Montserrat, sans-serif">{line.label}</text>
        </g>
      ))}
    </svg>
  );
}

// ─── Practice SVG (coach welcome / peer / clients) ────────────────────────────

function PracticeSVG() {
  const stats = [
    { label: "Sessions",    value: "24",  sub: "as coach",   color: "#3db4d0" },
    { label: "Peer",        value: "6",   sub: "completed",  color: "#e8874a" },
    { label: "Upcoming",    value: "5",   sub: "confirmed",  color: "rgba(207,230,238,.5)" },
    { label: "Avg rating",  value: "4.9", sub: "from coachees", color: "#3db4d0" },
  ];
  return (
    <svg viewBox="0 0 300 170" className="w-full max-w-[300px]" aria-hidden="true">
      {stats.map((s, i) => {
        const x = (i % 2) * 152;
        const y = Math.floor(i / 2) * 80;
        return (
          <g key={i}>
            <rect x={x} y={y} width="140" height="68" rx="10"
              fill="rgba(255,255,255,.06)" stroke="rgba(207,230,238,.1)" strokeWidth="1" />
            {/* Accent dot */}
            <circle cx={x + 14} cy={y + 14} r="4" fill={s.color} fillOpacity="0.8" />
            <text x={x + 14} y={y + 38} fontSize="22" fontWeight="300" fill="rgba(255,255,255,.9)"
                  fontFamily="Fraunces, serif">{s.value}</text>
            <text x={x + 14} y={y + 52} fontSize="9" fill="rgba(207,230,238,.45)"
                  fontFamily="Montserrat, sans-serif">{s.label}</text>
            <text x={x + 14} y={y + 63} fontSize="8.5" fill={s.color} fillOpacity="0.7"
                  fontFamily="Montserrat, sans-serif">{s.sub}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Cohort SVG (sponsor welcome) ─────────────────────────────────────────────

function CohortSVG() {
  const kpis = [
    { label: "Enrolled",       value: "11/12", color: "#3db4d0" },
    { label: "On track",       value: "9",     color: "#2f7a52" },
    { label: "Sessions used",  value: "31/72", color: "#e8874a" },
    { label: "Avg growth",     value: "+1.4",  color: "#3db4d0" },
  ];
  return (
    <svg viewBox="0 0 300 170" className="w-full max-w-[300px]" aria-hidden="true">
      <text x="0" y="14" fontSize="9" fill="rgba(207,230,238,.4)" fontWeight="600"
            fontFamily="Montserrat, sans-serif" letterSpacing="1">OPS DIRECTORS Q3</text>
      {kpis.map((k, i) => {
        const x = (i % 2) * 155;
        const y = Math.floor(i / 2) * 70 + 24;
        return (
          <g key={i}>
            <rect x={x} y={y} width="142" height="56" rx="9"
              fill="rgba(255,255,255,.06)" stroke="rgba(207,230,238,.09)" strokeWidth="1" />
            <text x={x + 12} y={y + 28} fontSize="20" fontWeight="300"
                  fill="rgba(255,255,255,.9)" fontFamily="Fraunces, serif">{k.value}</text>
            <text x={x + 12} y={y + 44} fontSize="8.5" fill={k.color} fillOpacity="0.8"
                  fontFamily="Montserrat, sans-serif" fontWeight="600" letterSpacing=".5">{k.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Report SVG (sponsor step 4) ──────────────────────────────────────────────

function ReportSVG() {
  const rows = [
    { label: "On-track rate", value: "75%",  bar: 75, color: "#3db4d0" },
    { label: "Avg goal growth", value: "+1.4", bar: 28, color: "#e8874a" },
    { label: "Sessions used", value: "43%",  bar: 43, color: "rgba(207,230,238,.5)" },
  ];
  return (
    <svg viewBox="0 0 300 170" className="w-full max-w-[300px]" aria-hidden="true">
      {/* Page outline */}
      <rect x="0" y="0" width="300" height="165" rx="10"
        fill="rgba(255,255,255,.05)" stroke="rgba(207,230,238,.12)" strokeWidth="1" />
      <rect x="0" y="0" width="300" height="28" rx="10"
        fill="rgba(6,47,62,.8)" />
      <rect x="0" y="10" width="300" height="18" fill="rgba(6,47,62,.8)" />
      <text x="14" y="19" fontSize="9" fill="rgba(207,230,238,.6)"
            fontFamily="Montserrat, sans-serif" fontWeight="600" letterSpacing="1">CLARIVA SPONSOR SUMMARY</text>
      <text x="286" y="19" fontSize="8.5" fill="rgba(207,230,238,.35)"
            textAnchor="end" fontFamily="Montserrat, sans-serif">Q3 2026</text>
      {rows.map((row, i) => {
        const y = i * 42 + 42;
        return (
          <g key={i}>
            <text x="14" y={y} fontSize="9.5" fill="rgba(207,230,238,.65)"
                  fontFamily="Montserrat, sans-serif">{row.label}</text>
            <text x="286" y={y} fontSize="12" fill="rgba(255,255,255,.85)"
                  textAnchor="end" fontFamily="Fraunces, serif">{row.value}</text>
            {/* Bar track */}
            <rect x="14" y={y + 5} width="272" height="5" rx="2.5"
              fill="rgba(207,230,238,.08)" />
            {/* Bar fill */}
            <rect x="14" y={y + 5} width={row.bar / 100 * 272} height="5" rx="2.5"
              fill={row.color} fillOpacity="0.7" />
          </g>
        );
      })}
      <text x="14" y="162" fontSize="8" fill="rgba(207,230,238,.2)"
            fontFamily="Montserrat, sans-serif" fontStyle="italic">
        Session notes and goal wording excluded.
      </text>
    </svg>
  );
}

// ─── Graphic dispatcher ───────────────────────────────────────────────────────

function StepGraphic({ type }: { type: GraphicType }) {
  switch (type) {
    case "journey":  return <JourneySVG />;
    case "goals":    return <GoalsSVG />;
    case "match":    return <MatchSVG />;
    case "calendar": return <CalendarSVG />;
    case "privacy":  return <PrivacySVG />;
    case "growth":   return <GrowthSVG />;
    case "practice": return <PracticeSVG />;
    case "cohort":   return <CohortSVG />;
    case "report":   return <ReportSVG />;
  }
}

// ─── Bullet styles ────────────────────────────────────────────────────────────

const BULLET_STYLES: Record<BulletKind, { box: string; label: string; dot: string }> = {
  in: { box: "border-primary/20 bg-primary/5",    label: "text-primary",     dot: "bg-primary" },
  ok: { box: "border-success/25 bg-success/10",   label: "text-success",     dot: "bg-success" },
  no: { box: "border-warning/30 bg-warning/10",   label: "text-warning",     dot: "bg-warning" },
};

function BulletRow({ bullet }: { bullet: OnboardingBullet }) {
  const s = BULLET_STYLES[bullet.kind];
  return (
    <li className={cn("flex gap-3 rounded-xl border p-3", s.box)}>
      <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", s.dot)} />
      <div>
        <p className={cn("text-[10px] font-bold uppercase tracking-wide", s.label)}>{bullet.label}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-foreground/75">{bullet.text}</p>
      </div>
    </li>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function IntroCarousel({
  steps,
  role,
  onFinish,
  onSkip,
}: {
  steps: OnboardingStep[];
  role: OnboardingRole;
  onFinish: () => void;
  onSkip: () => void;
}) {
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const isLast = index === steps.length - 1;
  const graphicList = STEP_GRAPHICS[role];
  const graphic = graphicList[Math.min(index, graphicList.length - 1)];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onSkip(); }}>
      <DialogContent
        className="max-w-3xl gap-0 overflow-hidden p-0"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{step.title}</DialogTitle>

        <div className="grid grid-cols-[300px_1fr]" style={{ minHeight: 480 }}>

          {/* ── Left panel ── */}
          <div className="relative flex flex-col overflow-hidden bg-secondary">
            {/* Subtle bg glow */}
            <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-12 right-4 h-40 w-40 rounded-full bg-accent/8 blur-3xl" />

            {/* Header: logo + role */}
            <div className="flex items-center justify-between px-6 pt-5">
              <img src={clarivaLogo} alt="Clariva" className="h-5 w-auto opacity-80" />
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/40">
                {ROLE_LABEL[role]}
              </span>
            </div>

            {/* Graphic */}
            <div className="flex flex-1 items-center justify-center px-6 py-4">
              <StepGraphic type={graphic} />
            </div>

            {/* Step rail tabs */}
            <div className="flex items-end gap-0 border-t border-white/8 px-4 pb-1 pt-2">
              {steps.map((s, i) => {
                const isActive = i === index;
                const isPast = i < index;
                return (
                  <button
                    key={i}
                    onClick={() => setIndex(i)}
                    className="flex min-w-0 flex-1 flex-col items-start pb-2 pt-1 text-left transition-opacity"
                    style={{ opacity: isActive ? 1 : 0.4 }}
                  >
                    {/* Underline bar */}
                    <span
                      className="mb-1.5 h-0.5 w-full rounded-full transition-colors"
                      style={{
                        backgroundColor: isActive
                          ? "#e8874a"
                          : isPast
                          ? "#3db4d0"
                          : "rgba(207,230,238,.18)",
                      }}
                    />
                    <span
                      className="line-clamp-3 text-[8px] font-semibold uppercase leading-tight tracking-wide"
                      style={{ color: isActive ? "#fff" : "rgba(207,230,238,.6)" }}
                    >
                      {s.kicker}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Right panel ── */}
          <div className="flex flex-col bg-white">
            {/* Content */}
            <div className="flex-1 overflow-y-auto px-8 pb-4 pt-7">
              {/* Kicker + count */}
              <div className="mb-4 flex items-center justify-between gap-4">
                <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-primary">
                  {step.kicker}
                </p>
                <span className="shrink-0 text-[11px] text-gray-400">
                  {index + 1} / {steps.length}
                </span>
              </div>

              {/* Title */}
              <h2 className="font-display text-[1.55rem] font-normal leading-tight text-gray-900">
                {step.title}
              </h2>

              {/* Body */}
              <p className="mt-3 text-[13px] leading-relaxed text-gray-500">
                {step.body}
              </p>

              {/* Bullets */}
              {step.bullets && (
                <ul className="mt-4 space-y-2">
                  {step.bullets.map((bullet, i) => (
                    <BulletRow key={i} bullet={bullet} />
                  ))}
                </ul>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-8 py-5">
              <button
                type="button"
                onClick={() => (isLast ? onFinish() : setIndex((i) => i + 1))}
                className="rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 active:opacity-80"
              >
                {isLast ? "Take me in →" : "Continue"}
              </button>
              <button
                type="button"
                onClick={onSkip}
                className="text-sm text-gray-400 transition-colors hover:text-gray-600"
              >
                Skip intro
              </button>
            </div>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
