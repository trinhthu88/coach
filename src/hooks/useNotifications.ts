import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

export interface NotificationRow {
  id: string;
  notification_type: string;
  title: string;
  title_vi: string | null;
  body: string | null;
  body_vi: string | null;
  link: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

const RECENT_LIMIT = 20;

/**
 * Recent notifications for the current user, kept live via Realtime on the
 * `notifications` table (see 20260903110300_notifications.sql — it's in the
 * supabase_realtime publication). Notifications are only ever written
 * server-side; this hook only reads and marks-read.
 */
export function useNotifications() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["notifications", user?.id];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(RECENT_LIMIT);
      if (error) throw error;
      return (data ?? []) as NotificationRow[];
    },
    enabled: !!user,
    staleTime: 15_000,
  });

  const unreadCount = useMemo(
    () => (data ?? []).filter((n) => !n.is_read).length,
    [data]
  );

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const markRead = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq("id", id);
      if (!error) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
    [queryClient, queryKey]
  );

  const markAllRead = useCallback(async () => {
    if (!user) return;
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("is_read", false);
    if (!error) {
      queryClient.invalidateQueries({ queryKey });
    }
  }, [user, queryClient, queryKey]);

  return {
    notifications: data ?? [],
    unreadCount,
    loading: !!user && isLoading,
    markRead,
    markAllRead,
  };
}
