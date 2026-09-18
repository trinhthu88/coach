import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { CheckCircle2, Users } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import type { TriadRoundEntry } from "@/hooks/triads/useMyTriads";

function initials(name: string) {
  return (name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

const RESPONSE_BY_SLOT = ["member_1_response", "member_2_response", "member_3_response"] as const;
const ID_BY_SLOT = ["member_1_id", "member_2_id", "member_3_id"] as const;

/** "My Triad group" card — white, per the approved prototype's Triads workspace (paired with the navy "Next Triad session" card, TriadSessionCard, for contrast). */
export function TriadGroupHero({ entry }: { entry: TriadRoundEntry }) {
  const { t } = useTranslation("triads");
  const { user } = useAuth();
  const { round, group, members, session } = entry;

  const responseFor = (memberId: string): "pending" | "accepted" | "declined" => {
    if (!session) return "pending";
    for (let i = 0; i < 3; i++) {
      if (group[ID_BY_SLOT[i]] === memberId) return session[RESPONSE_BY_SLOT[i]] ?? "pending";
    }
    return "pending";
  };

  return (
    <section className="rounded-[18px] border border-border bg-card p-6 shadow-sm sm:p-7">
      <p className="inline-flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[.22em] text-primary">
        <Users className="h-3.5 w-3.5" /> {t("myGroup.label")}
      </p>
      <h3 className="font-display mt-3 text-[1.6rem] font-light leading-[1.15] tracking-[-0.025em] sm:text-[1.85rem]">
        {t("roundLabel", { n: round.round_number })}
      </h3>
      {!group.member_3_id && <p className="mt-1.5 text-[11.5px] text-muted-foreground">{t("dyadNote")}</p>}

      <div className="mt-5 space-y-2.5">
        {members.map((m) => {
          const r = responseFor(m.id);
          return (
            <div key={m.id} className="flex items-center gap-3">
              <span className="grid h-[34px] w-[34px] shrink-0 place-items-center overflow-hidden rounded-full bg-primary-soft text-[11.5px] font-bold text-primary">
                {m.avatar_url ? (
                  <img src={m.avatar_url} alt={m.full_name} className="h-full w-full object-cover" />
                ) : (
                  initials(m.full_name)
                )}
              </span>
              <span className="text-[13.5px]">{m.id === user?.id ? t("you") : m.full_name}</span>
              {r === "accepted" && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
            </div>
          );
        })}
      </div>

      <p className="mt-5 border-t border-border pt-4 text-[11.5px] text-muted-foreground">
        {(round.training_weeks?.title ?? round.title) + " · " + t("deadlineLabel") + " " + format(new Date(`${round.completion_deadline}T00:00:00`), "MMM d, yyyy")}
      </p>
    </section>
  );
}
