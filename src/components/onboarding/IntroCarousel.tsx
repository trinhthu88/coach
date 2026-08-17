import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { OnboardingBullet, OnboardingStep, BulletKind, OnboardingRole } from "@/lib/onboarding/content";
import clarivaLogo from "@/assets/clariva-logo-dark.png";
import type { TFunction } from "i18next";

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

function PracticeRowsSVG({ rows, t }: { rows: PracticeRow[]; t: TFunction<"onboarding"> }) {
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
            {/* State badge — right-anchored so translated length never collides with the label/note on the left */}
            <text x="294" y={y + rowH / 2 + 4} fontSize="9" fontWeight="700"
              textAnchor="end" fontFamily="Montserrat, sans-serif"
              fill={stateColor} letterSpacing=".5">
              {t(`carousel.stateLabel.${row.state}`)}
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

function JourneySVG({ t }: { t: TFunction<"onboarding"> }) {
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
      <text x="20"  y="178" fontSize="10" fill={`${PANEL}.5)`} fontFamily="Montserrat, sans-serif">{t("carousel.journey.session1")}</text>
      {/* Right-anchored near the right edge so a longer translation grows left into open space instead of off the viewBox */}
      <text x="325" y="38" fontSize="10" fill={`${PANEL}.5)`} textAnchor="end" fontFamily="Montserrat, sans-serif">{t("carousel.journey.ongoing")}</text>
    </svg>
  );
}

