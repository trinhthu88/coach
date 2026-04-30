import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface Thread {
  session_id: string;
  topic: string;
  start_time: string;
  status: string;
  counterpart_id: string;
  counterpart_name: string | null;
  counterpart_avatar: string | null;
}
interface Message {
  id: string;
  session_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

export default function Messages() {
  const { user, role } = useAuth();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [active, setActive] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load threads (confirmed/completed sessions)
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

      const sessions = ses || [];
      const otherIds = Array.from(
        new Set(sessions.map((s: any) => (role === "coach" ? s.coachee_id : s.coach_id)))
      );
      const { data: profs } =
        otherIds.length > 0
          ? await supabase
              .from("profiles")
              .select("id, full_name, avatar_url")
              .in("id", otherIds)
          : { data: [] as any };
      const byId = new Map((profs || []).map((p: any) => [p.id, p]));

      const list: Thread[] = sessions.map((s: any) => {
        const otherId = role === "coach" ? s.coachee_id : s.coach_id;
        const p: any = byId.get(otherId);
        return {
          session_id: s.id,
          topic: s.topic,
          start_time: s.start_time,
          status: s.status,
          counterpart_id: otherId,
          counterpart_name: p?.full_name || null,
          counterpart_avatar: p?.avatar_url || null,
        };
      });
      setThreads(list);
      if (list.length && !active) setActive(list[0]);
      setLoading(false);
    })();
  }, [user, role]);

  // Load messages for active thread + subscribe realtime
  const loadMessages = useCallback(async (sid: string) => {
    const { data } = await supabase
      .from("session_messages")
      .select("*")
      .eq("session_id", sid)
      .order("created_at", { ascending: true });
    setMessages((data as Message[]) || []);
  }, []);

  useEffect(() => {
    if (!active) return;
    loadMessages(active.session_id);
    const channel = supabase
      .channel(`messages-${active.session_id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "session_messages",
          filter: `session_id=eq.${active.session_id}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message]);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [active, loadMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    if (!user || !active || !text.trim()) return;
    const body = text.trim();
    setText("");
    const { error } = await supabase.from("session_messages").insert({
      session_id: active.session_id,
      sender_id: user.id,
      body,
    });
    if (error) {
      // restore text if failed
      setText(body);
    }
  };

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
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
          <p className="text-sm text-muted-foreground">
            Chat unlocks once a session is confirmed.
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
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
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
                const isActive = active?.session_id === t.session_id;
                return (
                  <li key={t.session_id}>
                    <button
                      onClick={() => setActive(t)}
                      className={cn(
                        "flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-muted/40",
                        isActive && "bg-primary-soft/60"
                      )}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary-soft text-xs font-bold text-primary">
                        {t.counterpart_avatar ? (
                          <img
                            src={t.counterpart_avatar}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          initials
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {t.counterpart_name || "—"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{t.topic}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {format(new Date(t.start_time), "MMM d · p")}
                        </p>
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
                  <p className="text-xs text-muted-foreground">{active.topic}</p>
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
