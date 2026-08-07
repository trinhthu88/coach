import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { format } from "date-fns";
import { WheelRadar, domainsToSeries, WheelDomain, WheelSeries } from "./WheelRadar";

interface WheelFill {
  sessionId: string;
  date: string;
  domains: WheelDomain[];
}

const MIN_MATCH = 3;

/**
 * Read-only history of a coachee's Wheel of Life fills.
 * Overlays the two most recent wheels when enough domain labels match.
 */
export function WheelHistory({ coacheeId }: { coacheeId?: string }) {
  const [fills, setFills] = useState<WheelFill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!coacheeId) return;
      setLoading(true);
      const { data } = await supabase
        .from("tool_sessions")
        .select("session_id, responses, sessions!inner(start_time, coachee_id)")
        .eq("tool_type", "wheel_of_life")
        .eq("filled_by", coacheeId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      const rows = (data ?? [])
        .map((r) => {
          const session = r.sessions as unknown as {
            start_time: string;
            coachee_id: string;
          } | null;
          const domains = (r.responses as { domains?: WheelDomain[] } | null)?.domains;
          if (!session || session.coachee_id !== coacheeId || !Array.isArray(domains)) {
            return null;
          }
          return {
            sessionId: r.session_id,
            date: session.start_time,
            domains: domains.filter((d) => d?.label),
          } as WheelFill;
        })
        .filter((x): x is WheelFill => x !== null)
        .sort((a, b) => +new Date(b.date) - +new Date(a.date));
      setFills(rows);
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [coacheeId]);

  if (loading || fills.length === 0) return null;

  const [latest, previous] = fills;
  let axes = latest.domains.map((d) => d.label);
  let series: WheelSeries[] = [
    domainsToSeries(latest.domains, "latest", `Latest · ${format(new Date(latest.date), "MMM d")}`, true),
  ];
  let note: string | null = null;

  if (previous) {
    const prevLabels = new Set(previous.domains.map((d) => d.label.trim().toLowerCase()));
    const shared = latest.domains.filter((d) => prevLabels.has(d.label.trim().toLowerCase()));
    if (shared.length >= MIN_MATCH) {
      axes = shared.map((d) => d.label);
      series = [
        domainsToSeries(previous.domains, "prev", `Previous · ${format(new Date(previous.date), "MMM d")}`),
        domainsToSeries(latest.domains, "latest", `Latest · ${format(new Date(latest.date), "MMM d")}`, true),
      ];
    } else {
      note = "Domains changed too much between sessions to compare directly — showing your latest wheel only.";
    }
  }

  if (axes.length < MIN_MATCH) return null;

  return (
    <Card className="p-4">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Wheel of Life
      </p>
      <WheelRadar axes={axes} series={series} />
      {note && <p className="mt-2 text-[11px] text-muted-foreground">{note}</p>}
    </Card>
  );
}

export default WheelHistory;
