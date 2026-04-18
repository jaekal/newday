"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

type Question = {
  id: string;
  type: string;
  difficulty: string;
  stem: string;
  points: number;
};

type Props = {
  questions: Question[];
  selectedIds?: Set<string>;
  onSelect?: (id: string) => void;
  className?: string;
};

// Difficulty → fill color
const DIFF_COLOR: Record<string, string> = {
  EASY: "#22c55e",
  MEDIUM: "#f59e0b",
  HARD: "#ef4444",
};

// Objective types (auto-graded)
const OBJECTIVE_TYPES = new Set([
  "MULTIPLE_CHOICE",
  "MULTI_SELECT",
  "TRUE_FALSE",
  "FILL_IN_BLANK",
]);

const SEG_W = 18;
const SEG_H = 28;
const SEG_GAP = 4;
const PAD = 4;

/** Returns an SVG path string for the given question type */
function segmentPath(type: string, x: number): string {
  const cx = x + SEG_W / 2;
  const cy = SEG_H / 2;
  switch (type) {
    case "MULTIPLE_CHOICE":
    case "MULTI_SELECT":
      // Square
      return `M${x},0 h${SEG_W} v${SEG_H} h-${SEG_W} Z`;
    case "TRUE_FALSE":
      // Circle (approximated as rounded rect)
      return `M${x + SEG_W / 2},0 a${SEG_W / 2},${SEG_H / 2} 0 1 1 0,${SEG_H} a${SEG_W / 2},${SEG_H / 2} 0 1 1 0,-${SEG_H}`;
    case "FILL_IN_BLANK":
      // Diamond
      return `M${cx},0 L${x + SEG_W},${cy} L${cx},${SEG_H} L${x},${cy} Z`;
    case "ESSAY":
      // Tall rounded rect — same as rect but taller, indicated by extra notch
      return `M${x + 3},0 h${SEG_W - 6} a3,3 0 0 1 3,3 v${SEG_H - 6} a3,3 0 0 1 -3,3 h-${SEG_W - 6} a3,3 0 0 1 -3,-3 v-${SEG_H - 6} a3,3 0 0 1 3,-3 Z`;
    case "SHORT_ANSWER":
    default:
      // Rounded rect
      return `M${x + 4},0 h${SEG_W - 8} a4,4 0 0 1 4,4 v${SEG_H - 8} a4,4 0 0 1 -4,4 h-${SEG_W - 8} a4,4 0 0 1 -4,-4 v-${SEG_H - 8} a4,4 0 0 1 4,-4 Z`;
  }
}

export function QuestionDnaStrip({ questions, selectedIds, onSelect, className }: Props) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (questions.length === 0) return null;

  const totalW = questions.length * (SEG_W + SEG_GAP) - SEG_GAP + PAD * 2;
  const svgH = SEG_H + PAD * 2;

  // Stats
  const byDiff = { EASY: 0, MEDIUM: 0, HARD: 0 } as Record<string, number>;
  let objective = 0;
  for (const q of questions) {
    byDiff[q.difficulty] = (byDiff[q.difficulty] ?? 0) + 1;
    if (OBJECTIVE_TYPES.has(q.type)) objective++;
  }
  const subjective = questions.length - objective;
  const objPct = Math.round((objective / questions.length) * 100);

  const hovered = hoveredIdx !== null ? questions[hoveredIdx] : null;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="relative overflow-x-auto">
        <svg
          width={totalW}
          height={svgH}
          viewBox={`0 0 ${totalW} ${svgH}`}
          className="cursor-pointer"
        >
          {questions.map((q, i) => {
            const x = PAD + i * (SEG_W + SEG_GAP);
            const isHovered = hoveredIdx === i;
            const isSelected = selectedIds?.has(q.id);
            const fill = DIFF_COLOR[q.difficulty] ?? "#94a3b8";

            return (
              <g
                key={q.id}
                transform={`translate(0, ${PAD})`}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
                onClick={() => onSelect?.(q.id)}
              >
                <path
                  d={segmentPath(q.type, x)}
                  fill={fill}
                  opacity={isSelected ? 1 : isHovered ? 0.9 : 0.72}
                  stroke={isSelected ? "#1e3a8a" : isHovered ? "white" : "none"}
                  strokeWidth={isSelected || isHovered ? 1.5 : 0}
                  style={{ transition: "opacity 0.1s, transform 0.1s" }}
                  transform={isHovered ? `translate(0,-2)` : ""}
                />
              </g>
            );
          })}
        </svg>

        {/* Tooltip */}
        {hovered && hoveredIdx !== null && (
          <div
            className="absolute top-full mt-1 bg-gray-900 text-white text-xs rounded-lg px-2.5 py-1.5 pointer-events-none whitespace-nowrap shadow-lg z-10"
            style={{
              left: PAD + hoveredIdx * (SEG_W + SEG_GAP) + SEG_W / 2,
              transform: "translateX(-50%)",
            }}
          >
            <div className="font-medium">{hovered.type.replace(/_/g, " ")}</div>
            <div className="text-gray-300">
              {hovered.difficulty} · {hovered.points}pt
            </div>
            <div className="text-gray-400 max-w-[180px] truncate mt-0.5">{hovered.stem}</div>
          </div>
        )}
      </div>

      {/* Legend + stats */}
      <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
        <div className="flex items-center gap-2">
          {Object.entries(byDiff).map(([d, count]) =>
            count > 0 ? (
              <span key={d} className="flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ backgroundColor: DIFF_COLOR[d] }}
                />
                {count} {d.toLowerCase()}
              </span>
            ) : null,
          )}
        </div>
        <span className="text-gray-300">·</span>
        <span>
          {objPct}% objective / {100 - objPct}% subjective
        </span>
        <span className="text-gray-300">·</span>
        <div className="flex items-center gap-2 text-gray-400">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 bg-gray-400" /> MC
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-gray-400" /> T/F
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rotate-45 bg-gray-400" /> Fill
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded bg-gray-400" /> Essay
          </span>
        </div>
      </div>
    </div>
  );
}
