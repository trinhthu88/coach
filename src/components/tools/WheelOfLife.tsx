import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Loader2, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";
import type { TFunction } from "i18next";
import { WheelRadar, domainsToSeries, WheelDomain } from "./WheelRadar";

const MIN_DOMAINS = 3;
const MAX_DOMAINS = 10;

const DEFAULT_LABEL_KEYS = [
  "career",
  "finances",
  "health",
  "relationships",
  "personalGrowth",
  "funRecreation",
  "physicalEnvironment",
  "family",
] as const;

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `d${Math.random().toString(36).slice(2, 10)}`;

const defaultDomains = (t: TFunction<"tools">): WheelDomain[] =>
  DEFAULT_LABEL_KEYS.map((key) => ({
    id: newId(),
    label: t(`wheelOfLife.defaultLabels.${key}`),
    rating: 5,
  }));

export function WheelOfLife({
  sessionId,
  peerSessionId,
}: {
  sessionId?: string;
  peerSessionId?: string;
}) {
  const { t } = useTranslation("tools");
  const { user } = useAuth();
  const [domains, setDomains] = useState<WheelDomain[]>(() => defaultDomains(t));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rowId, setRowId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!user) return;
      setLoading(true);
      let query = supabase
        .from("tool_sessions")
        .select("id, responses")
        .eq("tool_type", "wheel_of_life")
        .eq("filled_by", user.id);
      query = sessionId
        ? query.eq("session_id", sessionId)
        : query.eq("peer_session_id", peerSessionId!);
      const { data } = await query.maybeSingle();
      if (cancelled) return;
      if (data) {
        setRowId(data.id);
        const saved = (data.responses as { domains?: WheelDomain[] } | null)?.domains;
        if (Array.isArray(saved) && saved.length) {
          setDomains(
            saved.map((d) => ({
              id: d.id || newId(),
              label: d.label ?? "",
              rating: Number(d.rating) || 0,
            }))
          );
        }
      }
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, peerSessionId, user]);

  const update = (id: string, patch: Partial<WheelDomain>) =>
    setDomains((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const remove = (id: string) =>
    setDomains((prev) =>
      prev.length <= MIN_DOMAINS ? prev : prev.filter((d) => d.id !== id)
    );

  const add = () =>
    setDomains((prev) =>
      prev.length >= MAX_DOMAINS
        ? prev
        : [...prev, { id: newId(), label: t("wheelOfLife.newDomainLabel"), rating: 5 }]
    );

  const save = async () => {
    if (!user) return;
    if (domains.some((d) => !d.label.trim())) {
      toast.error(t("wheelOfLife.toast.labelRequired"));
      return;
    }
    setSaving(true);
    const parentFields = sessionId ? { session_id: sessionId } : { peer_session_id: peerSessionId };
    const payload: Database["public"]["Tables"]["tool_sessions"]["Insert"] = {
      ...parentFields,
      tool_type: "wheel_of_life",
      filled_by: user.id,
      responses: { domains } as unknown as Json,
    };
    const { data, error } = rowId
      ? await supabase
          .from("tool_sessions")
          .update({ responses: payload.responses })
          .eq("id", rowId)
          .select("id")
          .maybeSingle()
      : await supabase.from("tool_sessions").insert(payload).select("id").maybeSingle();
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data?.id) setRowId(data.id);
    toast.success(t("wheelOfLife.toast.saved"));
  };

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  const avg = domains.length
    ? domains.reduce((a, d) => a + d.rating, 0) / domains.length
    : 0;
  const lowest = domains.length
    ? domains.reduce((a, d) => (d.rating < a.rating ? d : a))
    : null;

  return (
    <div className="space-y-5">
      {/* Chart panel */}
      <div className="rounded-[20px] border border-border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow text-primary">{t("wheelOfLife.snapshotEyebrow")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("wheelOfLife.snapshotHint")}
            </p>
          </div>
          <div className="flex gap-6">
            <div className="text-right">
              <p className="text-micro font-bold uppercase tracking-[0.16em] text-muted-foreground">
                {t("wheelOfLife.average")}
              </p>
              <p className="font-display text-3xl font-light leading-none text-foreground">
                {avg.toFixed(1)}
              </p>
            </div>
            {lowest && (
              <div className="text-right">
                <p className="text-micro font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  {t("wheelOfLife.lowest")}
                </p>
                <p className="max-w-[9rem] truncate text-sm font-semibold text-accent">
                  {lowest.label} · {lowest.rating}
                </p>
              </div>
            )}
          </div>
        </div>

        {domains.length >= MIN_DOMAINS ? (
          <WheelRadar
            axes={domains.map((d) => d.label)}
            series={[domainsToSeries(domains, "now", t("wheelOfLife.currentSeriesName"), true)]}
            height={380}
          />
        ) : (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {t("wheelOfLife.needMoreDomains", { count: MIN_DOMAINS })}
          </p>
        )}
      </div>

      {/* Domain editor */}
      <div className="rounded-[20px] border border-border bg-card p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <p className="eyebrow text-primary">{t("wheelOfLife.domainsEyebrow")}</p>
          <span className="text-micro font-bold uppercase tracking-[0.16em] text-muted-foreground">
            {t("wheelOfLife.domainCount", { count: domains.length, max: MAX_DOMAINS })}
          </span>
        </div>

        <ul className="grid gap-3 sm:grid-cols-2">
          {domains.map((d) => (
            <li
              key={d.id}
              className="group rounded-[16px] bg-muted/40 px-4 py-3 transition-colors hover:bg-muted/70"
            >
              <div className="flex items-center gap-2">
                <Input
                  value={d.label}
                  onChange={(e) => update(d.id, { label: e.target.value })}
                  className="h-7 flex-1 border-0 bg-transparent px-0 text-sm font-semibold shadow-none focus-visible:ring-0"
                  placeholder={t("wheelOfLife.domainNamePlaceholder")}
                />
                <span className="grid h-7 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold tabular-nums text-primary">
                  {d.rating}
                </span>
                <button
                  type="button"
                  onClick={() => remove(d.id)}
                  disabled={domains.length <= MIN_DOMAINS}
                  className="text-muted-foreground opacity-60 transition-opacity hover:text-destructive disabled:opacity-0 sm:opacity-0 sm:hover:opacity-100 sm:group-hover:opacity-100 sm:disabled:opacity-0"
                  aria-label={t("wheelOfLife.removeAria", { label: d.label })}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <Slider
                className="mt-2.5"
                value={[d.rating]}
                min={0}
                max={10}
                step={1}
                onValueChange={([v]) => update(d.id, { rating: v })}
                aria-label={t("wheelOfLife.ratingAria", { label: d.label })}
              />
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={add}
            disabled={domains.length >= MAX_DOMAINS}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> {t("wheelOfLife.addDomain")}
          </Button>
          <Button
            type="button"
            size="sm"
            className="rounded-full"
            onClick={save}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1 h-3.5 w-3.5" />
            )}
            {t("wheelOfLife.saveWheel")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default WheelOfLife;
