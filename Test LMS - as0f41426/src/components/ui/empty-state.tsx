import * as React from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  message,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  message: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-dashed border-[#dcdcdc] bg-[#fbfbfb] px-6 py-10 text-center", className)}>
      {icon ? <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#888888] shadow-sm">{icon}</div> : null}
      <h3 className="text-lg font-semibold text-[#111111]">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm text-[#888888]">{message}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
