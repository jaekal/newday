"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-4 text-center">
      <p className="text-5xl font-bold text-gray-200">Oops</p>
      <h2 className="text-xl font-semibold text-gray-900">Something went wrong</h2>
      <p className="text-gray-500 max-w-sm">{error.message || "An unexpected error occurred."}</p>
      <Button onClick={reset}>Try Again</Button>
    </div>
  );
}
