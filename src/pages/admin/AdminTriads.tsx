import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { AdminPageHeader } from "./_shared";
import { AdminTriadRoundCard } from "./AdminTriadRoundCard";
import { useAdminTriadRounds, useAdminTriadMutations, type CreateTriadRoundInput } from "@/hooks/triads/useAdminTriads";

const NO_WEEK = "__none__";

interface ProgrammeOption {
  id: string;
  name: string;
}

interface TrainingWeekOption {
  id: string;
  week_number: number;
  title: string;
}

export default function AdminTriads() {
  const { t } = useTranslation("admin");
  const { createRound, isPending } = useAdminTriadMutations();

  const [programmes, setProgrammes] = useState<ProgrammeOption[]>([]);
  const [programmeId, setProgrammeId] = useState("");
  const [weeks, setWeeks] = useState<TrainingWeekOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [titleVi, setTitleVi] = useState("");
  const [weekId, setWeekId] = useState(NO_WEEK);
  const [deadline, setDeadline] = useState("");
  const [autoAssignDate, setAutoAssignDate] = useState("");
  const [isVisible, setIsVisible] = useState(false);

  const { rounds, loading: roundsLoading } = useAdminTriadRounds(programmeId || undefined);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("programmes").select("id, name").order("name");
      setProgrammes((data || []) as ProgrammeOption[]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!programmeId) {
      setWeeks([]);
      return;
    }
    supabase
      .from("training_weeks")
      .select("id, week_number, title")
      .eq("programme_id", programmeId)
      .order("week_number")
      .then(({ data }) => setWeeks((data || []) as TrainingWeekOption[]));
  }, [programmeId]);

  const nextRoundNumber = useMemo(() => (rounds.length > 0 ? Math.max(...rounds.map((r) => r.round_number)) + 1 : 1), [rounds]);

  const openCreate = () => {
    setTitle("");
    setTitleVi("");
    setWeekId(NO_WEEK);
    setDeadline("");
    setAutoAssignDate("");
    setIsVisible(false);
    setCreateOpen(true);
  };

  const canSave = title.trim() && deadline && autoAssignDate;

  const handleSave = async () => {
    if (!canSave) return;
    const input: CreateTriadRoundInput = {
      programme_id: programmeId,
      round_number: nextRoundNumber,
      title: title.trim(),
      title_vi: titleVi.trim() || null,
      training_week_id: weekId === NO_WEEK ? null : weekId,
      completion_deadline: deadline,
      auto_assign_date: autoAssignDate,
      is_visible: isVisible,
    };
    try {
      await createRound(input);
      toast.success(t("triads.saved"));
      setCreateOpen(false);
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, t, { fallback: t("triads.saveFailed") }));
    }
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div>
      <AdminPageHeader eyebrow={t("triads.eyebrow")} title={t("triads.title")} subtitle={t("triads.subtitle")} />

      <div className="mb-6 max-w-xs">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("triads.programmeLabel")}</p>
        <Select value={programmeId} onValueChange={setProgrammeId}>
          <SelectTrigger>
            <SelectValue placeholder={t("triads.selectProgrammePrompt")} />
          </SelectTrigger>
          <SelectContent>
            {programmes.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!programmeId ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">{t("triads.selectProgrammePrompt")}</Card>
      ) : (
        <>
          <div className="mb-4 flex justify-end">
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> {t("triads.addRound")}
            </Button>
          </div>

          {roundsLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : rounds.length === 0 ? (
            <Card className="p-12 text-center text-sm text-muted-foreground">{t("triads.noRounds")}</Card>
          ) : (
            <div className="space-y-4">
              {rounds.map((round) => (
                <AdminTriadRoundCard key={round.id} round={round} />
              ))}
            </div>
          )}
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("triads.roundDialogTitleNew")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("triads.fields.title")}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label>{t("triads.fields.titleVi")}</Label>
              <Input value={titleVi} onChange={(e) => setTitleVi(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label>{t("triads.fields.trainingWeek")}</Label>
              <Select value={weekId} onValueChange={setWeekId}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_WEEK}>{t("triads.fields.trainingWeekNone")}</SelectItem>
                  {weeks.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {t("training:list.weekN", { n: w.week_number })} — {w.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("triads.fields.completionDeadline")}</Label>
                <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label>{t("triads.fields.autoAssignDate")}</Label>
                <Input type="date" value={autoAssignDate} onChange={(e) => setAutoAssignDate(e.target.value)} className="mt-1.5" />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2.5">
              <Label htmlFor="triad-round-visible">{t("triads.fields.isVisible")}</Label>
              <Switch id="triad-round-visible" checked={isVisible} onCheckedChange={setIsVisible} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("triads.cancel")}</Button>
            <Button onClick={handleSave} disabled={!canSave || isPending}>
              {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t("triads.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
