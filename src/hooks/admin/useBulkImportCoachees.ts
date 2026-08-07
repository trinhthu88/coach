import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { toast } from "@/hooks/use-toast";

interface ImportRow {
  Email?: string;
  email?: string;
  EMAIL?: string;
  Name?: string;
  name?: string;
  "Full name"?: string;
  "Session limit"?: string | number;
  SessionLimit?: string | number;
  session_limit?: string | number;
  Limit?: string | number;
}

/**
 * Bulk-invites coachees via Supabase OTP sign-in from a parsed spreadsheet,
 * optionally saving a per-coachee monthly session limit.
 */
export function useBulkImportCoachees(onDone: () => void) {
  const [importing, setImporting] = useState(false);

  const importRows = async (rows: ImportRow[]) => {
    if (!rows.length) {
      toast({ title: "Empty file", variant: "destructive" });
      return;
    }
    setImporting(true);
    try {
      const redirectTo = `${window.location.origin}/auth`;
      let ok = 0;
      let fail = 0;
      for (const row of rows) {
        const email = (row.Email || row.email || row.EMAIL || "").toString().trim().toLowerCase();
        const name = (row.Name || row.name || row["Full name"] || "").toString().trim();
        const limitRaw =
          row["Session limit"] ?? row.SessionLimit ?? row.session_limit ?? row.Limit ?? "";
        const limitNum = Number(limitRaw);
        const sessionLimit = Number.isFinite(limitNum) && limitNum > 0 ? Math.floor(limitNum) : null;
        if (!email) {
          fail++;
          continue;
        }
        const { data: otpData, error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            data: { full_name: name || email.split("@")[0], role: "coachee" },
            emailRedirectTo: redirectTo,
          },
        });
        if (error) {
          fail++;
          continue;
        }
        ok++;
        // If we have a user id back and a custom limit, save it
        const user = otpData?.user as User | null | undefined;
        const newUserId: string | null = user ? user.id : null;
        if (newUserId && sessionLimit !== null) {
          await supabase
            .from("session_limits")
            .upsert(
              { coachee_id: newUserId, monthly_limit: sessionLimit },
              { onConflict: "coachee_id" }
            );
        }
      }
      toast({
        title: "Import finished",
        description: `${ok} invited, ${fail} failed. Coachees confirm via email link.`,
      });
      setTimeout(onDone, 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Import failed", description: message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  return { importing, importRows };
}
