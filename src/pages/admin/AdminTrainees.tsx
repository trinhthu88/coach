import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, Loader2, Layers, MessagesSquare } from "lucide-react";
import { format } from "date-fns";
import { AdminPageHeader, Kpi, Pill, Avatar } from "./_shared";

interface Row {
  id: string;
  name: string;
  email: string;
  given: number;
  received: number;
  rating: number;
  optedAt: string | null;
}

export default function AdminTrainees() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: cps }, { data: peer }, { data: profiles }] = await Promise.all([
        supabase.from("coach_profiles").select("id, peer_coaching_opt_in, rating_avg, last_profile_update_at").eq("peer_coaching_opt_in", true),
        supabase.from("peer_sessions").select("peer_coach_id, peer_coachee_id, status, coachee_rating"),
        supabase.from("profiles").select("id, full_name, email"),
      ]);
      const profById = new Map((profiles || []).map((p: any) => [p.id, p]));
      const given = new Map<string, number>();
      const received = new Map<string, number>();
      (peer || []).forEach((p: any) => {
        if (p.status === "completed") {
          given.set(p.peer_coach_id, (given.get(p.peer_coach_id) || 0) + 1);
          received.set(p.peer_coachee_id, (received.get(p.peer_coachee_id) || 0) + 1);
        }
      });
      const list: Row[] = (cps || []).map((c: any) => {
        const p: any = profById.get(c.id) || {};
        return {
          id: c.id,
          name: p.full_name || "—",
          email: p.email || "—",
          given: given.get(c.id) || 0,
          received: received.get(c.id) || 0,
          rating: Number(c.rating_avg || 5),
          optedAt: c.last_profile_update_at,
        };
      });
      setRows(list.sort((a, b) => b.given + b.received - (a.given + a.received)));
      setLoading(false);
    })();
  }, []);

  const filtered = rows.filter(
    (r) => !q.trim() || r.name.toLowerCase().includes(q.toLowerCase()) || r.email.toLowerCase().includes(q.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const totalGiven = rows.reduce((a, r) => a + r.given, 0);
  const totalReceived = rows.reduce((a, r) => a + r.received, 0);

  return (
    <div>
      <AdminPageHeader
        title="Coach"
        emphasize="trainees"
        subtitle="Coaches who opted into peer coaching — they practice by giving and receiving sessions."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Kpi label="Trainees (peer opt-in)" value={rows.length} icon={Layers} tone="accent" />
        <Kpi label="Peer sessions given" value={totalGiven} icon={MessagesSquare} tone="primary" />
        <Kpi label="Peer sessions received" value={totalReceived} icon={MessagesSquare} tone="success" />
      </div>

      <div className="mb-3 relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search trainees" className="pl-9" />
      </div>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <p className="p-12 text-center text-sm text-muted-foreground">No trainees opted into peer coaching yet.</p>
        ) : (
          <div className="divide-y">
            {filtered.map((r) => (
              <div key={r.id} className="grid grid-cols-12 items-center gap-3 px-4 py-3 hover:bg-muted/30">
                <div className="col-span-4 flex items-center gap-2 min-w-0">
                  <Avatar name={r.name} tone="accent" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{r.email}</p>
                  </div>
                </div>
                <div className="col-span-2 text-[11px]">
                  <p className="font-semibold text-foreground">{r.given}</p>
                  <p className="text-muted-foreground">given</p>
                </div>
                <div className="col-span-2 text-[11px]">
                  <p className="font-semibold text-foreground">{r.received}</p>
                  <p className="text-muted-foreground">received</p>
                </div>
                <div className="col-span-2 text-[11px]">
                  <p className="font-semibold text-foreground">★ {r.rating.toFixed(1)}</p>
                  <p className="text-muted-foreground">avg rating</p>
                </div>
                <div className="col-span-2 text-right">
                  <Pill tone={r.given >= 5 ? "success" : r.given >= 1 ? "primary" : "muted"}>
                    {r.given >= 5 ? "Active trainee" : r.given >= 1 ? "Practicing" : "Just started"}
                  </Pill>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
