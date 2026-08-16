import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { OnboardingBullet, OnboardingStep, BulletKind, OnboardingRole } from "@/lib/onboarding/content";
import clarivaLogo from "@/assets/clariva-logo-dark.png";

// ─── Brand colours (from prototype source) ───────────────────────────────────
const SKY   = "#3db4d0";
const AMBER = "#e8874a";
const NAVY  = "#062f3e";
const PANEL = "rgba(207,230,238,";       // partial for alpha variants
const SKY_SOFT   = `rgba(61,180,208,`;
const AMBER_SOFT = `rgba(232,135,74,`;

// ─── Icon paths (from prototype P.* constants) ────────────────────────────────
const ICONS: Record<string, string> = {
  card:    "M3 6h18v12H3zM7 10h4M7 14h7",
  clock:   "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 8v5l3.5 2",
  users:   "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 20a5 5 0 0 0-4-4.9",
  lock:    "M5 11h14v10H5zM8 11V8a4 4 0 0 1 8 0v3",
  bell:    "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  msg:     "M4 5h16v11H8l-4 4z",
  search:  "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M20 20l-4.5-4.5",
  chart:   "M4 20V9M10 20V4M16 20v-7M22 20H2",
  check:   "M4 12l5 5L20 6",
  cal:     "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  trend:   "M3 17l6-6 4 4 8-8M21 7h-5M21 7v5",
  compass: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M15.5 8.5l-2 5-5 2 2-5z",
};

