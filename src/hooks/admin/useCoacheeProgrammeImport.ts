import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ProgrammeOpt } from "./useAdminCoacheesData";
import type { Row } from "@/pages/admin/coachees/coacheeDisplay";

/**
 * The import file intentionally stages new people only. Existing users must
 * be enrolled from the admin editor, where a cohort and organization are
 * supplied to the enrollment RPC and any ongoing-enrollment conflict is
 * reviewable. This prevents imports from inventing enrollment context.
 */
export function useCoacheeProgrammeImport(programmes: ProgrammeOpt[], rows: Row[], onImported: () => void) {
  const [importing, setImporting] = useState(false);

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet([
      { Name: "Jane Doe", Email: "jane@example.com", Programme: programmes[0]?.name || "Foundations" },
      { Name: "John Smith", Email: "john@example.com", Programme: programmes[0]?.name || "Foundations" },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Coachees");
    XLSX.writeFile(wb, "coachees-import-template.xlsx");
  };

  const importFile = async (file: File): Promise<boolean> => {
    setImporting(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data: Record<string, string>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
      const progByName = new Map(programmes.map((p) => [p.name.toLowerCase(), p]));
      const existingEmails = new Set(rows.map((r) => r.email.toLowerCase()));

      let stagedNew = 0;
      let existingRequiresReview = 0;
      let skipped = 0;
      const stagedPayload: { email: string; full_name: string; programme_id: string }[] = [];

      for (const row of data) {
        const email = String(row.Email || row.email || "").trim().toLowerCase();
        const name = String(row.Name || row.name || "").trim() || email.split("@")[0];
        const programmeName = String(row.Programme || row.programme || "").trim().toLowerCase();
        if (!email || !programmeName || !progByName.has(programmeName)) {
          skipped++;
          continue;
        }
        if (existingEmails.has(email)) {
          existingRequiresReview++;
          continue;
        }
        stagedPayload.push({ email, full_name: name, programme_id: progByName.get(programmeName)!.id });
        stagedNew++;
      }

      if (stagedPayload.length) {
        const { error } = await supabase.from("staged_enrollments").upsert(stagedPayload, { onConflict: "email" });
        if (error) throw error;
      }

      toast.success(
        `Import done: ${stagedNew} staged for signup, ${existingRequiresReview} existing users require enrollment review, ${skipped} skipped`
      );
      onImported();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
      return false;
    } finally {
      setImporting(false);
    }
  };

  return { importing, downloadTemplate, importFile };
}
