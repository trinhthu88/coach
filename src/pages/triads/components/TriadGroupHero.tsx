import { useTranslation } from "react-i18next";
import { CheckCircle2, Users } from "lucide-react";
import { formatProfileDate } from "@/lib/programmeProfile";
import type { TriadGroupEntry } from "@/hooks/triads/useMyTriads";

function initials(name: string) {
  return (name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

/** "My Triad group" card — white, per the approved prototype's Triads workspace (paired with the navy "Next Triad session" card, TriadSessionCard, for contrast). */
export function TriadGroupHero({ entry }: { entry: TriadGroupEntry }) {
  const { t } = useTranslation("triads");
  const { unitNumber, members, session, trainingWeek, dueOn } = entry;
  const responseBySlot = new Map((session?.responses ?? []).map((r) => [r.slot, r.response]));

  return (
    <section className="rounded-[18px] border border-border bg-card p-6 shadow-sm sm:p-7">
      <p className="inline-flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[.22em] text-primary">
        <Users className="h-3.5 w-3.5" /> {t("myGroup.label")}
      </p>
      <h3 className="font-display mt-3 text-[1.6rem] font-light leading-[1.15] tracking-[-0.025em] sm:text-[1.85rem]">
        {unitNumber != null ? t("roundLabel", { n: unitNumber }) : t("myGroup.label")}
      </h3>
      {entry.memberCount === 2 && <p className="mt-1.5 text-[11.5px] text-muted-foreground">{t("dyadNote")}</p>}

      <div className="mt-5 space-y-2.5">
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-3">
            <span className="grid h-[34px] w-[34px] shrink-0 place-items-center overflow-hidden rounded-full bg-primary-soft text-[11.5px] font-bold text-primary">
              {m.avatar_url ? <img src={m.avatar_url} alt={m.full_name} className="h-full w-full object-cover" /> : initials(m.full_name)}
            </span>
            <span className="text-[13.5px]">{m.isSelf ? t("you") : m.full_name}</span>
            {responseBySlot.get(m.slot) === "accepted" && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
          </div>
        ))}
      </div>

      {dueOn && (
        <p className="mt-5 border-t border-border pt-4 text-[11.5px] text-muted-foreground">
          {[trainingWeek?.title, `${t("deadlineLabel")} ${formatProfileDate(dueOn)}`].filter(Boolean).join(" · ")}
        </p>
      )}
    </section>
  );
}
