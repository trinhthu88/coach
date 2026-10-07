import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CalendarDays, ExternalLink, Loader2, RefreshCw, Unlink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface CalendarStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
}

export function CoachGoogleCalendarCard() {
  const { t } = useTranslation("dashboard");
  const [searchParams, setSearchParams] = useSearchParams();
  const callbackResult = searchParams.get("calendar");
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("google-calendar-status");
    if (error || !data) {
      console.error("Could not load Google Calendar connection:", error);
      setStatus(null);
      setLoading(false);
      return;
    }
    setStatus(data as CalendarStatus);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const syncUpcomingSessions = useCallback(async () => {
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("google-calendar-sync-sessions");
    setSyncing(false);
    if (error || !data) {
      console.error("Could not sync Clariva sessions to Google Calendar:", error);
      toast.error(t("availability.googleCalendar.syncFailed"));
      return;
    }
    if (data.failed > 0) {
      toast.warning(t("availability.googleCalendar.syncPartial", {
        synced: data.synced,
        removed: data.removed,
        failed: data.failed,
      }));
    } else {
      toast.success(t("availability.googleCalendar.syncDone", {
        synced: data.synced,
        removed: data.removed,
      }));
    }
  }, [t]);

  useEffect(() => {
    if (!callbackResult) return;
    if (callbackResult === "connected") {
      toast.success(t("availability.googleCalendar.connectedToast"));
      void syncUpcomingSessions();
    } else if (callbackResult === "denied") {
      toast.message(t("availability.googleCalendar.deniedToast"));
    } else {
      toast.error(t("availability.googleCalendar.connectFailed"));
    }
    void refreshStatus();
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("calendar");
      return next;
    }, { replace: true });
  }, [callbackResult, refreshStatus, setSearchParams, syncUpcomingSessions, t]);

  const connect = async () => {
    setConnecting(true);
    const { data, error } = await supabase.functions.invoke("google-calendar-oauth-start");
    setConnecting(false);
    if (error || typeof data?.authorization_url !== "string") {
      console.error("Could not start Google Calendar authorization:", error);
      toast.error(t("availability.googleCalendar.connectFailed"));
      return;
    }
    window.location.assign(data.authorization_url);
  };

  const disconnect = async () => {
    setDisconnecting(true);
    const { error } = await supabase.functions.invoke("google-calendar-disconnect");
    setDisconnecting(false);
    if (error) {
      console.error("Could not disconnect Google Calendar:", error);
      toast.error(t("availability.googleCalendar.disconnectFailed"));
      return;
    }
    toast.success(t("availability.googleCalendar.disconnectedToast"));
    await refreshStatus();
  };

  return (
    <Card className="surface-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <CalendarDays className="h-5 w-5" />
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{t("availability.googleCalendar.title")}</h2>
            {!loading && status?.connected && (
              <Badge variant="secondary">{t("availability.googleCalendar.connectedStatus")}</Badge>
            )}
            {!loading && status && !status.connected && (
              <Badge variant="outline">{t("availability.googleCalendar.disconnectedStatus")}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {loading
              ? t("availability.googleCalendar.loading")
              : !status
                ? t("availability.googleCalendar.statusFailed")
              : status?.connected
                ? t("availability.googleCalendar.connectedAs", { email: status.email ?? "" })
                : t("availability.googleCalendar.description")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("availability.googleCalendar.privacy")}
          </p>
          {!loading && status && !status.configured && (
            <p className="text-xs text-warning">
              {t("availability.googleCalendar.notConfigured")}
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2">
        {!loading && !status ? (
          <Button variant="outline" onClick={() => void refreshStatus()}>
            {t("availability.googleCalendar.retry")}
          </Button>
        ) : null}
        {status?.connected && status.configured ? (
          <>
            <Button variant="outline" onClick={() => void syncUpcomingSessions()} disabled={syncing || loading}>
              {syncing
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <RefreshCw className="mr-2 h-4 w-4" />}
              {t("availability.googleCalendar.sync")}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={disconnecting}>
                  {disconnecting
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <Unlink className="mr-2 h-4 w-4" />}
                  {t("availability.googleCalendar.disconnect")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("availability.googleCalendar.disconnectTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("availability.googleCalendar.disconnectDescription")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("availability.googleCalendar.keepConnected")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void disconnect()}>
                    {t("availability.googleCalendar.disconnect")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : (
          <Button
            onClick={() => void connect()}
            disabled={loading || connecting || !status?.configured}
          >
            {connecting
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <ExternalLink className="mr-2 h-4 w-4" />}
            {t("availability.googleCalendar.connect")}
          </Button>
        )}
      </div>
    </Card>
  );
}
