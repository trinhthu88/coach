import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Star, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/ui/page-header";
import { useOptedInPeerCoaches } from "@/hooks/coaches/useAllowedCoaches";

export default function CoachPeerCoaching() {
  const { t } = useTranslation("profile");
  const { coaches, loading, error, reload: load } = useOptedInPeerCoaches();

  return (
    <div className="space-y-6">
      <PageHeader
            className="mb-0"
            eyebrow={t("peerCoaching.header.eyebrow")}
            title={t("peerCoaching.header.titleLead")}
            emphasis={t("peerCoaching.header.titleEmphasis")}
            subtitle={t("peerCoaching.header.subtitle")}
          />

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : error ? (
        <Card className="flex flex-col items-center gap-3 border-destructive/30 bg-destructive/5 p-12 text-center text-sm">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <p className="text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" onClick={load}>
            {t("peerCoaching.retry")}
          </Button>
        </Card>
      ) : coaches.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          {t("peerCoaching.empty")}
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {coaches.map((c) => (
            <Card key={c.id} className="p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-sm font-bold text-success">
                  {(c.full_name || "?")
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{c.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.title || t("peerCoaching.defaultTitle")}</p>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-semibold">
                  <Star className="h-3 w-3 fill-warning text-warning" />
                  {Number(c.rating_avg).toFixed(1)}
                </span>
              </div>
              <div className="mt-4 flex gap-2">
                <Button asChild variant="outline" size="sm" className="flex-1">
                  <Link to={`/coaches/${c.id}`}>{t("peerCoaching.view")}</Link>
                </Button>
                <Button asChild size="sm" className="flex-1">
                  <Link to={`/coaches/${c.id}/book?mode=peer`}>{t("peerCoaching.bookPeer")}</Link>
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
