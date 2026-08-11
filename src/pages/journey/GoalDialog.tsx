import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";

export type AddGoalFn = (payload: {
  title: string;
  description: string | null;
  target_date: string | null;
}) => Promise<boolean | undefined> | void;

export function GoalDialog({ onAdd }: { onAdd: AddGoalFn }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const ok = await onAdd({
      title: title.trim(),
      description: desc.trim() || null,
      target_date: date || null,
    });
    setSaving(false);
    if (ok === false) return;
    setTitle(""); setDesc(""); setDate("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" /> New goal</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New goal</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Goal title (e.g. Become a confident public speaker)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea placeholder="Why does this matter to you? (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} />
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Target date (optional)</p>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !title.trim()}>Save goal</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
