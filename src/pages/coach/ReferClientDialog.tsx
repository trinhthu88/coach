import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Info, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NO_PROGRAMME = "none";

/**
 * "Refer a client" (decision 4, 20261006170000): the Coach sends Admin a
 * pending access request through coach_refer_client(). It creates no account
 * and grants no access; Admin approves it and sets up a coaching engagement.
 */
export function ReferClientDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation("dashboard");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [programmeId, setProgrammeId] = useState(NO_PROGRAMME);
  const [note, setNote] = useState("");
  const [programmes, setProgrammes] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase
      .from("programmes")
      .select("id, name")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => setProgrammes(data ?? []));
  }, [open]);

  const reset = () => {
    setFullName("");
    setEmail("");
    setProgrammeId(NO_PROGRAMME);
    setNote("");
  };

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async () => {
    if (!fullName.trim() || !email.trim()) {
      toast.error(t("clients.refer.requiredFields"));
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("coach_refer_client", {
      p_full_name: fullName.trim(),
      p_email: email.trim(),
      p_suggested_programme_id: programmeId === NO_PROGRAMME ? undefined : programmeId,
      p_note: note.trim() || undefined,
    });
    setBusy(false);
    if (error) {
      toast.error(getFriendlyErrorMessage(error, t));
      return;
    }
    toast.success(t("clients.refer.success"));
    close(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("clients.refer.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("clients.refer.dialogDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="refer-name">{t("clients.refer.fullNameLabel")}</Label>
            <Input id="refer-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="refer-email">{t("clients.refer.emailLabel")}</Label>
            <Input id="refer-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label>{t("clients.refer.programmeLabel")}</Label>
            <Select value={programmeId} onValueChange={setProgrammeId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROGRAMME}>{t("clients.refer.programmeNone")}</SelectItem>
                {programmes.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="refer-note">{t("clients.refer.noteLabel")}</Label>
            <Textarea id="refer-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{t("clients.refer.grantsNothing")}</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            {t("clients.refer.cancel")}
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("clients.refer.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
