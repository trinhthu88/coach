import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { format, startOfWeek } from "date-fns";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

interface Row {
  weekday: number; // 0..6 (Sun..Sat)
  start: string;
  end: string;
}

const WEEKDAYS = [
  { v: 1, label: "Mon" },
  { v: 2, label: "Tue" },
  { v: 3, label: "Wed" },
  { v: 4, label: "Thu" },
  { v: 5, label: "Fri" },
  { v: 6, label: "Sat" },
  { v: 0, label: "Sun" },
];

export default function BulkAvailabilityDialog({ open, onOpenChange, onCreated }: Props) {
  const { user } = useAuth();
  const [weeks, setWeeks] = useState(4);
  const [startDate, setStartDate] = useState(
    format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd")
  );
  const [rows, setRows] = useState<Row[]>([
    { weekday: 1, start: "09:00", end: "12:00" },
    { weekday: 3, start: "14:00", end: "17:00" },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const updateRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));
  const addRow = () => setRows((prev) => [...prev, { weekday: 1, start: "09:00", end: "10:00" }]);

  const submit = async () => {
    if (!user) return;
    if (!rows.length) return toast.error("Add at least one slot template.");
    for (const r of rows) {
      if (r.start >= r.end) return toast.error("Each slot end must be after start.");
    }
    setSubmitting(true);
    const { data, error } = await supabase.rpc("bulk_create_availability", {
      _coach_id: user.id,
      _start_date: startDate,
      _weeks: weeks,
      _template: rows.map((r) => ({ weekday: r.weekday, start: r.start, end: r.end })),
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    toast.success(`Created ${data} slots across ${weeks} week${weeks > 1 ? "s" : ""}`);
    onOpenChange(false);
    onCreated?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Set weekly template</DialogTitle>
          <DialogDescription>
            Define your typical week and apply it for several weeks at once. You can still add,
            edit, or remove individual slots afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Starting from week of</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label>Apply for (weeks)</Label>
            <Input
              type="number"
              min={1}
              max={12}
              value={weeks}
              onChange={(e) => setWeeks(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
              className="mt-1.5"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Recurring slots</Label>
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add slot
            </Button>
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5">
                <div className="flex flex-1 flex-wrap gap-1">
                  {WEEKDAYS.map((w) => (
                    <button
                      key={w.v}
                      type="button"
                      onClick={() => updateRow(i, { weekday: w.v })}
                      className={cn(
                        "rounded-md border px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest transition-colors",
                        r.weekday === w.v
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card hover:border-primary/40"
                      )}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
                <Input
                  type="time"
                  value={r.start}
                  onChange={(e) => updateRow(i, { start: e.target.value })}
                  className="w-28"
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="time"
                  value={r.end}
                  onChange={(e) => updateRow(i, { end: e.target.value })}
                  className="w-28"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeRow(i)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Apply template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
