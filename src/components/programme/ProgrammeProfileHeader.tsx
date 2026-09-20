import type { ReactNode } from "react";
import { Pill } from "@/pages/admin/_shared";
import { profileInitials } from "@/lib/programmeProfile";
import { HeaderMeta } from "./primitives";

export interface ProgrammeProfileHeaderProps {
  name: string;
  eyebrow: string;
  subtitle: string;
  metas: { label: string; value: string }[];
  status?: { tone: "success" | "warning" | "destructive" | "muted"; label: string } | null;
  trailing?: ReactNode;
}

/** The navy profile banner — same composition for a sponsor viewing a leader and a learner viewing themselves. */
export function ProgrammeProfileHeader({ name, eyebrow, subtitle, metas, status, trailing }: ProgrammeProfileHeaderProps) {
  return (
    <header className="mt-[14px] flex flex-wrap items-center justify-between gap-6 rounded-[16px] bg-[#062f3e] px-6 py-[26px] text-white sm:px-7">
      <div className="flex min-w-0 items-center gap-[18px]">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-[16px] bg-white/15 text-lg font-semibold">{profileInitials(name)}</div>
        <div className="min-w-0">
          <div className="text-[9.5px] font-bold uppercase tracking-[.24em] text-[#3db4d0]">{eyebrow}</div>
          <h1 className="mt-1.5 truncate font-serif text-[27px] font-normal leading-tight tracking-[-.02em]">{name}</h1>
          <p className="mt-1.5 truncate text-xs text-white/60">{subtitle}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-6">
        {metas.map((meta) => (
          <HeaderMeta key={meta.label} label={meta.label} value={meta.value} />
        ))}
        {status && (
          <Pill tone={status.tone} className="text-[10px] uppercase tracking-[.1em]">
            {status.label}
          </Pill>
        )}
        {trailing}
      </div>
    </header>
  );
}
