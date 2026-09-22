import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { useAdminPeerDyads, useCreatePeerDyad } from "@/hooks/peer/useAdminPeerDyads";

export function FixedPeerDyadPanel({ cohortId, programmeId }: { cohortId: string | undefined; programmeId?: string | null }) {
  const { t } = useTranslation("admin");
  const { data, isLoading, isError } = useAdminPeerDyads(cohortId);
  const create = useCreatePeerDyad(cohortId, programmeId ?? undefined);
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  if (!cohortId) return null;

  const add = () => {
    if (!left || !right || left === right) return;
    create.mutate(
      { leftEnrollmentId: left, rightEnrollmentId: right },
      {
        onSuccess: () => {
          setLeft("");
          setRight("");
          toast.success(t("cohorts.peer.dyadCreated", { defaultValue: "Peer dyad assigned" }));
        },
        onError: (error) => toast.error(getFriendlyErrorMessage(error, t)),
      },
    );
  };

  return (
    <Card className="space-y-4 p-4 sm:p-5" data-testid="fixed-peer-dyad-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-base leading-tight">
            {t("cohorts.peer.dyadsTitle", { defaultValue: "Assigned Peer dyads" })}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("cohorts.peer.dyadsIntro", { defaultValue: "Learners can book only with their Admin-assigned partner." })}
          </p>
        </div>
        <Badge variant="secondary">{data?.dyads.filter((dyad) => dyad.status === "active").length ?? 0}</Badge>
      </div>

      {isError ? (
        <p role="alert" className="text-sm text-destructive">{t("cohorts.peer.loadError")}</p>
      ) : isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <select value={left} onChange={(event) => setLeft(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm" aria-label="First learner">
              <option value="">Choose first learner</option>
              {(data?.enrollments ?? []).map((enrollment) => <option key={enrollment.id} value={enrollment.id}>{enrollment.displayName}</option>)}
            </select>
            <select value={right} onChange={(event) => setRight(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm" aria-label="Second learner">
              <option value="">Choose second learner</option>
              {(data?.enrollments ?? []).map((enrollment) => <option key={enrollment.id} value={enrollment.id}>{enrollment.displayName}</option>)}
            </select>
          </div>
          <Button type="button" size="sm" onClick={add} disabled={!left || !right || left === right || create.isPending}>
            {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            {t("cohorts.peer.assignDyad", { defaultValue: "Assign dyad" })}
          </Button>
          <ul className="space-y-2 text-sm">
            {(data?.dyads ?? []).map((dyad) => (
              <li key={dyad.id} className="rounded-md border border-border bg-muted/20 px-3 py-2" data-testid="peer-dyad-row">
                {dyad.members.length === 2
                  ? `${dyad.members[0].displayName} · ${dyad.members[1].displayName}`
                  : "Incomplete dyad"}
                <span className="ml-2 text-xs text-muted-foreground">{dyad.status}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

export default FixedPeerDyadPanel;
