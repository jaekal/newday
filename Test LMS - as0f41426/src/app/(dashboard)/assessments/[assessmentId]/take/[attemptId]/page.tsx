"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Clock, ChevronLeft, ChevronRight, Send, Loader2, Check, Maximize2, Minimize2, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

function useTimer(startedAt: Date, timeLimitMins: number | null | undefined) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!timeLimitMins) return;
    const tick = () => {
      const elapsed = (Date.now() - new Date(startedAt).getTime()) / 1000;
      const left = timeLimitMins * 60 - elapsed;
      setRemaining(Math.max(0, left));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt, timeLimitMins]);

  return remaining;
}

export default function TakeAssessmentPage() {
  const { assessmentId, attemptId } = useParams<{ assessmentId: string; attemptId: string }>();
  const router = useRouter();

  const { data, isLoading } = trpc.assessment.getAttempt.useQuery({ attemptId });
  const saveResponse = trpc.assessment.saveResponse.useMutation();
  const submit = trpc.assessment.submitAttempt.useMutation({
    onSuccess: () => router.push(`/assessments/${assessmentId}/results/${attemptId}`),
  });

  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { selected?: string[]; text?: string; ordered?: string[] }>>({});
  const [confirming, setConfirming] = useState(false);
  const [focusMode, setFocusMode] = useState(false);

  // Enable focus mode automatically for timed assessments
  useEffect(() => {
    if (data?.attempt.assessment.timeLimit) setFocusMode(true);
  }, [data?.attempt.assessment.timeLimit]);

  // Keyboard navigation in focus mode
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (!focusMode) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      setCurrentIdx((i) => Math.min(i + 1, (data?.questions.length ?? 1) - 1));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      setCurrentIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Escape") {
      setFocusMode(false);
    }
  }, [focusMode, data?.questions.length]);

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  const remaining = useTimer(
    data?.attempt.startedAt ?? new Date(),
    data?.attempt.assessment.timeLimit
  );

  // Auto-submit when time runs out
  useEffect(() => {
    if (remaining === 0) submit.mutate({ attemptId });
  }, [remaining]);

  function formatTime(secs: number) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function handleAnswer(questionId: string, answer: { selected?: string[]; text?: string; ordered?: string[] }) {
    setAnswers((prev) => ({ ...prev, [questionId]: answer }));
    saveResponse.mutate({ attemptId, questionId, answer });
  }

  function toggleOption(questionId: string, optionId: string, multiSelect: boolean) {
    const current = answers[questionId]?.selected ?? [];
    let next: string[];
    if (multiSelect) {
      next = current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId];
    } else {
      next = [optionId];
    }
    handleAnswer(questionId, { selected: next });
  }

  function reorderSequence(questionId: string, fromIndex: number, toIndex: number) {
    const options = current.options as Array<{ id: string; text: string; imageUrl?: string }> | null;
    if (!options?.length) return;

    const currentOrder = answers[questionId]?.ordered ?? options.map((option) => option.id);
    const next = [...currentOrder];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    handleAnswer(questionId, { ordered: next });
  }

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>;
  if (!data) return <p>Attempt not found</p>;

  const questions = data.questions;
  const current = questions[currentIdx];
  const answered = questions.filter((q) => answers[q.id]?.selected?.length || answers[q.id]?.text).length;
  const progress = (answered / questions.length) * 100;

  const focusModeClass = focusMode
    ? "fixed inset-0 z-50 bg-gray-950 overflow-y-auto"
    : "max-w-4xl mx-auto";

  return (
    <div className={focusModeClass}>
      {/* Header */}
      <div className={cn(
        "sticky top-0 z-10 px-0 py-4 mb-6",
        focusMode ? "bg-gray-950 border-b border-white/10 px-6" : "bg-white border-b border-gray-200"
      )}>
        <div className="flex items-center justify-between gap-4 mb-3">
          <div>
            <h1 className={cn("font-semibold", focusMode ? "text-white" : "text-gray-900")}>
              {data.attempt.assessment.title}
            </h1>
            <p className={cn("text-xs", focusMode ? "text-white/40" : "text-gray-500")}>
              {answered}/{questions.length} answered
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary">
              Attempt in progress
            </Badge>
            {remaining !== null && (
              <div className={cn(
                "flex items-center gap-2 font-mono font-semibold text-sm px-3 py-1.5 rounded-full",
                remaining < 300
                  ? "bg-red-500/20 text-red-400"
                  : focusMode ? "bg-white/10 text-white" : "bg-gray-100 text-gray-700"
              )}>
                <Clock className="h-4 w-4" />
                {formatTime(remaining)}
              </div>
            )}
            <button
              onClick={() => setFocusMode((v) => !v)}
              className={cn(
                "p-1.5 rounded-lg transition-colors",
                focusMode ? "text-white/40 hover:text-white hover:bg-white/10" : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
              )}
              title={focusMode ? "Exit focus mode (Esc)" : "Enter focus mode"}
            >
              {focusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <Progress value={progress} />
      </div>

      <div className={cn(
        "grid grid-cols-1 lg:grid-cols-4 gap-6",
        focusMode && "max-w-3xl mx-auto px-6 pb-10"
      )}>
        {/* Question navigator */}
        <div className={cn("lg:col-span-1 order-2 lg:order-1", focusMode && "hidden")}>
          <div className="bg-white border border-gray-200 rounded-xl p-4 sticky top-32">
            <p className="text-xs font-semibold text-gray-500 mb-3">QUESTIONS</p>
            <div className="grid grid-cols-5 lg:grid-cols-4 gap-1.5">
              {questions.map((q, i) => {
                const hasAnswer = !!(answers[q.id]?.selected?.length || answers[q.id]?.text);
                return (
                  <button
                    key={q.id}
                    onClick={() => setCurrentIdx(i)}
                    className={cn(
                      "h-8 w-8 rounded text-xs font-medium transition-colors",
                      i === currentIdx ? "bg-blue-600 text-white" :
                      hasAnswer ? "bg-green-100 text-green-700" :
                      "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    )}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Current question */}
        <div className={cn("order-1 lg:order-2 space-y-4", focusMode ? "col-span-full" : "lg:col-span-3")}>
          <div className={cn("rounded-xl p-6", focusMode ? "bg-gray-900 border border-white/10" : "bg-white border border-gray-200")}>
            <div className="flex items-center gap-2 mb-4">
              <span className={cn("text-sm font-semibold", focusMode ? "text-white/40" : "text-gray-500")}>Q{currentIdx + 1}</span>
              <Badge variant="secondary">{current.type.replace(/_/g, " ")}</Badge>
              <Badge variant="outline">{current.points} pt{current.points !== 1 ? "s" : ""}</Badge>
              {answers[current.id]?.selected?.length || answers[current.id]?.text ? (
                <Badge variant="success">Answered</Badge>
              ) : null}
            </div>

            <p className={cn("font-medium mb-5", focusMode ? "text-white" : "text-gray-900")}>{current.stem}</p>
            {current.imageUrl && (
              <div className="mb-5 overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                <img src={current.imageUrl} alt="Question" className="max-h-72 w-full object-contain" />
              </div>
            )}

            {/* Multiple Choice / True-False */}
            {(current.type === "MULTIPLE_CHOICE" || current.type === "TRUE_FALSE") && current.options && (
              <div className="space-y-2">
                {(current.options as Array<{ id: string; text: string; imageUrl?: string }>).map((opt) => {
                  const selected = answers[current.id]?.selected?.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      onClick={() => toggleOption(current.id, opt.id, false)}
                      className={cn(
                        "w-full text-left flex items-center gap-3 p-4 rounded-lg border-2 transition-all",
                        selected
                          ? "border-blue-600 bg-blue-50"
                          : "border-gray-200 hover:border-gray-300"
                      )}
                    >
                      <div className={cn(
                        "h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0",
                        selected ? "border-blue-600 bg-blue-600" : "border-gray-300"
                      )}>
                        {selected && <div className="h-2 w-2 rounded-full bg-white" />}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm">{opt.text}</div>
                        {opt.imageUrl && (
                          <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-white">
                            <img src={opt.imageUrl} alt={opt.text || "Answer option"} className="max-h-40 w-full object-contain" />
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Multi-select */}
            {current.type === "MULTI_SELECT" && current.options && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 mb-3">Select all that apply</p>
                {(current.options as Array<{ id: string; text: string; imageUrl?: string }>).map((opt) => {
                  const selected = answers[current.id]?.selected?.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      onClick={() => toggleOption(current.id, opt.id, true)}
                      className={cn(
                        "w-full text-left flex items-center gap-3 p-4 rounded-lg border-2 transition-all",
                        selected ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:border-gray-300"
                      )}
                    >
                      <div className={cn(
                        "h-5 w-5 rounded border-2 flex items-center justify-center shrink-0",
                        selected ? "border-blue-600 bg-blue-600" : "border-gray-300"
                      )}>
                        {selected && <Check className="h-3 w-3 text-white" />}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm">{opt.text}</div>
                        {opt.imageUrl && (
                          <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-white">
                            <img src={opt.imageUrl} alt={opt.text || "Answer option"} className="max-h-40 w-full object-contain" />
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Short answer / Essay / Fill-in-blank */}
            {(current.type === "SHORT_ANSWER" || current.type === "ESSAY" || current.type === "FILL_IN_BLANK") && (
              <Textarea
                placeholder={current.type === "ESSAY" ? "Write your answer here..." : "Type your answer..."}
                rows={current.type === "ESSAY" ? 8 : 3}
                value={answers[current.id]?.text ?? ""}
                onChange={(e) => handleAnswer(current.id, { text: e.target.value })}
              />
            )}

            {current.type === "SEQUENCE" && current.options && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500 mb-1">Drag items into the correct order</p>
                {(() => {
                  const optionMap = new Map((current.options as Array<{ id: string; text: string; imageUrl?: string }>).map((option) => [option.id, option]));
                  const orderedIds = answers[current.id]?.ordered ?? (current.options as Array<{ id: string; text: string; imageUrl?: string }>).map((option) => option.id);

                  return orderedIds.map((id, index) => {
                    const option = optionMap.get(id);
                    if (!option) return null;

                    return (
                      <div
                        key={id}
                        draggable
                        onDragStart={(event) => event.dataTransfer.setData("text/plain", String(index))}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          const fromIndex = Number(event.dataTransfer.getData("text/plain"));
                          reorderSequence(current.id, fromIndex, index);
                        }}
                        className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm"
                      >
                        <GripVertical className="h-4 w-4 text-gray-400" />
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
                          {index + 1}
                        </span>
                        <div className="flex-1">
                          <div className="text-sm text-gray-900">{option.text}</div>
                          {option.imageUrl && (
                            <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                              <img src={option.imageUrl} alt={option.text || "Sequence item"} className="max-h-32 w-full object-contain" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))}
              disabled={currentIdx === 0}
            >
              <ChevronLeft className="h-4 w-4" />Previous
            </Button>

            {currentIdx < questions.length - 1 ? (
              <Button onClick={() => setCurrentIdx(currentIdx + 1)}>
                Next<ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                variant={confirming ? "destructive" : "default"}
                onClick={() => {
                  if (!confirming) { setConfirming(true); return; }
                  submit.mutate({ attemptId });
                }}
                disabled={submit.isPending}
              >
                {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Send className="h-4 w-4" />
                {confirming ? "Confirm Submit" : "Submit Assessment"}
              </Button>
            )}
          </div>
          {confirming && (
            <p className="text-xs text-center text-red-600">
              {answered < questions.length && `Warning: ${questions.length - answered} questions unanswered. `}
              Click &quot;Confirm Submit&quot; to finalize.
              <button className="underline ml-1" onClick={() => setConfirming(false)}>Cancel</button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
