"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, Lock, Play, ClipboardList, ChevronDown, Clock3 } from "lucide-react";
import { Button } from "./button";
import Link from "next/link";
import { getCompletedModuleIds, isModuleUnlocked } from "@/lib/module-path";

type Module = {
  id: string;
  title: string;
  description: string | null;
  category?: string | null;
  order: number;
  estimatedMinutes?: number | null;
  prerequisiteModuleId?: string | null;
  prerequisiteModule?: { id: string; title: string; order: number } | null;
  completions: Array<{ completedAt: Date | string }>;
};

type Assessment = {
  id: string;
  title: string;
  type: string;
};

type Props = {
  modules: Module[];
  assessments: Assessment[];
  courseId: string;
  isEnrolled: boolean;
  isInstructor: boolean;
};

type NodeState = "completed" | "available" | "locked";

function getState(module: Module, completedModuleIds: Set<string>, isEnrolled: boolean, isInstructor: boolean): NodeState {
  if (!isEnrolled && !isInstructor) return "locked";
  if (module.completions.length > 0) return "completed";
  if (!isInstructor && !isModuleUnlocked(module, completedModuleIds)) return "locked";
  return "available";
}

function ModuleNode({
  module,
  state,
  isSelected,
  onClick,
}: {
  module: Module;
  state: NodeState;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-center gap-1.5 group shrink-0",
        state === "locked" && "cursor-default opacity-50",
      )}
    >
      {/* Node circle */}
      <div
        className={cn(
          "h-12 w-12 rounded-full border-2 flex items-center justify-center transition-all duration-200",
          state === "completed" && "text-[var(--c-accent-fg)] shadow-md",
          state === "available" && [
            "bg-white border-[#111111] text-[#111111]",
            isSelected
              ? "ring-4 ring-blue-100 scale-110 shadow-blue-200 shadow-md"
              : "group-hover:scale-105 group-hover:shadow-md group-hover:shadow-blue-100",
          ],
          state === "locked" && "bg-gray-100 border-gray-300 text-gray-400",
        )}
        style={state === "completed" ? { background: "var(--c-accent)", borderColor: "var(--c-accent)" } : undefined}
      >
        {state === "completed" ? (
          <CheckCircle2 className="h-5 w-5" />
        ) : state === "locked" ? (
          <Lock className="h-4 w-4" />
        ) : (
          <span className="text-sm font-bold">{module.order}</span>
        )}
      </div>

      {/* Label */}
      <span
        className={cn(
          "text-xs font-medium text-center max-w-[72px] leading-tight",
          state === "completed" ? "text-[var(--c-accent)]" : state === "locked" ? "text-gray-400" : "text-[#111111]",
          isSelected && "text-[#111111] font-semibold",
        )}
      >
        {module.title.length > 18 ? module.title.slice(0, 17) + "…" : module.title}
      </span>
    </button>
  );
}

function AssessmentNode({
  assessment,
  isSelected,
  onClick,
}: {
  assessment: Assessment;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="relative flex flex-col items-center gap-1.5 group shrink-0"
    >
      {/* Diamond shape via rotated square */}
      <div
        className={cn(
          "h-10 w-10 border-2 flex items-center justify-center transition-all duration-200",
          "rotate-45",
          isSelected
            ? "bg-purple-500 border-purple-500 text-white ring-4 ring-purple-100 scale-110"
            : "bg-white border-purple-400 text-purple-600 group-hover:scale-105",
        )}
      >
        <ClipboardList className="-rotate-45 h-4 w-4" />
      </div>

      <span
        className={cn(
          "text-xs font-medium text-center max-w-[72px] leading-tight",
          isSelected ? "text-purple-700 font-semibold" : "text-purple-600",
        )}
      >
        {assessment.title.length > 16 ? assessment.title.slice(0, 15) + "…" : assessment.title}
      </span>
    </button>
  );
}

function Connector({ completed }: { completed: boolean }) {
  return (
    <div className="flex-1 min-w-[24px] max-w-[48px] h-0.5 self-start mt-6 shrink-0">
      <div
        className={cn(
          "h-full transition-colors",
          completed ? "bg-[var(--c-accent)]" : "bg-gray-200",
        )}
      />
    </div>
  );
}

// ─── Vertical progress spine ──────────────────────────────────────────────────

