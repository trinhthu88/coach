import { useRef } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, FileUp, Download } from "lucide-react";
import { useCoacheeProgrammeImport } from "@/hooks/admin/useCoacheeProgrammeImport";
import type { ProgrammeOpt } from "@/hooks/admin/useAdminCoacheesData";
import type { Row } from "./coacheeDisplay";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  programmes: ProgrammeOpt[];
  rows: Row[];
  onImported: () => void;
}

export function ImportDialog({ open, onOpenChange, programmes, rows, onImported }: ImportDialogProps) {
  const { importing, downloadTemplate, importFile } = useCoacheeProgrammeImport(programmes, rows, () => {
    onOpenChange(false);
    onImported();
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ok = await importFile(file);
    if (ok && fileRef.current) fileRef.current.value = "";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import coachees from Excel</DialogTitle>
          <DialogDescription>
            Required columns: <strong>Name, Email, Programme</strong>. Existing accounts will be enrolled.
            New emails will be staged — when they sign up, the programme is auto-applied.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Button variant="outline" size="sm" onClick={downloadTemplate}><Download className="h-4 w-4" /> Download template</Button>
          <div className="rounded-lg border-2 border-dashed border-border p-8 text-center">
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFileChange} className="hidden" id="import-file" />
            <label htmlFor="import-file" className="cursor-pointer">
              {importing ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /> : <FileUp className="mx-auto h-6 w-6 text-muted-foreground" />}
              <p className="mt-2 text-sm font-medium">{importing ? "Importing…" : "Click to upload .xlsx / .csv"}</p>
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
