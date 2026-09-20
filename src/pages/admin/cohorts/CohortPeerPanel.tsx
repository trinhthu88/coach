import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getFriendlyErrorMessage } from "@/lib/errors";
import {
  useAdminPeerCohortPermissions,
  useSetPeerCohortPermission,
} from "@/hooks/peer/useAdminPeerCohortPermissions";

/**
 * Admin -> Cohort -> Peer practice: who this cohort's learners may practise
 * with.
 *
 * Same-cohort peering is always on and is deliberately shown as a statement
 * rather than a control. It needs no permission row, and offering a switch for
 * it would imply the cohort is not the natural unit of peer practice.
 *
 * Everything else is an explicit, DIRECTIONAL grant to another cohort of the
 * same programme. "Allow matching both ways" writes the reverse grant as a
 * second row; it is never inferred, so an Admin can always see, from the
 * inbound marker, exactly which directions exist.
 */
export function CohortPeerPanel({ cohortId }: { cohortId: string | undefined }) {
  const { t } = useTranslation("admin");
  const { data: candidates, isLoading } = useAdminPeerCohortPermissions(cohortId);
  const setPermission = useSetPeerCohortPermission(cohortId);
  const [bothWays, setBothWays] = useState(false);

  if (!cohortId) return null;

  const rows = candidates ?? [];
  const granted = rows.filter((c) => c.allowedOutbound);

  const toggle = (otherCohortId: string, allowed: boolean) => {
    setPermission.mutate(
      { otherCohortId, allowed, bothWays },
      {
        onError: (e) => toast.error(getFriendlyErrorMessage(e, t)),
        onSuccess: () =>
          toast.success(allowed ? t("cohorts.peer.granted") : t("cohorts.peer.withdrawn")),
      }
    );
  };

  return (
    <Card className="space-y-4 p-4 sm:p-5" data-testid="cohort-peer-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-base leading-tight">{t("cohorts.peer.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("cohorts.peer.intro")}</p>
        </div>
        <Badge variant="secondary" data-testid="cohort-peer-granted-count">
          {t("cohorts.peer.grantedCount", { count: granted.length })}
        </Badge>
      </div>

      <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm" data-testid="cohort-peer-same-cohort">
        {t("cohorts.peer.sameCohort")}
      </p>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        // Not "no cohorts": there is no OTHER cohort of this programme, which
        // is a different and more useful thing to say.
        <p className="text-sm text-muted-foreground">{t("cohorts.peer.noSiblings")}</p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={bothWays}
              onCheckedChange={(v) => setBothWays(!!v)}
              aria-label={t("cohorts.peer.bothWays")}
              data-testid="cohort-peer-both-ways"
            />
            <span>{t("cohorts.peer.bothWays")}</span>
          </label>
          <ul className="space-y-1.5">
            {rows.map((c) => (
              <li
                key={c.cohortId}
                data-testid="cohort-peer-row"
                data-granted={c.allowedOutbound ? "true" : "false"}
                data-inbound={c.allowedInbound ? "true" : "false"}
                className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2"
              >
                <Checkbox
                  checked={c.allowedOutbound}
                  disabled={setPermission.isPending}
                  onCheckedChange={(v) => toggle(c.cohortId, !!v)}
                  aria-label={t("cohorts.peer.toggleLabel", { name: c.name })}
                />
                <span className="text-sm font-medium">{c.name}</span>
                {c.allowedInbound && (
                  <span className="text-xs text-muted-foreground">{t("cohorts.peer.inbound")}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

export default CohortPeerPanel;
