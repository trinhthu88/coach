import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export function SponsorFlagDialog({ subject, className = "" }: { subject: string; className?: string }) {
  const { t } = useTranslation("sponsor");
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!message.trim()) return;
    setSending(true);
    const { error } = await supabase.from("admin_alerts").insert({
      alert_type: "sponsor_request",
      severity: "info",
      title: `Sponsor flag: ${subject}`,
      message: message.trim(),
    });
    setSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("dashboard.contactTeam.sent"));
    setMessage("");
    setOpen(false);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {t("leaderDrawer.reference.flagTeam")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-[#e6e0d6] bg-[#fffdf9]">
          <DialogHeader>
            <DialogTitle className="font-serif text-[21px] font-normal">Flag to the Clariva team</DialogTitle>
            <DialogDescription>
              The Clariva team follows up with the leader and their coach. You will not be contacting the leader directly.
            </DialogDescription>
          </DialogHeader>
          <Textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="What have you noticed?" rows={4} className="resize-y bg-white" />
          <DialogFooter>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full border border-[#cfc7bb] bg-transparent px-[18px] py-2.5 text-xs font-semibold text-[#062f3e]">{t("dashboard.contactTeam.cancel")}</button>
            <button type="button" onClick={send} disabled={sending || !message.trim()} className="rounded-full bg-[#062f3e] px-5 py-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{sending ? "Sending…" : "Send flag"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}