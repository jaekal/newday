"use client";

import { useState, useRef, useEffect } from "react";
import { Bell } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import Link from "next/link";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data, refetch } = trpc.notification.list.useQuery({ limit: 20 });
  const markRead = trpc.notification.markRead.useMutation({ onSuccess: () => refetch() });
  const markAll = trpc.notification.markAllRead.useMutation({ onSuccess: () => refetch() });

  const unread = data?.unread ?? 0;

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center justify-center h-8 w-8 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors"
        title="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white px-0.5"
            style={{ background: "var(--c-accent)" }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-80 rounded-xl border border-white/10 shadow-2xl overflow-hidden z-50"
          style={{ background: "var(--c-sidebar)" }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
            <span className="text-sm font-semibold text-white">Notifications</span>
            {unread > 0 && (
              <button
                onClick={() => markAll.mutate()}
                className="text-xs text-white/40 hover:text-white transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {!data?.notifications.length && (
              <p className="text-xs text-white/30 text-center py-8">No notifications</p>
            )}
            {data?.notifications.map((n) => (
              <div
                key={n.id}
                className={cn(
                  "px-4 py-3 border-b border-white/5 cursor-pointer hover:bg-white/5 transition-colors",
                  !n.read && "bg-white/3"
                )}
                onClick={() => {
                  if (!n.read) markRead.mutate({ id: n.id });
                  setOpen(false);
                }}
              >
                {n.link ? (
                  <Link href={n.link} className="block">
                    <NotificationItem n={n} />
                  </Link>
                ) : (
                  <NotificationItem n={n} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationItem({ n }: { n: { title: string; body?: string | null; read: boolean; createdAt: Date } }) {
  return (
    <>
      <div className="flex items-start gap-2">
        {!n.read && (
          <span className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0" style={{ background: "var(--c-accent)" }} />
        )}
        <div className={cn("flex-1", n.read && "pl-3.5")}>
          <p className="text-xs font-medium text-white leading-snug">{n.title}</p>
          {n.body && <p className="text-xs text-white/40 mt-0.5 leading-snug">{n.body}</p>}
          <p className="text-[10px] text-white/20 mt-1">
            {new Date(n.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>
    </>
  );
}