// ─── Goals SVG ────────────────────────────────────────────────────────────────
// Matches the prototype exactly:
//   • Label LEFT-ALIGNED bold white on same row as rating "4 → 5" RIGHT-ALIGNED
//   • Full-width bar below (track + sky fill up to "to" rating)
//   • Scale "1 · 5 · 10" below each individual bar
function GoalsSVG({ t }: { t: TFunction<"onboarding"> }) {
  const rows = [
    { label: t("carousel.goals.hardConversations"), from: 4, to: 5 },
    { label: t("carousel.goals.delegateReport"), from: 3, to: 5 },
    { label: t("carousel.goals.protectDeepWork"),   from: 5, to: 5 },
  ];
  const W = 280, barH = 8, maxR = 10;
  const blockH = 56; // label row (18) + bar (barH=8) + scale row (14) + gap
  return (
    <svg viewBox={`0 0 ${W} ${rows.length * blockH}`}
      className="w-full max-w-[280px]" aria-hidden="true">
      {rows.map((row, i) => {
        const baseY = i * blockH;
        const toW   = row.to   / maxR * W;
        const fromW = row.from / maxR * W;
        return (
          <g key={i}>
            {/* Label — left-aligned, bold */}
            <text x="0" y={baseY + 13} fontSize="11" fontWeight="600"
              fill="rgba(255,255,255,.9)" fontFamily="Montserrat, sans-serif">{row.label}</text>
            {/* Rating — right-aligned */}
            <text x={W} y={baseY + 13} fontSize="10" fontWeight="500"
              fill={`${PANEL}.6)`} textAnchor="end" fontFamily="Montserrat, sans-serif">
              {row.from} → {row.to}
            </text>
            {/* Bar track */}
            <rect x="0" y={baseY + 20} width={W} height={barH} rx={barH / 2}
              fill="rgba(207,230,238,.1)" />
            {/* "from" fill (dimmer sky) */}
            <rect x="0" y={baseY + 20} width={fromW} height={barH} rx={barH / 2}
              fill={SKY} fillOpacity="0.45" />
            {/* "to" fill (bright sky, overlays from) */}
            <rect x="0" y={baseY + 20} width={toW} height={barH} rx={barH / 2}
              fill={SKY} />
            {/* Scale labels under bar */}
            {([1, 5, 10] as const).map((n, si) => {
              const sx = n / maxR * W;
              const anchor = si === 0 ? "start" : si === 2 ? "end" : "middle";
              return (
                <text key={n} x={sx} y={baseY + barH + 26} fontSize="9"
                  fill={`${PANEL}.3)`} textAnchor={anchor}
                  fontFamily="Montserrat, sans-serif">{n}</text>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Match SVG ────────────────────────────────────────────────────────────────
// Filter chips wrap two-per-row (rather than a single row) so translated labels —
// which run longer than the English originals — never overflow the viewBox; row
// count and the card grid's start position both derive from that, so it stays
// correct regardless of string length.
function MatchSVG({ role, t }: { role: OnboardingRole; t: TFunction<"onboarding"> }) {
  const filterChips = t(
    role === "coach" ? "carousel.match.filtersCoach" : "carousel.match.filtersCoachee",
    { returnObjects: true }
  ) as string[];
  const matchLabel = t("carousel.match.matchLabel");
  const cards = ["MT","HL","QD","PV","TN","BK"];
  const cardW = 89, cardH = 84, cardGap = 8, startX = 4;
  const chipH = 22, chipGap = 8, chipRowGap = 6, chipPad = 9, charW = 6.4;

  const chipRows: string[][] = [];
  for (let i = 0; i < filterChips.length; i += 2) chipRows.push(filterChips.slice(i, i + 2));
  const chipsAreaH = chipRows.length * (chipH + chipRowGap);
  const startY = chipsAreaH + 12;
  const totalH = startY + 2 * (cardH + cardGap) - cardGap;

  return (
    <svg viewBox={`0 0 300 ${totalH}`} className="w-full max-w-[300px]" aria-hidden="true">
      {/* Filter chips — wrapped two per row, width computed from each label's own length */}
      {chipRows.map((row, ri) => {
        let cx = 0;
        return row.map((label, ci) => {
          const i = ri * 2 + ci;
          const w = label.length * charW + chipPad * 2;
          const x = cx;
          cx += w + chipGap;
          const y = ri * (chipH + chipRowGap);
          const active = i < 2;
          return (
            <g key={i}>
              <rect x={x} y={y} width={w} height={chipH} rx={chipH / 2}
                fill={active ? `${AMBER_SOFT}.18)` : "rgba(255,255,255,.06)"}
                stroke={active ? `${AMBER_SOFT}.5)` : "rgba(255,255,255,.15)"} strokeWidth="1" />
              <text x={x + w / 2} y={y + 14.5} fontSize="8.5" fontWeight="700"
                fill={active ? "#f0a875" : `${PANEL}.55)`}
                textAnchor="middle" fontFamily="Montserrat, sans-serif" letterSpacing=".3">{label}</text>
            </g>
          );
        });
      })}
      {/* 3×2 card grid */}
      {cards.map((ini, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x   = startX + col * (cardW + cardGap);
        const y   = startY + row * (cardH + cardGap);
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
                fill={AMBER} fontFamily="Montserrat, sans-serif" letterSpacing=".5">{matchLabel}</text>
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
function CalendarSVG({ role, t }: { role: OnboardingRole; t: TFunction<"onboarding"> }) {
  const days = t("carousel.calendar.days", { returnObjects: true }) as string[];
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
      <text x="18" y="226" fontSize="9" fill={`${PANEL}.45)`} fontFamily="Montserrat, sans-serif">{t("carousel.calendar.open")}</text>
      <rect x="60" y="216" width="10" height="10" rx="3" fill={AMBER} />
      <text x="74" y="226" fontSize="9" fill={`${PANEL}.45)`} fontFamily="Montserrat, sans-serif">{t("carousel.calendar.booked")}</text>
    </svg>
  );
}

// ─── Privacy SVG ──────────────────────────────────────────────────────────────
// All chip rows use a left-to-right accumulator (cx) sized from each label's own
// rendered length, rather than hand-picked fixed x coordinates — so translated
// text of any length lays out correctly without per-language tuning.
function PrivacySVG({ role, t }: { role: OnboardingRole; t: TFunction<"onboarding"> }) {
  const insideWho = role === "sponsor"
    ? [{ i: "LN", label: t("carousel.privacy.eachLeader") }, { i: "CO", label: t("carousel.privacy.theirCoach") }]
    : [{ i: "LN", label: t("carousel.privacy.you") },         { i: "MT", label: t("carousel.privacy.yourCoach") }];

  const outsideHeader = role === "coachee"
    ? t("carousel.privacy.outsideHeaderCoachee")
    : role === "sponsor"
    ? t("carousel.privacy.outsideHeaderSponsor")
    : t("carousel.privacy.outsideHeaderCoach");

  const insideChipRows: string[][] = [
    [t("carousel.privacy.sessionNotes"), t("carousel.privacy.recordings")],
    [t("carousel.privacy.goalWording"), t("carousel.privacy.everythingSaid")],
  ];

  const outsideRows: string[][] = role === "coachee"
    ? [[t("carousel.privacy.summaryShared")], [t("carousel.privacy.nothingElse")]]
    : [[t("carousel.privacy.attendance"), t("carousel.privacy.sessionsUsed")], [t("carousel.privacy.avgGoalGrowth")]];

  const chipH  = 22;
  const charW  = 6.6;
  const chipPX = 10;
  const chipGap = 8;
  const cw = (s: string) => s.length * charW + chipPX * 2;
  const avatarSpacing = 100; // wide enough for a longer second-avatar label than the English original

  const insideChipsH = insideChipRows.length * (chipH + 10);
  const outsideDataH = outsideRows.length * (chipH + 10) + 10;
  const outsideBoxH  = 20 + outsideDataH + 12;
  const insideBoxH   = 60 + insideChipsH + 8;
  const totalH       = insideBoxH + 26 + outsideBoxH + 8;
  const dividerY     = insideBoxH + 12;
  const outsideBoxY  = insideBoxH + 26;

  return (
    <svg viewBox={`0 0 300 ${totalH}`} className="w-full max-w-[300px]" aria-hidden="true">

      {/* ── INSIDE THE SESSION ── */}
      <rect x="0" y="0" width="300" height={insideBoxH} rx="12"
        fill={`${SKY_SOFT}.06)`} stroke={`${SKY_SOFT}.35)`} strokeWidth="1.5" />

      {/* Header */}
      <Icon d={ICONS.lock} x={14} y={16} size={13} color={SKY} />
      <text x="28" y="21" fontSize="9.5" fontWeight="700" fill={SKY}
        fontFamily="Montserrat, sans-serif" letterSpacing="1">{t("carousel.privacy.insideHeader")}</text>

      {/* Avatars */}
      {insideWho.map((w, i) => (
        <g key={i}>
          <circle cx={14 + i * avatarSpacing} cy="46" r="14"
            fill={`${SKY_SOFT}.22)`} stroke={`${SKY_SOFT}.55)`} strokeWidth="1.5" />
          <text x={14 + i * avatarSpacing} y="50" fontSize="9" fontWeight="700" fill={SKY}
            textAnchor="middle" fontFamily="Montserrat, sans-serif">{w.i}</text>
          <text x={32 + i * avatarSpacing} y="50" fontSize="10" fill={`${PANEL}.65)`}
            fontFamily="Montserrat, sans-serif">{w.label}</text>
        </g>
      ))}

      {/* Inside chips — each row laid out with its own accumulator */}
      {insideChipRows.map((row, ri) => {
        const y = 70 + ri * (chipH + 10);
        let cx = 10;
        return row.map((label) => {
          const w = cw(label);
          const x = cx;
          cx += w + chipGap;
          return (
            <g key={label}>
              <rect x={x} y={y} width={w} height={chipH} rx={chipH / 2}
                fill="rgba(255,255,255,.07)" stroke="rgba(207,230,238,.22)" strokeWidth="1" />
              <text x={x + w / 2} y={y + chipH / 2 + 4} fontSize="9.5"
                fill={`${PANEL}.7)`} textAnchor="middle" fontFamily="Montserrat, sans-serif">{label}</text>
            </g>
          );
        });
      })}

      {/* ── Lock divider ── */}
      <line x1="0" y1={dividerY} x2="132" y2={dividerY} stroke="rgba(207,230,238,.12)" strokeWidth="1" />
      <Icon d={ICONS.lock} x={150} y={dividerY + 2} size={16} color={`${PANEL}.28)`} />
      <line x1="168" y1={dividerY} x2="300" y2={dividerY} stroke="rgba(207,230,238,.12)" strokeWidth="1" />

      {/* ── OUTSIDE box ── */}
      <rect x="0" y={outsideBoxY} width="300" height={outsideBoxH} rx="12"
        fill="rgba(255,255,255,.03)"
        stroke="rgba(207,230,238,.2)" strokeWidth="1" strokeDasharray="5 4" />

      <text x="10" y={outsideBoxY + 18} fontSize="9" fontWeight="700"
        fill={`${PANEL}.5)`} fontFamily="Montserrat, sans-serif" letterSpacing="1">
        {outsideHeader}
      </text>

      {/* Outside chips — each row rendered with its own accumulator */}
      {outsideRows.map((row, ri) => {
        const rowY = outsideBoxY + 26 + ri * (chipH + 10);
        let cx = 10;
        return row.map((label) => {
          const w = cw(label);
          const x = cx;
          cx += w + chipGap;
          return (
            <g key={label}>
              <rect x={x} y={rowY} width={w} height={chipH} rx={chipH / 2}
                fill="rgba(255,255,255,.07)" stroke="rgba(207,230,238,.2)" strokeWidth="1" />
              <text x={x + w / 2} y={rowY + chipH / 2 + 4} fontSize="9.5"
                fill={`${PANEL}.65)`} textAnchor="middle" fontFamily="Montserrat, sans-serif">{label}</text>
            </g>
          );
        });
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

function GrowthSVG({ t }: { t: TFunction<"onboarding"> }) {
  const stats = [
    { value: "3",    label: t("carousel.growth.goals") },
    { value: "+1.2", label: t("carousel.growth.avgGrowth") },
    { value: "6",    label: t("carousel.growth.sessions") },
  ];
  const toPath = (pts: typeof GROWTH_PTS, offset: number) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y + offset}`).join(" ");
  // Column width widened from the original 86px to give translated stat labels more room.
  const colW = 92;
  return (
    <svg viewBox="0 0 280 180" className="w-full max-w-[280px]" aria-hidden="true">
      {/* Grid lines */}
      {[30, 70, 110].map(y => (
        <line key={y} x1="12" y1={y} x2="268" y2={y}
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
      {stats.map((s, i) => {
        const x = i * colW + 4;
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
function CohortSVG({ t }: { t: TFunction<"onboarding"> }) {
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
  // Stacked vertically (rather than 3 fixed-width columns) so a longer translated
  // legend label never collides with the next one — width no longer has a cap.
  const legend = [
    { label: t("carousel.cohort.onTrack"),     bg: `${SKY_SOFT}.22)`,   border: `${SKY_SOFT}.6)` },
    { label: t("carousel.cohort.atRisk"),      bg: `${AMBER_SOFT}.18)`, border: `${AMBER_SOFT}.6)` },
    { label: t("carousel.cohort.notEnrolled"), bg: "rgba(255,255,255,.04)", border: "rgba(255,255,255,.14)" },
  ];
  const cols = 4, dotW = 52, dotH = 32, gapX = 8, gapY = 8;
  const dotsBottom = 18 + Math.ceil(dots.length / cols) * (dotH + gapY) - gapY;
  const legendStartY = dotsBottom + 16;
  const legendLineH = 17;
  const totalH = legendStartY + legend.length * legendLineH + 4;
  return (
    <svg viewBox={`0 0 300 ${totalH}`} className="w-full max-w-[300px]" aria-hidden="true">
      <text x="0" y="12" fontSize="9" fill={`${PANEL}.4)`} fontWeight="600"
        fontFamily="Montserrat, sans-serif" letterSpacing="1">{t("carousel.cohort.header")}</text>
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
      {/* Legend — one label per line */}
      {legend.map((l, i) => {
        const y = legendStartY + i * legendLineH;
        return (
          <g key={i}>
            <rect x="0" y={y - 9} width="10" height="10" rx="3"
              fill={l.bg} stroke={l.border} strokeWidth="1" />
            <text x="14" y={y} fontSize="8.5" fill={`${PANEL}.5)`}
              fontFamily="Montserrat, sans-serif">{l.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Report SVG ───────────────────────────────────────────────────────────────
// reportRows from prototype: ✓ = accessible, 🔒 = withheld.
// Width widened from the original 300 to give longer translated labels (left-anchored)
// more clearance before the right-anchored value column.
function ReportSVG({ t }: { t: TFunction<"onboarding"> }) {
  const rows = [
    { ok: true,  label: t("carousel.report.onTrackRate"),   value: "9 / 12" },
    { ok: true,  label: t("carousel.report.sessionsUsed"),  value: "31 / 72" },
    { ok: true,  label: t("carousel.report.avgGoalGrowth"), value: "+1.4" },
    { ok: false, label: t("carousel.report.sessionNotes"),  value: t("carousel.report.withheld") },
    { ok: false, label: t("carousel.report.goalWording"),   value: t("carousel.report.withheld") },
  ];
  const W = 320;
  return (
    <svg viewBox={`0 0 ${W} 200`} className="w-full max-w-[320px]" aria-hidden="true">
      {/* Page shell */}
      <rect x="0" y="0" width={W} height="196" rx="10"
        fill="rgba(255,255,255,.05)" stroke="rgba(207,230,238,.1)" strokeWidth="1" />
      {/* Header strip */}
      <rect x="0" y="0" width={W} height="30" rx="10"
        fill={`${SKY_SOFT}.12)`} />
      <rect x="0" y="20" width={W} height="10" fill={`${SKY_SOFT}.12)`} />
      <text x="14" y="19" fontSize="9" fontWeight="700" fill={SKY}
        fontFamily="Montserrat, sans-serif" letterSpacing="1">{t("carousel.report.header")}</text>
      <text x={W - 14} y="19" fontSize="8.5" fill={`${PANEL}.4)`}
        textAnchor="end" fontFamily="Montserrat, sans-serif">{t("carousel.report.period")}</text>
      {/* Rows */}
      {rows.map((row, i) => {
        const y = i * 30 + 44;
        const markFg = row.ok ? "#2f7a52" : "#a8563a";
        const markBg = row.ok ? "rgba(47,122,82,.2)" : "rgba(168,86,58,.2)";
        const valueFg = row.ok ? "rgba(255,255,255,.85)" : `${PANEL}.35)`;
        return (
          <g key={i}>
            {/* Separator */}
            {i > 0 && <line x1="14" y1={y - 6} x2={W - 14} y2={y - 6}
              stroke="rgba(207,230,238,.07)" strokeWidth="1" />}
            {/* Mark circle */}
            <circle cx="24" cy={y + 7} r="8" fill={markBg} />
            <text x="24" y={y + 11} fontSize="10" fill={markFg}
              textAnchor="middle" fontFamily="Montserrat, sans-serif">
              {row.ok ? "✓" : "🔒"}
            </text>
            <text x="38" y={y + 12} fontSize="10.5" fill={`${PANEL}.7)`}
              fontFamily="Montserrat, sans-serif">{row.label}</text>
            <text x={W - 14} y={y + 12} fontSize="10.5" fill={valueFg}
              textAnchor="end" fontFamily="Montserrat, sans-serif">{row.value}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Graphic dispatcher ───────────────────────────────────────────────────────
// practiceRows data keyed by graphic type + role (from prototype renderVals).
function practiceRowsFor(type: "practice" | "peer" | "clients", role: OnboardingRole, t: TFunction<"onboarding">): PracticeRow[] {
  if (type === "practice") {
    return [
      { label: t("carousel.practice.coachProfile.label"),  note: t("carousel.practice.coachProfile.note"),  state: "step 1", icon: "card"  },
      { label: t("carousel.practice.availability.label"),  note: t("carousel.practice.availability.note"),  state: "step 2", icon: "clock" },
      { label: t("carousel.practice.clients.label"),       note: t("carousel.practice.clients.note"),       state: "live",   icon: "users" },
      { label: t("carousel.practice.sessionsNotes.label"), note: t("carousel.practice.sessionsNotes.note"), state: "locked", icon: "lock"  },
    ];
  }
  if (type === "peer") {
    return [
      { label: t("carousel.peer.give.label"),      note: t("carousel.peer.give.note"),      state: "opt in", icon: "users"  },
      { label: t("carousel.peer.receive.label"),   note: t("carousel.peer.receive.note"),   state: "opt in", icon: "msg"    },
      { label: t("carousel.peer.findCoach.label"), note: t("carousel.peer.findCoach.note"), state: "open",   icon: "search" },
      { label: t("carousel.peer.analytics.label"), note: t("carousel.peer.analytics.note"), state: "record", icon: "chart"  },
    ];
  }
  // clients
  if (role === "sponsor") {
    return [
      { label: t("carousel.clientsSponsor.leader07.label"), note: t("carousel.clientsSponsor.leader07.note"), state: "at risk", icon: "bell"  },
      { label: t("carousel.clientsSponsor.leader11.label"), note: t("carousel.clientsSponsor.leader11.note"), state: "nudge",   icon: "msg"   },
      { label: t("carousel.clientsSponsor.leader04.label"), note: t("carousel.clientsSponsor.leader04.note"), state: "ok",      icon: "check" },
      { label: t("carousel.clientsSponsor.leader02.label"), note: t("carousel.clientsSponsor.leader02.note"), state: "ok",      icon: "check" },
    ];
  }
  return [
    { label: "Trang Hoang", note: t("carousel.clientsDefault.trang.note"), state: "at risk", icon: "bell"  },
    { label: "Duc Pham",    note: t("carousel.clientsDefault.duc.note"),   state: "review",  icon: "chart" },
    { label: "Lan Nguyen",  note: t("carousel.clientsDefault.lan.note"),   state: "ok",      icon: "check" },
    { label: "Hanh Le",     note: t("carousel.clientsDefault.hanh.note"), state: "book",    icon: "cal"   },
  ];
}

function StepGraphic({ type, role, t }: { type: GraphicType; role: OnboardingRole; t: TFunction<"onboarding"> }) {
  switch (type) {
    case "journey":  return <JourneySVG t={t} />;
    case "goals":    return <GoalsSVG t={t} />;
    case "match":    return <MatchSVG role={role} t={t} />;
    case "calendar": return <CalendarSVG role={role} t={t} />;
    case "privacy":  return <PrivacySVG role={role} t={t} />;
    case "growth":   return <GrowthSVG t={t} />;
    case "cohort":   return <CohortSVG t={t} />;
    case "report":   return <ReportSVG t={t} />;
    case "practice":
    case "peer":
    case "clients":
      return <PracticeRowsSVG rows={practiceRowsFor(type, role, t)} t={t} />;
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
  const { t } = useTranslation("onboarding");
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
                {t(`carousel.roleLabel.${role}`)}
              </span>
            </div>

            {/* Graphic */}
            <div className="flex flex-1 items-center justify-center px-5 py-6 md:py-3">
              <StepGraphic type={graphic} role={role} t={t} />
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
            <div className="flex items-center gap-3 px-8 py-5">
              {/* Continue */}
              <button
                type="button"
                onClick={() => isLast ? onFinish() : setIndex((i) => i + 1)}
                className="rounded-xl bg-accent px-7 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 active:opacity-80"
              >
                {isLast ? t("carousel.takeMeIn") : t("carousel.continue")}
              </button>
              {/* Back — only shown from step 2 onwards */}
              {index > 0 && (
                <button
                  type="button"
                  onClick={() => setIndex((i) => i - 1)}
                  className="rounded-xl border border-gray-200 bg-white px-6 py-3 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
                >
                  {t("carousel.back")}
                </button>
              )}
              {/* Skip intro — pushed to far right */}
              <button
                type="button"
                onClick={onSkip}
                className="ml-auto text-sm text-gray-400 transition-colors hover:text-gray-600"
              >
                {t("carousel.skipIntro")}
              </button>
            </div>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
