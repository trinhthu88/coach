import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { InviteFormValues } from "@/hooks/coach/useCoachInviteSlots";

const CONTACT_EMAIL = "contact@clariva.club";

export function InviteClientDialog({
  open,
  onOpenChange,
  invite,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invite: (values: InviteFormValues) => Promise<
    | { ok: true }
    | { ok: false; error: "invite_limit_reached"; limit: number; current: number }
    | { ok: false; error: "email_already_registered" }
    | { ok: false; error: "other"; message: string }
  >;
  onInvited: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [sessionLimit, setSessionLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [atCap, setAtCap] = useState(false);

  const reset = () => {
    setFullName("");
    setEmail("");
    setSessionLimit("");
    setInlineError(null);
    setAtCap(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async () => {
    if (!fullName.trim() || !email.trim()) {
      toast.error("Full name and email are required");
      return;
    }
    setInlineError(null);
    setAtCap(false);
    setBusy(true);
    try {
      const limitNum = sessionLimit.trim() ? Number(sessionLimit) : undefined;
      const result = await invite({
        full_name: fullName,
        email,
        session_limit: limitNum && Number.isFinite(limitNum) && limitNum > 0 ? limitNum : undefined,
      });

      if (result.ok) {
        toast.success("Invited — pending admin approval");
        reset();
        onOpenChange(false);
        onInvited();
        return;
      }

      if (result.error === "invite_limit_reached") {
        setInlineError(`You've reached your limit of ${result.limit} clients invited.`);
        setAtCap(true);
        onInvited(); // refresh slot usage so the page's cap UI reflects reality
        return;
      }
      if (result.error === "email_already_registered") {
        setInlineError("That email is already registered on Clariva.");
        return;
      }
      toast.error(result.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a client</DialogTitle>
          <DialogDescription>
            They'll get an email to set up their account. Their access is pending admin approval.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Full name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe" />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@company.com" />
          </div>
          <div>
            <Label>Monthly session limit (optional)</Label>
            <Input
              type="number"
              min={1}
              value={sessionLimit}
              onChange={(e) => setSessionLimit(e.target.value)}
              placeholder="Uses the platform default if left blank"
            />
          </div>

          {inlineError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{inlineError}</span>
            </div>
          )}
          {atCap && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Reach out to{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold underline">
                  {CONTACT_EMAIL}
                </a>{" "}
                if you'd like to invite more clients.
              </span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Send invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
