"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";

type Attempt = {
  id: string;
  studentName: string;
  studentEmail: string;
  submittedAt: Date | string | null;
  percentScore: number;
  assessmentId: string;
  attemptId: string | undefined;
  isPassed: boolean | null;
};

type Props = {
  attempts: Attempt[];
  assessmentTitle: string;
  className?: string;
};

function scoreToColor(score: number): string {
  if (score >= 85) return "#16a34a";
  if (score >= 70) return "#86efac";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

function scoreToTextColor(score: number): string {
  return score >= 50 ? "#111827" : "#fff";
}

export function AssessmentHeatmap({ attempts, assessmentTitle, className }: Props) {
  const [threshold, setThreshold] = useState(70);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const withTime = attempts.filter((a) => a.submittedAt != null);
    return [...withTime].sort(
      (a, b) =>
        new Date(a.submittedAt!).getTime() - new Date(b.submittedAt!).getTime(),
    );
  }, [attempts]);

  const minTime = sorted.length > 0 ? new Date(sorted[0].submittedAt!).getTime() : 0;
  const maxTime =
    sorted.length > 1
      ? new Date(sorted[sorted.length - 1].submittedAt!).getTime()
      : minTime + 1;
  const timeRange = maxTime - minTime || 1;

  const selected = sorted.find((a) => a.id === selectedId);

  if (sorted.length === 0) {
    return (
      <div className={cn("py-8 text-center text-gray-400 text-sm", className)}>
        No submitted attempts for this assessment yet.
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Threshold slider */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500 w-24 shrink-0">Pass threshold</span>
        <input
          type="range"
          min={0}
          max={100}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="flex-1 accent-blue-600"
        />
        <span className="text-sm font-semibold text-blue-700 w-10 text-right">{threshold}%</span>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Time axis labels */}
        <div className="flex justify-between text-xs text-gray-400 mb-1 px-1">
          <span>Earliest</span>
          <span>{assessmentTitle}</span>
          <span>Latest</span>
        </div>

        <div className="relative h-16 bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
          {/* Pass/fail divider line */}
          {sorted.map((a) => {
            const leftPct =
              sorted.length === 1
                ? 50
                : ((new Date(a.submittedAt!).getTime() - minTime) / timeRange) * 88 + 4;
            const passing = a.percentScore >= threshold;
            const isSelected = selectedId === a.id;

            return (
              <button
                key={a.id}
                onClick={() => setSelectedId(isSelected ? null : a.id)}
                title={`${a.studentName}: ${Math.round(a.percentScore)}%`}
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-transform hover:scale-110"
                style={{ left: `${leftPct}%` }}
              >
                <div
                  className={cn(
                    "flex items-center justify-center rounded text-xs font-bold transition-all",
                    isSelected ? "h-10 w-10 ring-2 ring-blue-500 ring-offset-1" : "h-8 w-8",
                    !passing && "opacity-60",
                  )}
                  style={{
                    backgroundColor: scoreToColor(a.percentScore),
                    color: scoreToTextColor(a.percentScore),
                  }}
                >
                  {Math.round(a.percentScore)}
                </div>
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-600" /> ≥{threshold}% pass
            </span>
            <span className="flex items-center gap-1 opacity-60">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-500" /> &lt;{threshold}% fail
            </span>
          </div>
          <span>
            {sorted.filter((a) => a.percentScore >= threshold).length}/{sorted.length} passing
          </span>
        </div>
      </div>

      {/* Selected attempt detail */}
      {selected && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between text-sm">
          <div>
            <span className="font-semibold text-gray-900">{selected.studentName}</span>
            <span className="text-gray-500 ml-2">{selected.studentEmail}</span>
          </div>
          <div className="flex items-center gap-3">
            <span
              className="font-bold"
              style={{ color: scoreToColor(selected.percentScore) }}
            >
              {Math.round(selected.percentScore)}%
            </span>
            <span className="text-gray-400 text-xs">
              {selected.submittedAt
                ? new Date(selected.submittedAt).toLocaleString()
                : "—"}
            </span>
            {selected.attemptId && (
              <Link
                href={`/assessments/${selected.assessmentId}/results/${selected.attemptId}`}
                className="text-blue-600 hover:underline text-xs font-medium"
              >
                View →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