function Icon({ d, x, y, size = 16, color = SKY }: { d: string; x: number; y: number; size?: number; color?: string }) {
  const s = size / 24;
  return (
    <g transform={`translate(${x - size / 2}, ${y - size / 2}) scale(${s})`}>
      <path d={d} fill="none" stroke={color} strokeWidth={2 / s} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

// ─── Graphic type per role + step index ──────────────────────────────────────
type GraphicType =
  | "journey" | "goals" | "match"    | "calendar" | "privacy" | "growth"
  | "practice" | "peer" | "clients"  | "cohort"   | "report";

const STEP_GRAPHICS: Record<OnboardingRole, GraphicType[]> = {
  coachee: ["journey",  "goals",    "match",    "calendar", "privacy", "growth"],
  coach:   ["practice", "match",    "calendar", "peer",     "privacy", "clients"],
  sponsor: ["cohort",   "journey",  "clients",  "privacy",  "report"],
};

const ROLE_LABEL: Record<OnboardingRole, string> = {
  coachee: "Coachee",
  coach:   "Coach",
  sponsor: "Sponsor",
};

// ─── Shared helper: PracticeRows list ─────────────────────────────────────────
// Rows rendered for practice / peer / clients / sponsor-roster graphics.

type RowState = "step 1"|"step 2"|"live"|"locked"|"at risk"|"ok"|"opt in"|"open"|"record"|"review"|"book"|"nudge";

interface PracticeRow {
  label: string;
  note: string;
  state: RowState;
  icon: string; // key into ICONS
}

const STATE_COLOR: Record<string, string> = {
  "live":    "#4ade80",
  "ok":      SKY,
  "open":    SKY,
  "at risk": AMBER,
  "review":  AMBER,
  "nudge":   AMBER,
  "book":    SKY,
  "opt in":  `${PANEL}.55)`,
  "record":  `${PANEL}.55)`,
  "step 1":  `${PANEL}.5)`,
  "step 2":  `${PANEL}.5)`,
  "locked":  `${PANEL}.3)`,
};

const STATE_BG: Record<string, { bg: string; border: string }> = {
  "at risk": { bg: `${AMBER_SOFT}.12)`, border: `${AMBER_SOFT}.4)` },
  "review":  { bg: `${AMBER_SOFT}.08)`, border: `${AMBER_SOFT}.3)` },
  _default:  { bg: "rgba(255,255,255,.05)", border: "rgba(255,255,255,.1)" },
};

function getRowStyle(state: RowState) {
  return STATE_BG[state] ?? STATE_BG._default;
}

function PracticeRowsSVG({ rows }: { rows: PracticeRow[] }) {
  const rowH = 42, gap = 6, startY = 6;
  const totalH = rows.length * (rowH + gap) - gap + startY;
  return (
    <svg viewBox={`0 0 300 ${Math.max(totalH, 170)}`} className="w-full max-w-[300px]" aria-hidden="true">
      {rows.map((row, i) => {
        const y = startY + i * (rowH + gap);
        const s = getRowStyle(row.state);
        const iconColor = row.state === "at risk" || row.state === "review" || row.state === "nudge"
          ? "#f0a875" : SKY;
        const stateColor = STATE_COLOR[row.state] ?? `${PANEL}.45)`;
        return (
          <g key={i}>
            {/* Card bg */}
            <rect x="0" y={y} width="300" height={rowH} rx="10"
              fill={s.bg} stroke={s.border} strokeWidth="1" />
            {/* Icon circle */}
            <circle cx="25" cy={y + rowH / 2} r="14" fill={`${SKY_SOFT}.1)`} />
            <Icon d={ICONS[row.icon]} x={25} y={y + rowH / 2} size={14} color={iconColor} />
            {/* Label + note */}
            <text x="48" y={y + rowH / 2 - 5} fontSize="11.5" fontWeight="600"
              fill="rgba(255,255,255,.88)" fontFamily="Montserrat, sans-serif">{row.label}</text>
            <text x="48" y={y + rowH / 2 + 10} fontSize="9.5"
              fill={`${PANEL}.5)`} fontFamily="Montserrat, sans-serif">{row.note}</text>
            {/* State badge */}
            <text x="294" y={y + rowH / 2 + 4} fontSize="9" fontWeight="700"
              textAnchor="end" fontFamily="Montserrat, sans-serif"
              fill={stateColor} letterSpacing=".5">
              {row.state.toUpperCase()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Journey SVG — S-curve coaching path ─────────────────────────────────────
// Exact arc points from prototype data.
const ARC_PTS = [
  { x: 20,  y: 160, r: 7, fill: SKY,               stroke: SKY },
  { x: 84,  y: 140, r: 5, fill: NAVY,              stroke: SKY },
  { x: 128, y: 84,  r: 5, fill: NAVY,              stroke: SKY },
  { x: 170, y: 60,  r: 8, fill: AMBER,             stroke: AMBER },
  { x: 232, y: 106, r: 5, fill: NAVY,              stroke: `${PANEL}.35)` },
  { x: 288, y: 74,  r: 5, fill: NAVY,              stroke: `${PANEL}.35)` },
  { x: 320, y: 46,  r: 5, fill: NAVY,              stroke: `${PANEL}.35)` },
];

function JourneySVG() {
  const solid  = "M 20 160 C 55 155 72 148 84 140 C 96 132 114 96 128 84 C 142 72 156 62 170 60";
  const dashed = "M 170 60 C 194 58 218 100 232 106 C 246 112 272 78 288 74 C 302 70 312 52 320 46";
  return (
    <svg viewBox="0 0 340 190" className="w-full max-w-[320px]" aria-hidden="true">
      <circle cx="170" cy="60" r="20" fill={AMBER} fillOpacity="0.12" />
      <path d={solid} fill="none" stroke={SKY} strokeWidth="2.5" strokeLinecap="round" />
      <path d={dashed} fill="none" stroke={`${PANEL}.28)`} strokeWidth="2"
        strokeDasharray="6 5" strokeLinecap="round" />
      {ARC_PTS.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.r}
          fill={p.fill} stroke={p.stroke} strokeWidth="2" />
      ))}
      <text x="20"  y="178" fontSize="10" fill={`${PANEL}.5)`} fontFamily="Montserrat, sans-serif">Session 1</text>
      <text x="268" y="38"  fontSize="10" fill={`${PANEL}.5)`} fontFamily="Montserrat, sans-serif">Ongoing</text>
    </svg>
  );
}

// ─── Goals SVG ────────────────────────────────────────────────────────────────
// Exact goal rows from prototype data.
function GoalsSVG() {
  const rows = [
    { label: "Hard conversations", from: 40, to: 50 },
    { label: "Delegate the report",  from: 30, to: 50 },
    { label: "Protect deep work",    from: 50, to: 50 },
  ];
  return (
    <svg viewBox="0 0 300 160" className="w-full max-w-[300px]" aria-hidden="true">
      {[0,2,4,6,8,10].map(n => (
        <line key={n} x1={n / 10 * 240 + 30} y1="8" x2={n / 10 * 240 + 30} y2="148"
          stroke="rgba(207,230,238,.06)" strokeWidth="1" />
      ))}
      {[1,5,10].map(n => (
        <text key={n} x={n / 10 * 240 + 30} y="158" fontSize="8"
          fill={`${PANEL}.3)`} textAnchor="middle" fontFamily="Montserrat, sans-serif">{n}</text>
      ))}
      {rows.map((row, i) => {
        const y = i * 46 + 20;
        const barY = y + 14;
        const toX = row.to / 100 * 240 + 30;
        return (
          <g key={i}>
            <text x="26" y={y + 9} fontSize="9.5" fill={`${PANEL}.65)`}
              textAnchor="end" fontFamily="Montserrat, sans-serif">
              {row.label.length > 17 ? row.label.slice(0, 16) + "…" : row.label}
            </text>
            <rect x="30" y={barY} width="240" height="6" rx="3" fill="rgba(207,230,238,.1)" />
            <rect x="30" y={barY} width={row.from / 100 * 240} height="6" rx="3" fill={SKY} fillOpacity="0.4" />
            <rect x="30" y={barY} width={row.to / 100 * 240} height="6" rx="3" fill={SKY} />
            <circle cx={toX} cy={barY + 3} r="5" fill={AMBER} stroke={NAVY} strokeWidth="1.5" />
            <text x={toX + 8} y={barY + 7} fontSize="9" fill={AMBER} fontFamily="Montserrat, sans-serif">
              {(row.to / 10).toFixed(0)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Match SVG ────────────────────────────────────────────────────────────────
// Prototype: 4 filter chips at top, then 3×2 grid of coach cards.
// First 2 cards (MT, HL) are highlighted with sky avatar + "MATCH" label.
function MatchSVG({ role }: { role: OnboardingRole }) {
  const filterChips = role === "coach"
    ? ["LEADERSHIP", "TRANSITION", "EN / VN", "ICF PCC"]
    : ["HARD CONV.", "DELEGATION", "VIETNAMESE", "THIS MONTH"];
  const cards = ["MT","HL","QD","PV","TN","BK"];
  const cardW = 89, cardH = 84, gap = 8, startX = 4, startY = 38;
  return (
    <svg viewBox="0 0 300 230" className="w-full max-w-[300px]" aria-hidden="true">
      {/* Filter chips row */}
      {filterChips.map((label, i) => {
        const active = i < 2;
        const chipFg = active ? "#f0a875" : `${PANEL}.55)`;
        const chipBg = active ? `${AMBER_SOFT}.18)` : "rgba(255,255,255,.06)";
        const chipBd = active ? `${AMBER_SOFT}.5)`  : "rgba(255,255,255,.15)";
        const chipW  = label.length * 7.2 + 16;
        const chipX  = i === 0 ? 0 : i === 1 ? filterChips[0].length * 7.2 + 24
                     : i === 2 ? (filterChips[0].length + filterChips[1].length) * 7.2 + 48
                     : (filterChips[0].length + filterChips[1].length + filterChips[2].length) * 7.2 + 72;
        return (
          <g key={i}>
            <rect x={chipX} y="0" width={chipW} height="22" rx="11"
              fill={chipBg} stroke={chipBd} strokeWidth="1" />
            <text x={chipX + chipW / 2} y="14.5" fontSize="8.5" fontWeight="700"
              fill={chipFg} textAnchor="middle"
              fontFamily="Montserrat, sans-serif" letterSpacing=".3">{label}</text>
          </g>
        );
      })}
      {/* 3×2 card grid */}
      {cards.map((ini, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x   = startX + col * (cardW + gap);
        const y   = startY + row * (cardH + gap);
        const active = i < 2;
        const avBg = active ? SKY : "rgba(255,255,255,.14)";
        const avFg = active ? NAVY : "#cfe6ee";
        const cardBg = active ? `${SKY_SOFT}.1)`  : "rgba(255,255,255,.04)";
        const cardBd = active ? `${SKY_SOFT}.38)` : "rgba(255,255,255,.1)";
        return (
          <g key={i} opacity={i > 2 ? 0.45 : 1}>
            <rect x={x} y={y} width={cardW} height={cardH} rx="10"
              fill={cardBg} stroke={cardBd} strokeWidth="1" />
            {/* Avatar */}
            <circle cx={x + 18} cy={y + 20} r="12" fill={avBg} />
            <text x={x + 18} y={y + 24} fontSize="9" fontWeight="700"
              fill={avFg} textAnchor="middle" fontFamily="Montserrat, sans-serif">{ini}</text>
            {/* Grey line placeholders (name + bio) */}
            <rect x={x + 8} y={y + 38} width={cardW - 20} height="7" rx="3.5"
              fill="rgba(207,230,238,.12)" />
            <rect x={x + 8} y={y + 50} width={cardW - 34} height="5" rx="2.5"
              fill="rgba(207,230,238,.07)" />
            {/* MATCH label for top 2 */}
            {active && (
              <text x={x + 8} y={y + 76} fontSize="9" fontWeight="700"
                fill={AMBER} fontFamily="Montserrat, sans-serif" letterSpacing=".5">MATCH</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Calendar SVG ─────────────────────────────────────────────────────────────
// Row-major indexing: idx = row*5 + col  →  col = idx%5, row = floor(idx/5)
// Prototype: open=[1,2,6,7,8,11,12,16,17,18,21,22]; coach booked=[7,17], coachee booked=[12]
// idx 7 = Wed row1 (amber 14:00), idx 17 = Wed row3 (amber 14:00)
function CalendarSVG({ role }: { role: OnboardingRole }) {
  const days   = ["MON", "TUE", "WED", "THU", "FRI"];
  const open   = [1,2,6,7,8,11,12,16,17,18,21,22];
  const booked = role === "coach" ? [7,17] : [12];
  const slots  = Array.from({ length: 25 }, (_, idx) => ({
    isBooked: booked.includes(idx),
    isOpen:   open.includes(idx),
  }));
  // Cell dimensions matching prototype: wide tall cells
  const cellW = 50, cellH = 34, gapX = 5, gapY = 6, startY = 28;
  const totalW = 5 * cellW + 4 * gapX;   // 270
  return (
    <svg viewBox={`0 0 ${totalW} 230`} className="w-full max-w-[280px]" aria-hidden="true">
      {/* Day headers */}
      {days.map((d, ci) => (
        <text key={ci} x={ci * (cellW + gapX) + cellW / 2} y="18"
          fontSize="9.5" fill={`${PANEL}.5)`} textAnchor="middle"
          fontFamily="Montserrat, sans-serif" fontWeight="700" letterSpacing=".5">{d}</text>
      ))}
      {/* Slots — row-major: col = idx%5, row = floor(idx/5) */}
      {slots.map((slot, idx) => {
        const col = idx % 5;
        const row = Math.floor(idx / 5);
        const x   = col * (cellW + gapX);
        const y   = startY + row * (cellH + gapY);
        const bg  = slot.isBooked ? AMBER
                  : slot.isOpen   ? `${SKY_SOFT}.28)` : "rgba(255,255,255,.04)";
        const bd  = slot.isBooked ? AMBER
                  : slot.isOpen   ? `${SKY_SOFT}.55)` : "rgba(255,255,255,.07)";
        return (
          <g key={idx}>
            <rect x={x} y={y} width={cellW} height={cellH} rx="7"
              fill={bg} stroke={bd} strokeWidth="1" />
            {slot.isBooked && (
              <text x={x + cellW / 2} y={y + cellH / 2 + 4} fontSize="9"
                fill="white" textAnchor="middle"
                fontFamily="Montserrat, sans-serif" fontWeight="700">14:00</text>
            )}
          </g>
        );
      })}
      {/* Legend */}
      <circle cx="8" cy="222" r="5" fill={`${SKY_SOFT}.3)`} stroke={`${SKY_SOFT}.6)`} strokeWidth="1" />
      <text x="18" y="226" fontSize="9" fill={`${PANEL}.45)`} fontFamily="Montserrat, sans-serif">Open</text>
      <rect x="60" y="216" width="10" height="10" rx="3" fill={AMBER} />
      <text x="74" y="226" fontSize="9" fill={`${PANEL}.45)`} fontFamily="Montserrat, sans-serif">Booked</text>
    </svg>
  );
}

// ─── Privacy SVG ──────────────────────────────────────────────────────────────
// Prototype layout: "INSIDE THE SESSION" box (sky border) with pill chips,
// centred lock icon divider, "WHAT THE ORG RECEIVES" dashed box with pill chips.
function PrivacySVG({ role }: { role: OnboardingRole }) {
  const insideWho = role === "sponsor"
    ? [{ i: "LN", label: "Each leader" }, { i: "CO", label: "Their coach" }]
    : [{ i: "LN", label: "You" },         { i: "MT", label: "Your coach" }];
  const insideItems = ["Session notes", "Recordings", "Goal wording", "Everything said"];
  const outsideLabel = role === "coachee"
    ? "WHAT LEAVES THE ROOM"
    : role === "sponsor"
    ? "WHAT YOUR ACCOUNT RECEIVES"
    : "WHAT THE ORGANISATION RECEIVES";
  const outsideItems = role === "coachee"
    ? ["A summary you choose to share", "Nothing else"]
    : ["Attendance", "Sessions used", "Average goal growth"];

  // Pill chip helper: returns { x, y, w, h }
  // We'll lay them out in rows inside a box.
  const chipH  = 22;
  const chipPX = 10;   // horizontal padding
  const font   = 9.5;
  const charW  = 6.2;  // approx px per character at font 9.5

  function chipW(label: string) { return label.length * charW + chipPX * 2; }

  // Place chips in rows within maxW, returning [{x,y,label}]
  function placeChips(labels: string[], startX: number, startY: number, maxW: number) {
    const rows: { x: number; y: number; label: string }[] = [];
    let cx = startX, cy = startY;
    for (const label of labels) {
      const w = chipW(label);
      if (cx + w > startX + maxW && cx > startX) { cx = startX; cy += chipH + 5; }
      rows.push({ x: cx, y: cy, label });
      cx += w + 8;
    }
    return rows;
  }

  const insideChips  = placeChips(insideItems,  10, 76, 280);
  const outsideChips = placeChips(outsideItems, 10, 192, 280);
  const insideRows   = insideChips.length  > 0 ? insideChips[insideChips.length - 1].y  - 76  + chipH : 0;
  const insideBoxH   = 70 + insideRows + chipH + 10;
  const lockY        = insideBoxH + 16;
  const outsideBoxY  = lockY + 22;
  const outsideLastY = outsideChips.length > 0 ? outsideChips[outsideChips.length - 1].y : 192;
  const outsideBoxH  = outsideLastY - outsideBoxY + chipH + 14;
  const totalH       = outsideBoxY + outsideBoxH + 4;

  return (
    <svg viewBox={`0 0 300 ${Math.max(totalH, 260)}`} className="w-full max-w-[300px]" aria-hidden="true">
      {/* ── INSIDE THE SESSION box ── */}
      <rect x="0" y="0" width="300" height={insideBoxH} rx="12"
        fill="rgba(61,180,208,.06)" stroke={`${SKY_SOFT}.35)`} strokeWidth="1.5" />

      {/* Header */}
      <Icon d={ICONS.lock} x={16} y={17} size={14} color={SKY} />
      <text x="30" y="21" fontSize="9.5" fontWeight="700" fill={SKY}
        fontFamily="Montserrat, sans-serif" letterSpacing="1">INSIDE THE SESSION</text>

      {/* Who's inside */}
      {insideWho.map((w, i) => (
        <g key={i}>
          <circle cx={16 + i * 48} cy="48" r="13"
            fill={`${SKY_SOFT}.22)`} stroke={`${SKY_SOFT}.55)`} strokeWidth="1.5" />
          <text x={16 + i * 48} y="52" fontSize="9" fontWeight="700" fill={SKY}
            textAnchor="middle" fontFamily="Montserrat, sans-serif">{w.i}</text>
          <text x={28 + i * 48} y="52" fontSize="10" fill={`${PANEL}.65)`}
            fontFamily="Montserrat, sans-serif">{w.label}</text>
        </g>
      ))}

      {/* Inside item pill chips */}
      {insideChips.map(({ x, y, label }) => (
        <g key={label}>
          <rect x={x} y={y} width={chipW(label)} height={chipH} rx={chipH / 2}
            fill="rgba(255,255,255,.07)" stroke="rgba(207,230,238,.22)" strokeWidth="1" />
          <text x={x + chipW(label) / 2} y={y + chipH / 2 + 4} fontSize={font}
            fill={`${PANEL}.7)`} textAnchor="middle" fontFamily="Montserrat, sans-serif">{label}</text>
        </g>
      ))}

      {/* ── Lock divider ── */}
      <line x1="0" y1={lockY - 4} x2="135" y2={lockY - 4}
        stroke="rgba(207,230,238,.1)" strokeWidth="1" />
      <Icon d={ICONS.lock} x={150} y={lockY} size={16} color={`${PANEL}.3)`} />
      <line x1="165" y1={lockY - 4} x2="300" y2={lockY - 4}
        stroke="rgba(207,230,238,.1)" strokeWidth="1" />

      {/* ── OUTSIDE box ── */}
      <rect x="0" y={outsideBoxY} width="300" height={outsideBoxH} rx="12"
        fill="rgba(255,255,255,.03)"
        stroke="rgba(207,230,238,.18)" strokeWidth="1" strokeDasharray="5 4" />

      <text x="10" y={outsideBoxY + 17} fontSize="9" fontWeight="700"
        fill={`${PANEL}.5)`} fontFamily="Montserrat, sans-serif" letterSpacing="1">
        {outsideLabel}
      </text>

      {/* Outside item pill chips */}
      {outsideChips.map(({ x, y, label }) => {
        const adjustedY = y - 192 + outsideBoxY + 24;
        return (
          <g key={label}>
            <rect x={x} y={adjustedY} width={chipW(label)} height={chipH} rx={chipH / 2}
              fill="rgba(255,255,255,.07)" stroke="rgba(207,230,238,.2)" strokeWidth="1" />
            <text x={x + chipW(label) / 2} y={adjustedY + chipH / 2 + 4} fontSize={font}
              fill={`${PANEL}.65)`} textAnchor="middle" fontFamily="Montserrat, sans-serif">{label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Growth SVG ───────────────────────────────────────────────────────────────
// Exact growthPts from prototype: [{x,y}] trending upward.
const GROWTH_PTS = [
  { x: 20,  y: 120 },
  { x: 70,  y: 104 },
  { x: 120, y: 92  },
  { x: 170, y: 62  },
  { x: 230, y: 34  },
];
const GROWTH_STATS = [
  { value: "3",   label: "Goals" },
  { value: "+1.2",label: "Avg growth" },
  { value: "6",   label: "Sessions" },
];

function GrowthSVG() {
  const toPath = (pts: typeof GROWTH_PTS, offset: number) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y + offset}`).join(" ");
  return (
    <svg viewBox="0 0 260 180" className="w-full max-w-[260px]" aria-hidden="true">
      {/* Grid lines */}
      {[30, 70, 110].map(y => (
        <line key={y} x1="12" y1={y} x2="248" y2={y}
          stroke="rgba(207,230,238,.06)" strokeWidth="1" />
      ))}
      {/* 3 offset lines to simulate multiple goals */}
      {[0, 8, -8].map((offset, li) => {
        const colors = [SKY, AMBER, `${PANEL}.4)`];
        const path = toPath(GROWTH_PTS, offset);
        return (
          <g key={li}>
            <path d={path} fill="none" stroke={colors[li]} strokeWidth={li === 0 ? 2.5 : 1.8}
              strokeLinecap="round" strokeLinejoin="round"
              strokeOpacity={li === 0 ? 1 : 0.7} />
            <circle cx={GROWTH_PTS[4].x} cy={GROWTH_PTS[4].y + offset} r="4.5"
              fill={colors[li]} stroke={NAVY} strokeWidth="1.5" />
          </g>
        );
      })}
      {/* Session axis */}
      {GROWTH_PTS.map((p, i) => (
        <text key={i} x={p.x} y="140" fontSize="9" fill={`${PANEL}.3)`}
          textAnchor="middle" fontFamily="Montserrat, sans-serif">S{i + 1}</text>
      ))}
      {/* Stats */}
      {GROWTH_STATS.map((s, i) => {
        const x = i * 86 + 4;
        return (
          <g key={i}>
            <text x={x} y="163" fontSize="18" fontWeight="300" fill="rgba(255,255,255,.9)"
              fontFamily="Fraunces, serif">{s.value}</text>
            <text x={x} y="176" fontSize="8.5" fill={`${PANEL}.45)`}
              fontFamily="Montserrat, sans-serif">{s.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Cohort SVG — 12 leader dots + legend ─────────────────────────────────────
// cohortDots from prototype: 9 on-track (sky), 2 at-risk (amber), 1 not-enrolled (grey).
function CohortSVG() {
  const dots = Array.from({ length: 12 }, (_, i) => {
    const on   = i < 9;
    const risk = i === 9 || i === 10;
    return {
      label: String(i + 1).padStart(2, "0"),
      bg:     on ? `${SKY_SOFT}.22)` : (risk ? `${AMBER_SOFT}.18)` : "rgba(255,255,255,.04)"),
      border: on ? `${SKY_SOFT}.6)`  : (risk ? `${AMBER_SOFT}.6)`  : "rgba(255,255,255,.14)"),
      fg:     on ? "#7dcfe3"          : (risk ? "#f0a875"           : `${PANEL}.45)`),
    };
  });
  const legend = [
    { label: "On track · 9",    bg: `${SKY_SOFT}.22)`,   border: `${SKY_SOFT}.6)` },
    { label: "At risk · 2",     bg: `${AMBER_SOFT}.18)`, border: `${AMBER_SOFT}.6)` },
    { label: "Not enrolled · 1",bg: "rgba(255,255,255,.04)", border: "rgba(255,255,255,.14)" },
  ];
  const cols = 4, dotW = 52, dotH = 32, gapX = 8, gapY = 8;
  return (
    <svg viewBox="0 0 300 195" className="w-full max-w-[300px]" aria-hidden="true">
      <text x="0" y="12" fontSize="9" fill={`${PANEL}.4)`} fontWeight="600"
        fontFamily="Montserrat, sans-serif" letterSpacing="1">OPS DIRECTORS Q3</text>
      {dots.map((dot, i) => {
        const ci = i % cols;
        const ri = Math.floor(i / cols);
        const x  = ci * (dotW + gapX);
        const y  = 18 + ri * (dotH + gapY);
        return (
          <g key={i}>
            <rect x={x} y={y} width={dotW} height={dotH} rx="8"
              fill={dot.bg} stroke={dot.border} strokeWidth="1" />
            <text x={x + dotW / 2} y={y + dotH / 2 + 5} fontSize="12" fontWeight="600"
              fill={dot.fg} textAnchor="middle" fontFamily="Montserrat, sans-serif">{dot.label}</text>
          </g>
        );
      })}
      {/* Legend */}
      {legend.map((l, i) => {
        const x = i === 0 ? 0 : i === 1 ? 102 : 194;
        return (
          <g key={i}>
            <rect x={x} y="150" width="10" height="10" rx="3"
              fill={l.bg} stroke={l.border} strokeWidth="1" />
            <text x={x + 14} y="159" fontSize="8.5" fill={`${PANEL}.5)`}
              fontFamily="Montserrat, sans-serif">{l.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Report SVG ───────────────────────────────────────────────────────────────
// reportRows from prototype: ✓ = accessible, 🔒 = withheld.
function ReportSVG() {
  const rows = [
    { ok: true,  label: "On-track rate",  value: "9 / 12" },
    { ok: true,  label: "Sessions used",  value: "31 / 72" },
    { ok: true,  label: "Avg goal growth",value: "+1.4" },
    { ok: false, label: "Session notes",  value: "withheld" },
    { ok: false, label: "Goal wording",   value: "withheld" },
  ];
  return (
    <svg viewBox="0 0 300 200" className="w-full max-w-[300px]" aria-hidden="true">
      {/* Page shell */}
      <rect x="0" y="0" width="300" height="196" rx="10"
        fill="rgba(255,255,255,.05)" stroke="rgba(207,230,238,.1)" strokeWidth="1" />
      {/* Header strip */}
      <rect x="0" y="0" width="300" height="30" rx="10"
        fill={`${SKY_SOFT}.12)`} />
      <rect x="0" y="20" width="300" height="10" fill={`${SKY_SOFT}.12)`} />
      <text x="14" y="19" fontSize="9" fontWeight="700" fill={SKY}
        fontFamily="Montserrat, sans-serif" letterSpacing="1">CLARIVA SPONSOR SUMMARY</text>
      <text x="286" y="19" fontSize="8.5" fill={`${PANEL}.4)`}
        textAnchor="end" fontFamily="Montserrat, sans-serif">Q3 2026</text>
      {/* Rows */}
      {rows.map((row, i) => {
        const y = i * 30 + 44;
        const markFg = row.ok ? "#2f7a52" : "#a8563a";
        const markBg = row.ok ? "rgba(47,122,82,.2)" : "rgba(168,86,58,.2)";
        const valueFg = row.ok ? "rgba(255,255,255,.85)" : `${PANEL}.35)`;
        return (
          <g key={i}>
            {/* Separator */}
            {i > 0 && <line x1="14" y1={y - 6} x2="286" y2={y - 6}
              stroke="rgba(207,230,238,.07)" strokeWidth="1" />}
            {/* Mark circle */}
            <circle cx="24" cy={y + 7} r="8" fill={markBg} />
            <text x="24" y={y + 11} fontSize="10" fill={markFg}
              textAnchor="middle" fontFamily="Montserrat, sans-serif">
              {row.ok ? "✓" : "🔒"}
            </text>
            <text x="38" y={y + 12} fontSize="10.5" fill={`${PANEL}.7)`}
              fontFamily="Montserrat, sans-serif">{row.label}</text>
            <text x="286" y={y + 12} fontSize="10.5" fill={valueFg}
              textAnchor="end" fontFamily="Montserrat, sans-serif">{row.value}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Graphic dispatcher ───────────────────────────────────────────────────────
// practiceRows data keyed by graphic type + role (from prototype renderVals).
const PRACTICE_ROWS: Record<string, (role: OnboardingRole) => PracticeRow[]> = {
  practice: (_role) => [
    { label: "My coach profile",  note: "Specialties, bio, accreditation", state: "step 1",  icon: "card"  },
    { label: "My availability",   note: "Weekly windows and buffers",      state: "step 2",  icon: "clock" },
    { label: "My clients",        note: "9 active across 3 programmes",   state: "live",    icon: "users" },
    { label: "Sessions & notes",  note: "Private to each pair",           state: "locked",  icon: "lock"  },
  ],
  peer: (_role) => [
    { label: "Peer coaching · give",    note: "You coach another accredited coach", state: "opt in", icon: "users" },
    { label: "Peer coaching · receive", note: "A peer coaches you",                 state: "opt in", icon: "msg"   },
    { label: "Find a coach",            note: "Book a coach for yourself",          state: "open",   icon: "search"},
    { label: "Practice analytics",      note: "Hours, peer sessions, reflections",  state: "record", icon: "chart" },
  ],
  clients: (role) => role === "sponsor" ? [
    { label: "Leader 07", note: "No session in 5 weeks",         state: "at risk", icon: "bell"  },
    { label: "Leader 11", note: "Invitation sent 4 June",        state: "nudge",   icon: "msg"   },
    { label: "Leader 04", note: "On track · ratings moving",     state: "ok",      icon: "check" },
    { label: "Leader 02", note: "On track · 3 of 6 sessions",   state: "ok",      icon: "check" },
  ] : [
    { label: "Trang Hoang", note: "No session booked in 5 weeks",    state: "at risk", icon: "bell"  },
    { label: "Duc Pham",    note: "Goal ratings flat since June",     state: "review",  icon: "chart" },
    { label: "Lan Nguyen",  note: "On track · session 2 of 6",       state: "ok",      icon: "check" },
    { label: "Hanh Le",     note: "Final session unscheduled",        state: "book",    icon: "cal"   },
  ],
};

function StepGraphic({ type, role }: { type: GraphicType; role: OnboardingRole }) {
  switch (type) {
    case "journey":  return <JourneySVG />;
    case "goals":    return <GoalsSVG />;
    case "match":    return <MatchSVG role={role} />;
    case "calendar": return <CalendarSVG role={role} />;
    case "privacy":  return <PrivacySVG role={role} />;
    case "growth":   return <GrowthSVG />;
    case "cohort":   return <CohortSVG />;
    case "report":   return <ReportSVG />;
    case "practice":
    case "peer":
    case "clients":
      return <PracticeRowsSVG rows={PRACTICE_ROWS[type](role)} />;
  }
}

// ─── Bullet styles ────────────────────────────────────────────────────────────
const BULLET_STYLES: Record<BulletKind, { box: string; label: string; dot: string }> = {
  in: { box: "border-primary/20 bg-primary/5",    label: "text-primary",  dot: "bg-primary" },
  ok: { box: "border-success/25 bg-success/10",   label: "text-success",  dot: "bg-success" },
  no: { box: "border-warning/30 bg-warning/10",   label: "text-warning",  dot: "bg-warning" },
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
  const step    = steps[index];
  const isLast  = index === steps.length - 1;
  const gList   = STEP_GRAPHICS[role];
  const graphic = gList[Math.min(index, gList.length - 1)];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onSkip(); }}>
      <DialogContent
        className="max-w-3xl gap-0 overflow-x-hidden overflow-y-auto p-0 max-h-[90vh]"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{step.title}</DialogTitle>

        <div className="grid grid-cols-1 md:grid-cols-2 md:min-h-[480px]">

          {/* ── Left panel ── */}
          <div className="relative flex flex-col overflow-hidden bg-secondary">
            {/* Ambient glows */}
            <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-8 right-2 h-36 w-36 rounded-full bg-accent/8 blur-3xl" />

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-4">
              <img src={clarivaLogo} alt="Clariva" className="h-[18px] w-auto opacity-75" />
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/40">
                {ROLE_LABEL[role]}
              </span>
            </div>

            {/* Graphic */}
            <div className="flex flex-1 items-center justify-center px-5 py-6 md:py-3">
              <StepGraphic type={graphic} role={role} />
            </div>

            {/* Step rail */}
            <div className="flex items-end border-t border-white/8 px-3 pb-1 pt-2">
              {steps.map((s, i) => {
                const active = i === index;
                const past   = i < index;
                return (
                  <button
                    key={i}
                    onClick={() => setIndex(i)}
                    className="flex min-w-0 flex-1 flex-col items-start pb-1.5 pt-1 text-left transition-opacity"
                    style={{ opacity: active ? 1 : 0.42 }}
                    aria-current={active ? "step" : undefined}
                  >
                    {/* Underline bar */}
                    <span
                      className="mb-1.5 h-0.5 w-full rounded-full transition-colors duration-300"
                      style={{
                        backgroundColor: active ? AMBER : past ? SKY : "rgba(207,230,238,.18)",
                      }}
                    />
                    {/* Label */}
                    <span
                      className="line-clamp-3 text-[7.5px] font-bold uppercase leading-tight tracking-wide"
                      style={{ color: active ? "#fff" : "rgba(207,230,238,.6)" }}
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
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-8 pb-4 pt-7">
              {/* Kicker + count row */}
              <div className="mb-4 flex items-center justify-between gap-4">
                <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-primary">
                  {step.kicker}
                </p>
                <span className="shrink-0 text-[11px] text-gray-400">
                  {index + 1}&nbsp;/&nbsp;{steps.length}
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
                onClick={() => isLast ? onFinish() : setIndex((i) => i + 1)}
                className="rounded-xl bg-accent px-7 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 active:opacity-80"
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
