"use client";

import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { X, CheckCircle2, XCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "default" | "success" | "error";

type Toast = {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
};

type ToastContextValue = {
  toast: (opts: Omit<Toast, "id">) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  function toast(opts: Omit<Toast, "id">) {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { ...opts, id }]);
  }

  function remove(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <ToastContext.Provider value={{ toast }}>
      <ToastPrimitive.Provider swipeDirection="right" duration={4000}>
        {children}
        {toasts.map((t) => (
          <ToastPrimitive.Root
            key={t.id}
            onOpenChange={(open) => { if (!open) remove(t.id); }}
            className={cn(
              "group pointer-events-auto relative flex items-start gap-3 w-full max-w-sm rounded-xl border p-4 shadow-lg",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[swipe=end]:animate-out data-[state=closed]:fade-out-80",
              "data-[state=open]:slide-in-from-bottom-full",
              t.variant === "success" && "bg-green-50 border-green-200 text-green-900",
              t.variant === "error" && "bg-red-50 border-red-200 text-red-900",
              (!t.variant || t.variant === "default") && "bg-white border-gray-200 text-gray-900"
            )}
          >
            <div className="shrink-0 mt-0.5">
              {t.variant === "success" && <CheckCircle2 className="h-4 w-4 text-green-600" />}
              {t.variant === "error" && <XCircle className="h-4 w-4 text-red-500" />}
              {(!t.variant || t.variant === "default") && <Info className="h-4 w-4 text-blue-500" />}
            </div>
            <div className="flex-1 min-w-0">
              <ToastPrimitive.Title className="text-sm font-semibold">{t.title}</ToastPrimitive.Title>
              {t.description && (
                <ToastPrimitive.Description className="text-xs mt-0.5 text-gray-500">
                  {t.description}
                </ToastPrimitive.Description>
              )}
            </div>
            <ToastPrimitive.Close className="shrink-0 opacity-60 hover:opacity-100 transition-opacity">
              <X className="h-4 w-4" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-full max-w-sm" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
