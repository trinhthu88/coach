import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatDistanceToNow } from "date-fns";
import { Bell, CheckCheck } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNotifications, NotificationRow } from "@/hooks/useNotifications";

export function NotificationBell() {
  const { t, i18n } = useTranslation("common");
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const isVi = i18n.language?.startsWith("vi");

  const openNotification = (n: NotificationRow) => {
    if (!n.is_read) markRead(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative grid h-[34px] w-[34px] place-items-center rounded-[11px] border border-border bg-card text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
          aria-label={t("notifications.openMenu")}
          title={t("notifications.openMenu")}
        >
          <Bell className="h-[17px] w-[17px]" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-accent-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-0">
        <div className="flex items-center justify-between border-b px-3.5 py-2.5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("notifications.title")}</p>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-auto p-1 text-[11px]" onClick={markAllRead}>
              <CheckCheck className="mr-1 h-3.5 w-3.5" /> {t("notifications.markAllRead")}
            </Button>
          )}
        </div>
        <div className="max-h-[380px] overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t("notifications.empty")}</p>
          ) : (
            <ul className="divide-y">
              {notifications.map((n) => {
                const title = (isVi && n.title_vi) || n.title;
                const body = (isVi && n.body_vi) || n.body;
                return (
                  <li key={n.id}>
                    <button
                      onClick={() => openNotification(n)}
                      className={cn(
                        "block w-full px-3.5 py-3 text-left transition-colors hover:bg-muted/50",
                        !n.is_read && "bg-primary-soft/40"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {!n.is_read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                        <div className="min-w-0 flex-1">
                          <p className={cn("truncate text-sm", n.is_read ? "font-medium text-foreground" : "font-semibold text-foreground")}>
                            {title}
                          </p>
                          {body && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{body}</p>}
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
