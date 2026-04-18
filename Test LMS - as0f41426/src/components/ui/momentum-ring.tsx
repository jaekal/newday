"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Flame } from "lucide-react";

type StreakData = {
  streakDays: number;
  todayTotal: number;
  dailyGoal: number;
  weekHistory: Array<{ date: string; active: boolean }>;
};

type Props = {
  data: StreakData;
  variant?: "light" | "dark";
  className?: string;
};

const OUTER_R = 52;
const INNER_R = 36;
const CX = 68;
const CY = 68;
const SIZE = 136;

function arc(r: number, progress: number) {
  const circumference = 2 * Math.PI * r;
  return { circumference, offset: circumference * (1 - Math.min(progress, 1)) };
}

export function MomentumRing({ data, variant = "light", className }: Props) {
  const outerRef = useRef<SVGCircleElement>(null);
  const innerRef = useRef<SVGCircleElement>(null);

  const dark = variant === "dark";
  const outerProgress = Math.min(data.streakDays / 7, 1);
  const innerProgress = Math.min(data.todayTotal / data.dailyGoal, 1);
  const outer = arc(OUTER_R, outerProgress);
  const inner = arc(INNER_R, innerProgress);

  const trackColor    = dark ? "var(--c-dark-2)" : "#f4f4f4";
  const outerStroke   = "var(--c-accent)";
  const innerStroke   = innerProgress >= 1 ? "var(--c-accent)" : "#f59e0b";
  const textFill      = dark ? "#f0f0f0" : "#111827";
  const subtextFill   = dark ? "#555555" : "#6b7280";
  const dotActive     = "var(--c-accent)";
  const dotInactive   = dark ? "var(--c-dark-2)" : "#e5e7eb";

  useEffect(() => {
    const t = setTimeout(() => {
      if (outerRef.current) outerRef.current.style.strokeDashoffset = String(outer.offset);
      if (innerRef.current) innerRef.current.style.strokeDashoffset = String(inner.offset);
    }, 50);
    return () => clearTimeout(t);
  }, [outer.offset, inner.offset]);

  const isStreakMilestone = data.streakDays > 0 && data.streakDays % 7 === 0;

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <div className="relative">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle cx={CX} cy={CY} r={OUTER_R} fill="none" stroke={trackColor} strokeWidth={8} />
          <circle
            ref={outerRef}
            cx={CX} cy={CY} r={OUTER_R}
            fill="none" stroke={outerStroke} strokeWidth={8} strokeLinecap="round"
            strokeDasharray={outer.circumference} strokeDashoffset={outer.circumference}
            transform={`rotate(-90 ${CX} ${CY})`}
            style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)" }}
          />
          <circle cx={CX} cy={CY} r={INNER_R} fill="none" stroke={trackColor} strokeWidth={7} />
          <circle
            ref={innerRef}
            cx={CX} cy={CY} r={INNER_R}
            fill="none" stroke={innerStroke} strokeWidth={7} strokeLinecap="round"
            strokeDasharray={inner.circumference} strokeDashoffset={inner.circumference}
            transform={`rotate(-90 ${CX} ${CY})`}
            style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.4,0,0.2,1)" }}
          />
          <text x={CX} y={CY - 6} textAnchor="middle" fontSize={18} fontWeight="bold" fill={textFill}>
            {data.streakDays}
          </text>
          <text x={CX} y={CY + 10} textAnchor="middle" fontSize={9} fill={subtextFill}>
            day streak
          </text>
        </svg>

        {isStreakMilestone && (
          <div className="absolute -top-1 -right-1 bg-orange-500 rounded-full p-1">
            <Flame className="h-3 w-3 text-white" />
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {data.weekHistory.map((day, i) => {
          const isToday = i === 6;
          return (
            <div
              key={day.date}
              title={day.date}
              className={cn("rounded-full transition-all", isToday ? "h-3 w-3" : "h-2 w-2")}
              style={{
                backgroundColor: day.active ? dotActive : dotInactive,
                opacity: day.active && !isToday ? 0.6 : 1,
                ...(isToday && day.active ? { boxShadow: "0 0 0 2px color-mix(in srgb, var(--c-accent) 20%, transparent)" } : {}),
              }}
            />
          );
        })}
      </div>

      <p className={cn("text-xs text-center", dark ? "text-white/30" : "text-[#888888]")}>
        {data.todayTotal >= data.dailyGoal ? "Daily goal complete!" : `${data.todayTotal}/${data.dailyGoal} today`}
      </p>
    </div>
  );
}
