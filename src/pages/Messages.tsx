import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, MessageSquare, Send, Mail } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { cn } from "@/lib/utils";

interface SessionLite {
  id: string;
  topic: string;
  start_time: string;
  status: string;
  coach_id: string;
  coachee_id: string;
}

interface Thread {
  counterpart_id: string;
  counterpart_name: string | null;
  counterpart_avatar: string | null;
  session_ids: string[];
  latest_topic: string;
  latest_at: string;
  unread: number;
  last_preview: string;
}

interface Message {
  id: string;
  session_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

const formatStamp = (iso: string) => {
  const d = new Date(iso);
  if (isToday(d)) return format(d, "p");
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMM d");
};

export default function Messages() {
  const { user, role } = useAuth();
  const [sessions, setSessions] = useState<SessionLite[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const active = useMemo(
    () => threads.find((t) => t.counterpart_id === activeId) || null,
    [threads, activeId]
  );

  // Build threads from sessions + messages
  const buildThreads = useCallback(
    async (sess: SessionLite[]) => {
      if (!user || !role) return;
      const otherIds = Array.from(
        new Set(sess.map((s) => (role === "coach" ? s.coachee_id : s.coach_id)))
      );
      const sessionIds = sess.map((s) => s.id);

      const [{ data: profs }, { data: msgs }] = await Promise.all([
        otherIds.length
          ? supabase.from("profiles").select("id, full_name, avatar_url").in("id", otherIds)
          : Promise.resolve({ data: [] as any }),
        sessionIds.length
          ? supabase
              .from("session_messages")
              .select("id, session_id, sender_id, body, created_at, read_at")
              .in("session_id", sessionIds)
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [] as any }),
      ]);

      const profById = new Map((profs || []).map((p: any) => [p.id, p]));
      const sessionToOther = new Map(
        sess.map((s) => [s.id, role === "coach" ? s.coachee_id : s.coach_id])
      );

      // Group sessions by counterpart
      const byCounterpart = new Map<string, SessionLite[]>();
      sess.forEach((s) => {
        const other = role === "coach" ? s.coachee_id : s.coach_id;
        const arr = byCounterpart.get(other) || [];
        arr.push(s);
        byCounterpart.set(other, arr);
      });

      // Latest message per counterpart + unread count
      const latestByOther = new Map<string, Message>();
      const unreadByOther = new Map<string, number>();
      const lastSessionByOther = new Map<string, string>();

      (msgs || []).forEach((m: any) => {
        const other = sessionToOther.get(m.session_id);
        if (!other) return;
        if (!latestByOther.has(other)) {
          latestByOther.set(other, m);
          lastSessionByOther.set(other, m.session_id);
        }
        if (m.sender_id !== user.id && !m.read_at) {
          unreadByOther.set(other, (unreadByOther.get(other) || 0) + 1);
        }
      });

      const list: Thread[] = Array.from(byCounterpart.entries()).map(
        ([otherId, ses]) => {
          const p: any = profById.get(otherId);
          const latest = latestByOther.get(otherId);
          const sortedSessions = [...ses].sort(
            (a, b) => +new Date(b.start_time) - +new Date(a.start_time)
          );
          return {
            counterpart_id: otherId,
            counterpart_name: p?.full_name || null,
            counterpart_avatar: p?.avatar_url || null,
            session_ids: sortedSessions.map((s) => s.id),
            latest_topic: sortedSessions[0]?.topic || "",
            latest_at: latest?.created_at || sortedSessions[0]?.start_time,
            unread: unreadByOther.get(otherId) || 0,
            last_preview: latest?.body || "No messages yet",
          };
        }
      );

      list.sort((a, b) => +new Date(b.latest_at) - +new Date(a.latest_at));
      setThreads(list);
      if (list.length && !activeId) setActiveId(list[0].counterpart_id);
    },
    [user, role, activeId]
  );

