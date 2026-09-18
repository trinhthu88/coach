import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { AdminPageHeader, Pill } from "./_shared";

/**
 * Triads are managed per cohort: pick a cohort, then assign groups for each
 * of its Triad requirement units. There is no programme-level round list.
 */
export default function AdminTriads() {
  const { t } = useTranslation("admin");
  const { data: cohorts = [], isLoading } = useQuery({
    queryKey: ["admin-triad-cohorts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cohorts")
        .select("id, name, start_date, end_date, programmes(name)")
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div>
      <AdminPageHeader eyebrow={t("triads.eyebrow")} title={t("triads.title")} subtitle={t("triads.subtitle")} />
      {cohorts.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">{t("cohorts.empty")}</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cohorts.map((c) => (
            <Link key={c.id} to={`/admin/cohorts/${c.id}/triads`} data-testid="admin-triad-cohort">
              <Card className="h-full p-4 transition-colors hover:border-primary">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 truncate text-base font-semibold">{c.name}</h3>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
                {(c.programmes as { name: string } | null)?.name && (
                  <Pill tone="primary" className="mt-2">{(c.programmes as { name: string }).name}</Pill>
                )}
                {c.start_date && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {format(new Date(c.start_date), "MMM yyyy")}
                    {c.end_date ? ` → ${format(new Date(c.end_date), "MMM yyyy")}` : ""}
                  </p>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
