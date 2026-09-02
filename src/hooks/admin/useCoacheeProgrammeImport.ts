import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ProgrammeOpt } from "./useAdminCoacheesData";
import type { Row } from "@/pages/admin/coachees/coacheeDisplay";
import { upsertCoacheeEnrollment } from "@/lib/enrollmentTransition";

/**
 * Imports a Name/Email/Programme spreadsheet against the coachees list:
 * existing accounts (matched by email) get enrolled into the named
 * programme directly; unrecognized emails are staged so the programme is
 * auto-applied once they sign up through the normal access-request flow.
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

      let enrolledExisting = 0;
      let stagedNew = 0;
      let skipped = 0;
      const stagedPayload: { email: string; full_name: string; programme_id: string }[] = [];
      const enrollPayload: { user_id: string; programme_id: string }[] = [];

      for (const r of data) {
        const email = String(r.Email || r.email || "").trim().toLowerCase();
        const name = String(r.Name || r.name || "").trim() || email.split("@")[0];
        const progName = String(r.Programme || r.programme || "").trim().toLowerCase();
        if (!email || !progName) {
          skipped++;
          continue;
        }
        const prog = progByName.get(progName);
        if (!prog) {
          skipped++;
          continue;
        }

        if (existingEmails.has(email)) {
          // enroll existing coachee
          const existing = rows.find((x) => x.email.toLowerCase() === email);
          if (existing) {
            if (existing.enrollment_id) {
              // Transition rather than update-in-place — a bare update would
              // silently lose history if this person's programme is actually
              // changing (and would violate ux_programme_enrollments_one_active
              // if it tried to insert a second active row instead).
              await upsertCoacheeEnrollment(
                existing.id,
                { id: existing.enrollment_id, programme_id: existing.programme_id ?? null },
                { programme_id: prog.id }
              );
            } else {
              enrollPayload.push({ user_id: existing.id, programme_id: prog.id });
            }
            enrolledExisting++;
          }
        } else {
          stagedPayload.push({ email, full_name: name, programme_id: prog.id });
          stagedNew++;
        }
      }
      if (enrollPayload.length) await supabase.from("programme_enrollments").insert(enrollPayload);
      if (stagedPayload.length) await supabase.from("staged_enrollments").upsert(stagedPayload, { onConflict: "email" });

      toast.success(`Import done: ${enrolledExisting} enrolled, ${stagedNew} staged for signup, ${skipped} skipped`);
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
