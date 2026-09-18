import type { ReactNode } from "react";
import { useLearnerCanonicalProgress } from "@/hooks/useLearnerCanonicalProgress";

/**
 * Approved prototype's navy Session Detail hero — shared by the
 * coaching/peer (SessionDetail.tsx) and mentoring (MentoringSessionDetail.tsx)
 * pages so both present the same shell, while each page keeps its own
 * source-specific body content, mutations, and actions untouched below it.
 * Triads already have their own dedicated hero (TriadGroupHero) matching
 * this same navy language, so this component isn't used there.
 *
 * Programme/cohort context resolves through the session's own enrollment_id
 * via the same canonical engine every other learner screen reads
 * (useLearnerCanonicalProgress) — never inferred from a date, and omitted
 * entirely when the enrollment can't be resolved rather than showing a
 * blank or fabricated label.
 */
export function SessionDetailHero({
  type,
  title,
  enrollmentId,
  dateLabel,
  roleLabel,
  counterpartName,
  status,
  actions,
}: {
  /** Eyebrow label — e.g. "Coaching", "Mentoring", "Peer Coaching". */
  type: string;
  title: string;
  enrollmentId: string | null | undefined;
  dateLabel: string;
  /** e.g. "Coach", "Mentor", "Peer coach" — role of the counterpart shown next to their name. */
  roleLabel: string;
  counterpartName: string | null;
  status: { label: string; className: string };
  actions?: ReactNode;
}) {
  const { progress } = useLearnerCanonicalProgress(enrollmentId ?? undefined);
  const contextLine = [progress?.programme_label, progress?.cohort_label].filter(Boolean).join(" · ");

  return (
    <div className="rounded-[18px] bg-secondary p-6 text-secondary-foreground shadow-[0_18px_55px_-30px_rgba(6,47,62,0.6)] sm:p-7">
      <p className="text-[9.5px] font-bold uppercase tracking-[.22em] text-primary-glow">{type}</p>
      <h1 className="font-display mt-2 text-[clamp(1.7rem,3.4vw,2.4rem)] leading-[1.08] tracking-[-0.02em]">{title}</h1>
      {contextLine && <p className="mt-1.5 text-[12.5px] text-white/65">{contextLine}</p>}

      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <span className="rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-white">{dateLabel}</span>
        {counterpartName && (
          <span className="rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-white">
            {roleLabel} · {counterpartName}
          </span>
        )}
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest ${status.className}`}>
          {status.label}
        </span>
      </div>

      {actions && <div className="mt-5 flex flex-wrap gap-2.5">{actions}</div>}
    </div>
  );
}