export function VerticalProgressSpine({
  modules,
  assessments,
  courseId,
  isEnrolled,
  isInstructor,
}: Props) {
  if (modules.length === 0)
    return <p className="text-sm text-gray-400 text-center py-8">No modules yet</p>;

  type Item =
    | { kind: "module"; data: Module; state: NodeState }
    | { kind: "assessment"; data: Assessment };

  const completedModuleIds = getCompletedModuleIds(modules);

  const items: Item[] = [
    ...modules.map((m) => ({
      kind: "module" as const,
      data: m,
      state: getState(m, completedModuleIds, isEnrolled, isInstructor),
    })),
    ...assessments.map((a) => ({ kind: "assessment" as const, data: a })),
  ];

  const completedCount = modules.filter((m) => m.completions.length > 0).length;
  const progressPct = modules.length > 0 ? Math.round((completedCount / modules.length) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Progress summary */}
      {(isEnrolled || isInstructor) && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${progressPct}%`, background: "var(--c-accent)" }}
            />
          </div>
          <span className="text-xs font-medium text-gray-500 whitespace-nowrap">
            {completedCount}/{modules.length} modules
          </span>
        </div>
      )}

      {/* Spine */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-5 top-5 bottom-5 w-0.5 bg-gray-100" />

        <div className="space-y-1">
          {items.map((item) => {
            if (item.kind === "module") {
              const m = item.data;
              const done = item.state === "completed";
              const locked = item.state === "locked";
              const prevModule = modules.find((module) => module.order === m.order - 1);
              const showCategoryLabel = (m.category?.trim() || "Uncategorized") !== ((prevModule?.category?.trim()) || "Uncategorized");
              return (
                <div key={m.id} className="space-y-2">
                  {showCategoryLabel && (
                    <div className="px-3 pt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                        {m.category?.trim() || "Uncategorized"}
                      </p>
                    </div>
                  )}
                  <Link
                    href={isEnrolled || isInstructor ? `/courses/${courseId}/modules/${m.id}` : "#"}
                    className={cn(
                      "relative flex items-center gap-4 rounded-xl px-3 py-3 transition-all group",
                      locked ? "opacity-50 pointer-events-none" : "hover:bg-gray-50 cursor-pointer",
                    )}
                  >
                    {/* Node */}
                    <div
                      className={cn(
                        "relative z-10 h-10 w-10 rounded-full border-2 flex items-center justify-center shrink-0 transition-all",
                        done && "shadow-md",
                        !done && !locked && "bg-white border-gray-300 group-hover:border-[var(--c-accent)]",
                        locked && "bg-gray-100 border-gray-200",
                      )}
                      style={done ? { background: "var(--c-accent)", borderColor: "var(--c-accent)" } : undefined}
                    >
                      {done ? (
                        <CheckCircle2 className="h-5 w-5 text-white" />
                      ) : locked ? (
                        <Lock className="h-4 w-4 text-gray-400" />
                      ) : (
                        <span className="text-sm font-bold text-gray-600">{m.order}</span>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        "text-sm font-medium truncate",
                        done ? "text-gray-700" : locked ? "text-gray-400" : "text-gray-900",
                      )}>
                        {m.title}
                      </p>
                      {m.description && (
                        <p className="text-xs text-gray-400 truncate mt-0.5">{m.description}</p>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
                        {m.estimatedMinutes ? (
                          <span className="flex items-center gap-1">
                            <Clock3 className="h-3 w-3" />
                            {m.estimatedMinutes} min
                          </span>
                        ) : null}
                        {locked && m.prerequisiteModule ? (
                          <span>Unlocks after Module {m.prerequisiteModule.order}</span>
                        ) : null}
                      </div>
                    </div>

                    {/* Status badge */}
                    {done ? (
                      <span className="text-xs font-medium shrink-0" style={{ color: "var(--c-accent)" }}>Done</span>
                    ) : (isEnrolled || isInstructor) && !locked ? (
                      <Play className="h-4 w-4 text-gray-300 group-hover:text-gray-500 shrink-0 transition-colors" />
                    ) : null}
                  </Link>
                </div>
              );
            }

            // Assessment
            const a = item.data;
            return (
              <Link
                key={a.id}
                href={isEnrolled || isInstructor ? `/assessments/${a.id}` : "#"}
                className="relative flex items-center gap-4 rounded-xl px-3 py-3 hover:bg-purple-50 cursor-pointer group transition-all"
              >
                {/* Diamond node */}
                <div className="relative z-10 h-10 w-10 flex items-center justify-center shrink-0">
                  <div className="h-7 w-7 border-2 border-purple-400 bg-white rotate-45 flex items-center justify-center group-hover:bg-purple-50 transition-colors" />
                  <ClipboardList className="absolute h-4 w-4 text-purple-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-purple-700 truncate">{a.title}</p>
                  <p className="text-xs text-purple-400 uppercase tracking-wide">{a.type}</p>
                </div>
                <ChevronDown className="h-4 w-4 text-purple-300 group-hover:text-purple-500 -rotate-90 shrink-0 transition-colors" />
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ModuleNodeRail({
  modules,
  assessments,
  courseId,
  isEnrolled,
  isInstructor,
}: Props) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  if (modules.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-8">No modules yet</p>
    );
  }

  // Build interleaved node list: all modules in order, then assessments appended
  // In future this could be smarter; for now append assessments at end
  type RailItem =
    | { kind: "module"; data: Module; state: NodeState }
    | { kind: "assessment"; data: Assessment };

  const completedModuleIds = getCompletedModuleIds(modules);

  const items: RailItem[] = [
    ...modules.map((m) => ({
      kind: "module" as const,
      data: m,
      state: getState(m, completedModuleIds, isEnrolled, isInstructor),
    })),
    ...assessments.map((a) => ({ kind: "assessment" as const, data: a })),
  ];

  const selectedModule = selectedNodeId
    ? modules.find((m) => m.id === selectedNodeId)
    : null;
  const selectedAssessment = selectedNodeId
    ? assessments.find((a) => a.id === selectedNodeId)
    : null;
  const selectedModuleState = selectedModule
    ? getState(selectedModule, completedModuleIds, isEnrolled, isInstructor)
    : null;

  return (
    <div className="space-y-4">
      {/* Rail */}
      <div className="overflow-x-auto pb-2">
        <div className="flex items-start gap-0 min-w-max px-2">
          {items.map((item, idx) => (
            <div key={item.data.id} className="flex items-start">
              {item.kind === "module" ? (
                <ModuleNode
                  module={item.data}
                  state={item.state}
                  isSelected={selectedNodeId === item.data.id}
                  onClick={() =>
                    setSelectedNodeId(
                      selectedNodeId === item.data.id ? null : item.data.id,
                    )
                  }
                />
              ) : (
                <AssessmentNode
                  assessment={item.data}
                  isSelected={selectedNodeId === item.data.id}
                  onClick={() =>
                    setSelectedNodeId(
                      selectedNodeId === item.data.id ? null : item.data.id,
                    )
                  }
                />
              )}
              {idx < items.length - 1 && (
                <Connector
                  completed={
                    item.kind === "module" && item.state === "completed"
                  }
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Expanded preview */}
      {selectedModule && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <div>
            <p className="font-semibold text-gray-900">{selectedModule.title}</p>
            {selectedModule.description && (
              <p className="text-sm text-gray-600 mt-1">{selectedModule.description}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              {selectedModule.estimatedMinutes ? (
                <span className="flex items-center gap-1">
                  <Clock3 className="h-3 w-3" />
                  {selectedModule.estimatedMinutes} min
                </span>
              ) : null}
              {selectedModule.prerequisiteModule ? (
                <span>Requires Module {selectedModule.prerequisiteModule.order}</span>
              ) : null}
            </div>
            {selectedModule.completions.length > 0 && (
              <p className="text-xs text-green-700 mt-2 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Completed
              </p>
            )}
            {selectedModuleState === "locked" && selectedModule.prerequisiteModule ? (
              <p className="text-xs text-amber-700 mt-2">
                Complete "{selectedModule.prerequisiteModule.title}" to unlock this module.
              </p>
            ) : null}
          </div>
          {(isEnrolled || isInstructor) && selectedModuleState !== "locked" && (
            <Link href={`/courses/${courseId}/modules/${selectedModule.id}`} className="shrink-0">
              <Button size="sm" variant="outline" className="gap-1.5">
                <Play className="h-3.5 w-3.5" />
                {selectedModule.completions.length > 0 ? "Review" : "Start"}
              </Button>
            </Link>
          )}
        </div>
      )}

      {selectedAssessment && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 flex items-start justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <div>
            <p className="font-semibold text-gray-900">{selectedAssessment.title}</p>
            <p className="text-xs text-purple-600 mt-1 uppercase tracking-wide">
              {selectedAssessment.type}
            </p>
          </div>
          {(isEnrolled || isInstructor) && (
            <Link href={`/assessments/${selectedAssessment.id}`} className="shrink-0">
              <Button size="sm" className="gap-1.5 bg-purple-600 hover:bg-purple-700">
                <ClipboardList className="h-3.5 w-3.5" />
                {isInstructor ? "Manage" : "Start"}
              </Button>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