  // Load sessions
  useEffect(() => {
    if (!user || !role) return;
    (async () => {
      const filterCol = role === "coach" ? "coach_id" : "coachee_id";
      const { data: ses } = await supabase
        .from("sessions")
        .select("id, topic, start_time, status, coach_id, coachee_id")
        .eq(filterCol, user.id)
        .in("status", ["confirmed", "completed"])
        .order("start_time", { ascending: false });

      const list = (ses || []) as SessionLite[];
      setSessions(list);
      await buildThreads(list);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, role]);

  // Load messages for the active thread (across all sessions with that counterpart)
  const loadMessages = useCallback(
    async (sessionIds: string[]) => {
      if (sessionIds.length === 0) {
        setMessages([]);
        return;
      }
      const { data } = await supabase
        .from("session_messages")
        .select("*")
        .in("session_id", sessionIds)
        .order("created_at", { ascending: true });
      setMessages((data as Message[]) || []);

      // Mark unread from counterpart as read
      if (user) {
        const unreadIds = (data || [])
          .filter((m: any) => m.sender_id !== user.id && !m.read_at)
          .map((m: any) => m.id);
        if (unreadIds.length) {
          await supabase
            .from("session_messages")
            .update({ read_at: new Date().toISOString() })
            .in("id", unreadIds);
          // refresh thread unread counts
          buildThreads(sessions);
        }
      }
    },
    [user, sessions, buildThreads]
  );

  useEffect(() => {
    if (!active) return;
    loadMessages(active.session_ids);
  }, [active, loadMessages]);

  // Realtime: subscribe to all session ids in scope
  useEffect(() => {
    if (!sessions.length || !user) return;
    const channel = supabase
      .channel(`messages-all-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "session_messages" },
        (payload) => {
          const m = payload.new as Message;
          // If it's part of a session we care about
          if (!sessions.some((s) => s.id === m.session_id)) return;
          if (active && active.session_ids.includes(m.session_id)) {
            setMessages((prev) => [...prev, m]);
            // auto mark as read if from counterpart
            if (m.sender_id !== user.id) {
              supabase
                .from("session_messages")
                .update({ read_at: new Date().toISOString() })
                .eq("id", m.id);
            }
          } else {
            // Refresh threads to bump unread
            buildThreads(sessions);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessions, active, user, buildThreads]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    if (!user || !active || !text.trim()) return;
    // Use the most recent session id for this counterpart
    const sessionId = active.session_ids[0];
    const body = text.trim();
    setText("");
    const { error } = await supabase.from("session_messages").insert({
      session_id: sessionId,
      sender_id: user.id,
      body,
    });
    if (error) setText(body);
  };

  const totalUnread = threads.reduce((acc, t) => acc + t.unread, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <MessageSquare className="h-5 w-5" />
          {totalUnread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {totalUnread}
            </span>
          )}
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
          <p className="text-sm text-muted-foreground">
            {totalUnread > 0
              ? `${totalUnread} unread message${totalUnread > 1 ? "s" : ""}`
              : "Chat unlocks once a session is confirmed."}
          </p>
        </div>
      </div>

      {threads.length === 0 ? (
        <Card className="p-12 text-center">
          <h3 className="text-lg font-semibold">No conversations yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Once a session is confirmed, the conversation thread will appear here.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Card className="overflow-hidden p-0">
            <div className="border-b px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Threads
            </div>
            <ul className="max-h-[60vh] overflow-y-auto">
              {threads.map((t) => {
                const initials = (t.counterpart_name || "?")
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();
                const isActive = active?.counterpart_id === t.counterpart_id;
                return (
                  <li key={t.counterpart_id}>
                    <button
                      onClick={() => setActiveId(t.counterpart_id)}
                      className={cn(
                        "flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-muted/40",
                        isActive && "bg-primary-soft/60"
                      )}
                    >
                      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary-soft text-xs font-bold text-primary">
                        {t.counterpart_avatar ? (
                          <img
                            src={t.counterpart_avatar}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          initials
                        )}
                        {t.unread > 0 && (
                          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive">
                            <Mail className="h-2.5 w-2.5 text-destructive-foreground" />
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={cn(
                              "truncate text-sm",
                              t.unread > 0 ? "font-bold" : "font-semibold"
                            )}
                          >
                            {t.counterpart_name || "—"}
                          </p>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {t.latest_at ? formatStamp(t.latest_at) : ""}
                          </span>
                        </div>
                        <p
                          className={cn(
                            "truncate text-xs",
                            t.unread > 0
                              ? "font-semibold text-foreground"
                              : "text-muted-foreground"
                          )}
                        >
                          {t.last_preview}
                        </p>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground">
                            {t.session_ids.length} session
                            {t.session_ids.length !== 1 ? "s" : ""}
                          </span>
                          {t.unread > 0 && (
                            <Badge
                              variant="destructive"
                              className="h-4 px-1.5 text-[10px] leading-none"
                            >
                              {t.unread} new
                            </Badge>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card className="flex h-[60vh] flex-col p-0">
            {active ? (
              <>
                <div className="border-b px-5 py-3">
                  <p className="text-sm font-semibold">{active.counterpart_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {active.session_ids.length} session
                    {active.session_ids.length !== 1 ? "s" : ""} · {active.latest_topic}
                  </p>
                </div>
                <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-5">
                  {messages.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Say hello — this is the start of your conversation.
                    </p>
                  ) : (
                    messages.map((m) => {
                      const mine = m.sender_id === user?.id;
                      return (
                        <div
                          key={m.id}
                          className={cn("flex", mine ? "justify-end" : "justify-start")}
                        >
                          <div
                            className={cn(
                              "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm",
                              mine
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-foreground"
                            )}
                          >
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                            <p
                              className={cn(
                                "mt-1 text-[10px]",
                                mine ? "text-primary-foreground/70" : "text-muted-foreground"
                              )}
                            >
                              {format(new Date(m.created_at), "p")}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    send();
                  }}
                  className="flex items-center gap-2 border-t p-3"
                >
                  <Input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Type a message…"
                  />
                  <Button type="submit" disabled={!text.trim()}>
                    <Send className="h-4 w-4" />
                  </Button>
                </form>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                Select a thread to start chatting.
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
