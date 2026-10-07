import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The mentee's Cancel for a Mentoring session (decision 7, the Coaching rules
 * in transition_mentoring_session_status): free until 24 hours before; inside
 * 24 hours with a reason, and the unit is still freed for rebooking; never
 * once the session has started (a no-show is the Mentor's to mark held, so the
 * button is not offered). The server decides; this only asks for the reason
 * it will ask for.
 */
export function MentoringCancelButton({
  startTime,
  onCancel,
  now = () => Date.now(),
  className,
}: {
  startTime: string;
  onCancel: (reason: string | undefined) => Promise<{ error: unknown }>;
  now?: () => number;
  className?: string;
}) {
  const { t } = useTranslation("mentoring");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const msToStart = new Date(startTime).getTime() - now();
  if (msToStart <= 0) return null;
  const late = msToStart < DAY_MS;
  const canConfirm = !busy && (!late || reason.trim().length > 0);

  const confirm = async () => {
    setBusy(true);
    const { error } = await onCancel(reason.trim() || undefined);
    setBusy(false);
    if (!error) {
      setOpen(false);
      setReason("");
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className={className}>
        <XCircle className="mr-1 h-4 w-4" /> {t("sessionDetail.cancel.button")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("sessionDetail.cancel.title")}</DialogTitle>
            <DialogDescription>
              {late ? t("sessionDetail.cancel.lateDescription") : t("sessionDetail.cancel.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <label htmlFor="mentoring-cancel-reason" className="text-[12px] font-medium">
              {late ? t("sessionDetail.cancel.reasonRequired") : t("sessionDetail.cancel.reasonOptional")}
            </label>
            <Textarea id="mentoring-cancel-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t("sessionDetail.cancel.keep")}
            </Button>
            <Button variant="destructive" onClick={confirm} disabled={!canConfirm}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t("sessionDetail.cancel.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
