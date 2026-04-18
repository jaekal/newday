"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

type CourseAxis = {
  courseId: string;
  title: string;
  progress: number;
  totalModules: number;
  completedModules: number;
  recentlyActive: boolean;
};

type Props = {
  courses: CourseAxis[];
  variant?: "light" | "dark";
  className?: string;
  onNodeClick?: (course: CourseAxis) => void;
};

const SIZE = 280;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 100;
const LEVELS = 4;

function polarToXY(angle: number, radius: number) {
  return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle) };
}

export function SkillRadarChart({ courses, variant = "light", className, onNodeClick }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const router = useRouter();

  const dark = variant === "dark";
  const gridColor   = dark ? "var(--c-dark-2)" : "#e5e7eb";
  const labelColor  = dark ? "var(--muted)" : "#374151";
  const fillColor   = "var(--c-accent)";
  const strokeColor = "var(--c-accent)";
  const nodeDefault = "var(--c-accent)";
  const nodeActive  = "var(--c-accent)";

  if (courses.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-64 text-sm", dark ? "text-white/30" : "text-gray-400", className)}>
        Enroll in courses to see your skill web
      </div>
    );
  }

  const N = courses.length;
  const angles = courses.map((_, i) => (2 * Math.PI * i) / N - Math.PI / 2);
  const polygon = (scale: number) => angles.map((a) => polarToXY(a, R * scale));
  const gridPolygons = Array.from({ length: LEVELS }, (_, i) => polygon((i + 1) / LEVELS));
  const valuePoints = courses.map((c, i) => polarToXY(angles[i], R * (c.progress / 100)));
  const valuePolygonPath =
    valuePoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + " Z";

  const hovered = courses.find((c) => c.courseId === hoveredId);

  return (
    <div className={cn("relative select-none", className)}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto">
        {gridPolygons.map((pts, lvl) => (
          <polygon key={lvl} points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={gridColor} strokeWidth={1} />
        ))}
        {angles.map((a, i) => {
          const end = polarToXY(a, R);
          return <line key={i} x1={CX} y1={CY} x2={end.x} y2={end.y} stroke={gridColor} strokeWidth={1} />;
        })}

        {/* Value polygon — glows on dark */}
        <path
          d={valuePolygonPath}
          fill={fillColor}
          fillOpacity={0.15}
          stroke={strokeColor}
          strokeWidth={2}
          strokeLinejoin="round"
          className={dark ? "accent-glow" : ""}
        />

        {courses.map((c, i) => {
          const pt = polarToXY(angles[i], R * (c.progress / 100));
          const isHovered = hoveredId === c.courseId;
          const fill = c.recentlyActive ? nodeActive : nodeDefault;
          return (
            <g
              key={c.courseId}
              className="cursor-pointer"
              onClick={() => onNodeClick ? onNodeClick(c) : router.push(`/courses/${c.courseId}`)}
              onMouseEnter={() => setHoveredId(c.courseId)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* Halo on dark */}
              {dark && isHovered && (
                <circle cx={pt.x} cy={pt.y} r={12} fill={fill} opacity={0.15} />
              )}
              <circle
                cx={pt.x} cy={pt.y}
                r={isHovered ? 7 : 5}
                fill={fill}
                stroke={dark ? "var(--c-dark)" : "white"}
                strokeWidth={2}
                className={c.recentlyActive ? "animate-pulse" : ""}
                style={{ transition: "r 0.15s ease" }}
              />
            </g>
          );
        })}

        {courses.map((c, i) => {
          const labelPt = polarToXY(angles[i], R + 22);
          const anchor = labelPt.x < CX - 4 ? "end" : labelPt.x > CX + 4 ? "start" : "middle";
          const truncated = c.title.length > 14 ? c.title.slice(0, 13) + "…" : c.title;
          return (
            <text
              key={c.courseId}
              x={labelPt.x} y={labelPt.y}
              textAnchor={anchor}
              dominantBaseline="middle"
              fontSize={10}
              fill={labelColor}
              className="cursor-pointer"
              onClick={() => onNodeClick ? onNodeClick(c) : router.push(`/courses/${c.courseId}`)}
            >
              {truncated}
            </text>
          );
        })}
      </svg>

      {hoveredId && hovered && (
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-white text-xs rounded-lg px-3 py-2 pointer-events-none whitespace-nowrap shadow-lg" style={{ background: "var(--c-dark)" }}>
          <span className="font-semibold">{hovered.title}</span>
          <span className="ml-2 text-white/50">
            {hovered.progress}%
            {hovered.totalModules - hovered.completedModules > 0
              ? ` · ${hovered.totalModules - hovered.completedModules} left`
              : " · Complete!"}
          </span>
        </div>
      )}
    </div>
  );
}
