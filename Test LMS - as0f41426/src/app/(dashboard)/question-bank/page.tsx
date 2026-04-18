"use client";

import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, Search, Trash2, Edit2, ChevronDown, ChevronUp,
  Loader2, X, Check, BookOpen, ChevronRight, ArrowLeft, ArrowUp, ArrowDown, ImagePlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { QuestionDnaStrip } from "@/components/ui/question-dna-strip";
import { useToast } from "@/components/ui/toast";
import { QuestionEditorForm, type QuestionEditorDraft } from "@/components/question/question-editor-form";
import {
  DIFFICULTY_LEVELS,
  DIFF_COLOR,
  QUESTION_TYPES,
  TYPE_LABEL,
  getQuestionCorrectAnswerText,
  type DifficultyLevel,
  type QuestionOption,
  type QuestionType,
} from "@/lib/question-types";

// ─── Types ────────────────────────────────────────────────────────────────────

type OptionDraft = QuestionOption;
type QuestionDraft = QuestionEditorDraft;

type Course = { id: string; title: string; _count: { enrollments: number } };

// ─── Constants ────────────────────────────────────────────────────────────────


// ─── Question Form ─────────────────────────────────────────────────────────────

function QuestionForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: QuestionDraft;
  onSave: (data: QuestionDraft) => void;
  onCancel: () => void;
  saving?: boolean;
}) {
  return <QuestionEditorForm initial={initial} onSave={onSave} onCancel={onCancel} saving={saving} />;

  const [type, setType] = useState<QuestionType>(initial?.type ?? "MULTIPLE_CHOICE");
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(initial?.difficulty ?? "MEDIUM");
  const [stem, setStem] = useState(initial?.stem ?? "");
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? "");
  const [points, setPoints] = useState(initial?.points ?? 1);
  const [explanation, setExplanation] = useState(initial?.explanation ?? "");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [options, setOptions] = useState<OptionDraft[]>(
    initial?.options ?? [
      { id: "a", text: "", isCorrect: false },
      { id: "b", text: "", isCorrect: false },
      { id: "c", text: "", isCorrect: false },
      { id: "d", text: "", isCorrect: false },
    ],
  );
  const [correctAnswer, setCorrectAnswer] = useState(initial?.correctAnswer ?? "");
  const [sequenceOrder, setSequenceOrder] = useState<string[]>(() => {
    if (!initial?.correctAnswer) return (initial?.options ?? []).map((option) => option.id);
    try {
      const parsed = JSON.parse(initial.correctAnswer);
      return Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : (initial?.options ?? []).map((option) => option.id);
    } catch {
      return (initial?.options ?? []).map((option) => option.id);
    }
  });

  const showOptions = ["MULTIPLE_CHOICE", "MULTI_SELECT", "TRUE_FALSE", "SEQUENCE"].includes(type);
  const showCorrectAnswer = type === "FILL_IN_BLANK";

  function addTag() {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput("");
  }

  function setOptionCorrect(id: string) {
    if (type === "SEQUENCE") return;
    if (type === "MULTI_SELECT") {
      setOptions(options.map((o) => o.id === id ? { ...o, isCorrect: !o.isCorrect } : o));
    } else {
      setOptions(options.map((o) => ({ ...o, isCorrect: o.id === id })));
    }
  }

  function syncSequenceOrder(nextOptions: OptionDraft[]) {
    setSequenceOrder((prev) => {
      const retained = prev.filter((id) => nextOptions.some((option) => option.id === id));
      const missing = nextOptions.map((option) => option.id).filter((id) => !retained.includes(id));
      return [...retained, ...missing];
    });
  }

  function updateOptionImage(id: string, imageUrl: string) {
    const next = options.map((option) => option.id === id ? { ...option, imageUrl } : option);
    setOptions(next);
    syncSequenceOrder(next);
  }

  function handleImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setImageUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  function handleOptionImageChange(id: string, event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        updateOptionImage(id, reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  function moveSequenceOption(id: string, direction: "up" | "down") {
    setSequenceOrder((prev) => {
      const index = prev.indexOf(id);
      if (index < 0) return prev;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      type, difficulty, stem, imageUrl: imageUrl || undefined, points, tags,
      explanation: explanation || undefined,
      options: showOptions ? options : undefined,
      correctAnswer:
        type === "SEQUENCE"
          ? JSON.stringify(sequenceOrder)
          : showCorrectAnswer
            ? correctAnswer
            : undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[#555555] uppercase tracking-wide">Type</label>
          <Select value={type} onValueChange={(v) => setType(v as QuestionType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {QUESTION_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[#555555] uppercase tracking-wide">Difficulty</label>
          <Select value={difficulty} onValueChange={(v) => setDifficulty(v as DifficultyLevel)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DIFFICULTY_LEVELS.map((d) => (
                <SelectItem key={d} value={d}>{d.charAt(0) + d.slice(1).toLowerCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-[#555555] uppercase tracking-wide">Question</label>
        <Textarea
          value={stem}
          onChange={(e) => setStem(e.target.value)}
          placeholder="Write your question here…"
          required
          rows={3}
          className="resize-none"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-[#555555] uppercase tracking-wide">Image</label>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:border-gray-300 hover:text-gray-900">
            <ImagePlus className="h-4 w-4" />
            Upload image
            <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
          </label>
          <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="Or paste an image URL" />
          {imageUrl && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setImageUrl("")}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        {imageUrl && (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
            <img src={imageUrl} alt="Question preview" className="max-h-56 w-full object-contain" />
          </div>
        )}
      </div>

      {showOptions && (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[#555555] uppercase tracking-wide">
            Answer Options — {type === "MULTI_SELECT" ? "select all correct" : "select one correct"}
          </label>
          {(type === "TRUE_FALSE"
            ? [{ id: "true", text: "True", isCorrect: options.find((o) => o.id === "true")?.isCorrect ?? false },
               { id: "false", text: "False", isCorrect: options.find((o) => o.id === "false")?.isCorrect ?? false }]
            : options
          ).map((opt) => (
            <div key={opt.id} className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setOptionCorrect(opt.id)}
                className={cn(
                  "h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                  opt.isCorrect ? "bg-[var(--c-accent)] border-[var(--c-accent)] text-[var(--c-accent-fg)]" : "border-[#e8e8e8] hover:border-[#aaa]",
                )}
              >
                {opt.isCorrect && <Check className="h-3 w-3" />}
              </button>
              {type === "TRUE_FALSE" ? (
                <span className="text-sm text-[#111111]">{opt.text}</span>
              ) : (
                <div className="flex-1 space-y-2">
                  <Input
                    value={opt.text}
                    onChange={(e) => {
                      const next = options.map((o) => o.id === opt.id ? { ...o, text: e.target.value } : o);
                      setOptions(next);
                      syncSequenceOrder(next);
                    }}
                    placeholder={type === "SEQUENCE" ? "Sequence step" : `Option ${opt.id.toUpperCase()}`}
                    required
                    className="h-8 text-sm"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:border-gray-300 hover:text-gray-900">
                      <ImagePlus className="h-3.5 w-3.5" />
                      Option image
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => handleOptionImageChange(opt.id, e)} />
                    </label>
                    <Input
                      value={opt.imageUrl ?? ""}
                      onChange={(e) => updateOptionImage(opt.id, e.target.value)}
                      placeholder="Optional image URL"
                      className="h-8 text-sm"
                    />
                    {opt.imageUrl && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => updateOptionImage(opt.id, "")}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  {opt.imageUrl && (
                    <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                      <img src={opt.imageUrl} alt={opt.text || "Option image"} className="max-h-28 w-full object-contain" />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {type !== "TRUE_FALSE" && (
            <button
              type="button"
              onClick={() => {
                const next = [...options, { id: String.fromCharCode(97 + options.length), text: "", isCorrect: false }];
                setOptions(next);
                syncSequenceOrder(next);
              }}
              className="text-xs text-[#888888] hover:text-[#111111] flex items-center gap-1 mt-1"
            >
              <Plus className="h-3 w-3" /> Add option
            </button>
          )}
        </div>
      )}

      {type === "SEQUENCE" && sequenceOrder.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[#555555] uppercase tracking-wide">Correct Order</label>
          <div className="space-y-2">
            {sequenceOrder.map((id, index) => {
              const option = options.find((entry) => entry.id === id);
              if (!option) return null;
              return (
                <div key={id} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <Badge variant="secondary" className="text-xs">{index + 1}</Badge>
                  <span className="flex-1 text-sm text-gray-800">{option.text || "Untitled step"}</span>
                  <button type="button" onClick={() => moveSequenceOption(id, "up")} className="rounded-md p-1 text-gray-400 hover:bg-white hover:text-gray-700">
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => moveSequenceOption(id, "down")} className="rounded-md p-1 text-gray-400 hover:bg-white hover:text-gray-700">
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showCorrectAnswer && (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[#555555] uppercase tracking-wide">Correct Answer</label>
          <Input value={correctAnswer} onChange={(e) => setCorrectAnswer(e.target.value)} placeholder="Exact answer…" required />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[#555555] uppercase tracking-wide">Points</label>
          <Input type="number" min="0.5" step="0.5" value={points} onChange={(e) => setPoints(Number(e.target.value))} className="h-8" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[#555555] uppercase tracking-wide">Tags</label>
          <div className="flex gap-2">
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="Add tag…"
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
              className="h-8 text-sm"
            />
            <Button type="button" variant="outline" size="sm" onClick={addTag}>Add</Button>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {tags.map((t) => (
                <Badge key={t} variant="secondary" className="gap-1 text-xs">
                  {t}
                  <button type="button" onClick={() => setTags(tags.filter((x) => x !== t))}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-[#555555] uppercase tracking-wide">Explanation <span className="normal-case font-normal">(optional — shown after submission)</span></label>
        <Textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="Explain why the answer is correct…" rows={2} className="resize-none" />
      </div>

      <div className="flex gap-2 justify-end pt-1 border-t border-[#f4f4f4]">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save Question
        </Button>
      </div>
    </form>
  );
}

// ─── Course Assignment Step ────────────────────────────────────────────────────

function CourseAssignStep({
  courses,
  selectedCourseId,
  onSelect,
  onSkip,
  onBack,
  saving,
}: {
  courses: Course[];
  selectedCourseId: string | null;
  onSelect: (id: string | null) => void;
  onSkip: () => void;
  onBack: () => void;
  saving?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-black text-sm tracking-tight text-[#111111]">Assign to a Course</h3>
        <p className="text-xs text-[#888888] mt-0.5">Optional — questions without a course go into the shared bank.</p>
      </div>

      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {courses.map((c) => {
          const active = selectedCourseId === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(active ? null : c.id)}
              className={cn(
                "w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all",
                active
                  ? "border-[var(--c-accent)] bg-[var(--c-accent)]/5"
                  : "border-[#e8e8e8] hover:border-[#ccc]",
              )}
            >
              <div
                className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 text-white font-black text-xs"
                style={{ background: "var(--c-dark)" }}
              >
                {c.title[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#111111] truncate">{c.title}</p>
                <p className="text-xs text-[#888888]">{c._count.enrollments} enrolled</p>
              </div>
              {active && <Check className="h-4 w-4 shrink-0" style={{ color: "var(--c-accent)" }} />}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-[#f4f4f4]">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-[#888888] hover:text-[#111111]">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onSkip} disabled={saving}>
            Skip — Bank Only
          </Button>
          <Button size="sm" onClick={() => onSkip()} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {selectedCourseId ? "Save & Assign" : "Save to Bank"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Slide-over Drawer ────────────────────────────────────────────────────────

function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e8e8e8]">
          <h2 className="font-black text-lg tracking-tight text-[#111111]">{title}</h2>
          <button onClick={onClose} className="text-[#888888] hover:text-[#111111] transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </>
  );
}

// ─── Sidebar filter group ─────────────────────────────────────────────────────

function FilterGroup({
  label,
  children,
  defaultOpen = true,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[#f4f4f4] pb-3 mb-3 last:border-0 last:mb-0 last:pb-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full text-xs font-semibold text-[#888888] uppercase tracking-wide mb-2"
      >
        {label}
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && <div className="space-y-1">{children}</div>}
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm transition-colors text-left",
        active
          ? "bg-[var(--c-dark)] text-white font-semibold"
          : "text-[#333333] hover:bg-[#f4f4f4]",
      )}
    >
      <span className="truncate">{label}</span>
      <span className={cn("text-xs ml-2 shrink-0", active ? "text-white/60" : "text-[#aaa]")}>{count}</span>
    </button>
  );
}

// ─── Question Card ─────────────────────────────────────────────────────────────

function QuestionCard({
  q,
  onEdit,
  onDelete,
  selectable,
  selected,
  onToggleSelect,
  perf,
}: {
  q: {
    id: string;
    type: QuestionType;
    difficulty: DifficultyLevel;
    stem: string;
    imageUrl?: string | null;
    points: number;
    tags: string[];
    explanation: string | null;
    options: unknown;
    correctAnswer: string | null;
    author: { name: string | null };
  };
  onEdit: () => void;
  onDelete: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  perf?: { total: number; avgScore: number | null };
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-[#e8e8e8] rounded-xl overflow-hidden hover:border-[#ccc] transition-colors bg-white">
      <div className="flex items-start gap-3 p-4">
        {selectable && onToggleSelect && (
          <label className="mt-0.5 flex items-center">
            <input
              type="checkbox"
              checked={Boolean(selected)}
              onChange={onToggleSelect}
              className="h-4 w-4 rounded border-gray-300 text-[var(--c-dark)] focus:ring-[var(--c-dark)]"
            />
          </label>
        )}
        <button type="button" className="flex flex-1 items-start gap-3 text-left" onClick={onEdit}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <Badge variant="secondary" className="text-xs">{TYPE_LABEL[q.type]}</Badge>
              <Badge variant={DIFF_COLOR[q.difficulty]} className="text-xs">{q.difficulty}</Badge>
              <span className="text-xs text-[#aaa]">{q.points} pt{q.points !== 1 ? "s" : ""}</span>
              {perf && perf.total > 0 && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{
                    background: perf.avgScore === null ? "#f4f4f4"
                      : perf.avgScore >= 70 ? "rgba(34,197,94,0.12)"
                      : perf.avgScore >= 40 ? "rgba(234,179,8,0.12)"
                      : "rgba(239,68,68,0.12)",
                    color: perf.avgScore === null ? "#999"
                      : perf.avgScore >= 70 ? "#15803d"
                      : perf.avgScore >= 40 ? "#a16207"
                      : "#b91c1c",
                  }}
                  title={`${perf.total} response${perf.total !== 1 ? "s" : ""}`}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      background: perf.avgScore === null ? "#ccc"
                        : perf.avgScore >= 70 ? "#22c55e"
                        : perf.avgScore >= 40 ? "#eab308"
                        : "#ef4444",
                    }}
                  />
                  {perf.avgScore !== null ? `${perf.avgScore}%` : "—"}
                </span>
              )}
            </div>
            <p className="text-sm text-[#111111] leading-snug line-clamp-2">{q.stem}</p>
            {q.imageUrl && (
              <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                <img src={q.imageUrl} alt="Question" className="max-h-40 w-full object-contain" />
              </div>
            )}
            {getQuestionCorrectAnswerText({
              type: q.type,
              options: Array.isArray(q.options) ? (q.options as OptionDraft[]) : null,
              correctAnswer: q.correctAnswer,
            }) && (
              <p className="mt-2 text-xs font-medium text-green-700">
                Correct answer: {getQuestionCorrectAnswerText({
                  type: q.type,
                  options: Array.isArray(q.options) ? (q.options as OptionDraft[]) : null,
                  correctAnswer: q.correctAnswer,
                })}
              </p>
            )}
            {q.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {q.tags.map((t) => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 bg-[#f4f4f4] text-[#666] rounded-md">{t}</span>
                ))}
              </div>
            )}
          </div>
        </button>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 rounded-md text-[#aaa] hover:text-[#111111] hover:bg-[#f4f4f4] transition-colors"
            title="Preview"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="p-1.5 rounded-md text-[#aaa] hover:text-[#111111] hover:bg-[#f4f4f4] transition-colors"
            title="Edit"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1.5 rounded-md text-[#aaa] hover:text-red-500 hover:bg-red-50 transition-colors"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-[#f4f4f4] space-y-2 bg-[#fafafa]">
          {q.options && Array.isArray(q.options) && (
            <div className="space-y-1 pt-3">
              {(q.options as OptionDraft[]).map((o) => (
                <div key={o.id} className={cn("flex items-center gap-2 text-sm", o.isCorrect ? "text-green-700 font-medium" : "text-[#555555]")}>
                  {o.isCorrect
                    ? <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />
                    : <div className="h-3.5 w-3.5 shrink-0 rounded-full border border-[#ddd]" />}
                  <div className="flex-1">
                    <div>{o.text}</div>
                    {o.imageUrl && (
                      <div className="mt-2 overflow-hidden rounded-lg border border-gray-200 bg-white">
                        <img src={o.imageUrl} alt={o.text || "Option image"} className="max-h-28 w-full object-contain" />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {getQuestionCorrectAnswerText({
            type: q.type,
            options: Array.isArray(q.options) ? (q.options as OptionDraft[]) : null,
            correctAnswer: q.correctAnswer,
          }) && (
            <p className="text-sm text-green-700 pt-2">
              <span className="font-semibold">Answer:</span>{" "}
              {getQuestionCorrectAnswerText({
                type: q.type,
                options: Array.isArray(q.options) ? (q.options as OptionDraft[]) : null,
                correctAnswer: q.correctAnswer,
              })}
            </p>
          )}
          {q.explanation && (
            <p className="text-xs text-[#888888] italic border-l-2 border-[#e8e8e8] pl-3 pt-1">{q.explanation}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function QuestionBankPage() {
  // Course tab
  const [activeCourseId, setActiveCourseId] = useState<string | null>(null);

  // Sidebar filters
  const [typeFilters, setTypeFilters] = useState<Set<QuestionType>>(new Set());
  const [diffFilters, setDiffFilters] = useState<Set<DifficultyLevel>>(new Set());
  const [tagFilters, setTagFilters] = useState<Set<string>>(new Set());

  // Search
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drawer state
  type DrawerMode = "create-step1" | "create-step2" | "edit";
  const [drawerMode, setDrawerMode] = useState<DrawerMode | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftQuestion, setDraftQuestion] = useState<QuestionDraft | null>(null);
  const [assignCourseId, setAssignCourseId] = useState<string | null>(null);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(new Set());

  const { toast } = useToast();
  const utils = trpc.useUtils();

  function invalidate() {
    utils.question.list.invalidate();
    utils.question.facets.invalidate();
  }

  // Data
  const { data: coursesData } = trpc.course.list.useQuery({ limit: 50 });
  const courses = (coursesData?.courses ?? []) as Course[];

  const { data: facets } = trpc.question.facets.useQuery({ courseId: activeCourseId ?? undefined });

  const { data, isLoading } = trpc.question.list.useQuery({
    courseId: activeCourseId ?? undefined,
    type: typeFilters.size === 1 ? [...typeFilters][0] : undefined,
    difficulty: diffFilters.size === 1 ? [...diffFilters][0] : undefined,
    search: debouncedSearch || undefined,
  });

  const questionIds = (data?.questions ?? []).map((q) => q.id);
  const { data: perfData } = trpc.question.performance.useQuery(
    { questionIds },
    { enabled: questionIds.length > 0 }
  );

  // Filter questions client-side for multi-select facets
  const questions = (data?.questions ?? []).filter((q) => {
    if (typeFilters.size > 0 && !typeFilters.has(q.type)) return false;
    if (diffFilters.size > 0 && !diffFilters.has(q.difficulty)) return false;
    if (tagFilters.size > 0 && ![...tagFilters].some((t) => q.tags.includes(t))) return false;
    return true;
  });

  // Mutations
  const create = trpc.question.create.useMutation({
    onSuccess: () => {
      toast({ title: "Question created", variant: "success" });
      setDrawerMode(null);
      setDraftQuestion(null);
      setAssignCourseId(null);
      invalidate();
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "error" }),
  });

  const update = trpc.question.update.useMutation({
    onSuccess: () => {
      toast({ title: "Question updated", variant: "success" });
      setDrawerMode(null);
      setEditingId(null);
      invalidate();
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "error" }),
  });

  const del = trpc.question.delete.useMutation({
    onSuccess: () => { toast({ title: "Deleted", variant: "success" }); invalidate(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "error" }),
  });
  const deleteMany = trpc.question.deleteMany.useMutation({
    onSuccess: (result) => {
      toast({ title: `Deleted ${result.count} questions`, variant: "success" });
      setSelectedQuestionIds(new Set());
      invalidate();
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "error" }),
  });

  const editingQuestion = editingId ? data?.questions.find((q) => q.id === editingId) : null;

  function handleSearchChange(val: string) {
    setSearch(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(val), 300);
  }

  function toggleFilter<T>(set: Set<T>, val: T, setter: (s: Set<T>) => void) {
    const next = new Set(set);
    next.has(val) ? next.delete(val) : next.add(val);
    setter(next);
  }

  function clearFilters() {
    setTypeFilters(new Set());
    setDiffFilters(new Set());
    setTagFilters(new Set());
    setSearch("");
    setDebouncedSearch("");
  }

  function toggleQuestionSelection(questionId: string) {
    setSelectedQuestionIds((current) => {
      const next = new Set(current);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    const visibleIds = questions.map((question) => question.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedQuestionIds.has(id));

    setSelectedQuestionIds((current) => {
      const next = new Set(current);
      if (allSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function handleBulkDelete() {
    if (selectedQuestionIds.size === 0) return;
    deleteMany.mutate({ questionIds: [...selectedQuestionIds] });
  }

  const hasFilters = typeFilters.size > 0 || diffFilters.size > 0 || tagFilters.size > 0 || debouncedSearch;

  const tagEntries = Object.entries(facets?.tagCounts ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col h-full space-y-0 -mt-2">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 pb-5 pt-2">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-[#111111]">Question Bank</h1>
          <p className="text-[#888888] mt-0.5 text-sm">{facets?.total ?? 0} questions{activeCourseId ? " in this course" : " total"}</p>
        </div>
        <Button onClick={() => { setDrawerMode("create-step1"); setDraftQuestion(null); setAssignCourseId(activeCourseId); }}>
          <Plus className="h-3.5 w-3.5" />New Question
        </Button>
      </div>

      {/* ── Course Tab Rail ── */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-[#e8e8e8] mb-5 no-scrollbar">
        <button
          onClick={() => setActiveCourseId(null)}
          className={cn(
            "shrink-0 px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors border-b-2 -mb-px",
            activeCourseId === null
              ? "border-[var(--c-dark)] text-[#111111]"
              : "border-transparent text-[#888888] hover:text-[#111111]",
          )}
        >
          All Questions
        </button>
        {courses.map((c) => (
          <button
            key={c.id}
            onClick={() => { setActiveCourseId(c.id); clearFilters(); }}
            className={cn(
              "shrink-0 px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors border-b-2 -mb-px flex items-center gap-1.5 max-w-[180px]",
              activeCourseId === c.id
                ? "border-[var(--c-dark)] text-[#111111]"
                : "border-transparent text-[#888888] hover:text-[#111111]",
            )}
          >
            <span className="truncate">{c.title}</span>
            {facets && activeCourseId === c.id && (
              <span className="text-[10px] bg-[#f4f4f4] text-[#888888] px-1.5 py-0.5 rounded-full shrink-0">{facets.total}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── DNA Strip ── */}
      {questions.length > 0 && (
        <div className="bg-[#fafafa] border border-[#e8e8e8] rounded-xl p-4 mb-5">
          <p className="text-[10px] font-semibold text-[#aaa] uppercase tracking-widest mb-3">
            Composition — {questions.length} question{questions.length !== 1 ? "s" : ""}
          </p>
          <QuestionDnaStrip questions={questions} />
        </div>
      )}

      {/* ── Two-panel body ── */}
      <div className="flex gap-6 flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-52 shrink-0 space-y-0">
          <div className="sticky top-0">
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="w-full flex items-center justify-between text-xs text-[#888888] hover:text-[#111111] mb-3 px-1"
              >
                Clear filters <X className="h-3 w-3" />
              </button>
            )}

            <FilterGroup label="Type">
              {QUESTION_TYPES.map((t) => (
                <FilterChip
                  key={t}
                  label={TYPE_LABEL[t]}
                  count={facets?.typeCounts[t] ?? 0}
                  active={typeFilters.has(t)}
                  onClick={() => toggleFilter(typeFilters, t, setTypeFilters)}
                />
              ))}
            </FilterGroup>

            <FilterGroup label="Difficulty">
              {DIFFICULTY_LEVELS.map((d) => (
                <FilterChip
                  key={d}
                  label={d.charAt(0) + d.slice(1).toLowerCase()}
                  count={facets?.diffCounts[d] ?? 0}
                  active={diffFilters.has(d)}
                  onClick={() => toggleFilter(diffFilters, d, setDiffFilters)}
                />
              ))}
            </FilterGroup>

            {tagEntries.length > 0 && (
              <FilterGroup label="Tags" defaultOpen={false}>
                {tagEntries.map(([tag, count]) => (
                  <FilterChip
                    key={tag}
                    label={tag}
                    count={count}
                    active={tagFilters.has(tag)}
                    onClick={() => toggleFilter(tagFilters, tag, setTagFilters)}
                  />
                ))}
              </FilterGroup>
            )}
          </div>
        </aside>

        {/* Question list */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* Search + sort toolbar */}
          <div className="flex items-center gap-3 sticky top-0 bg-white pb-1 z-10">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#aaa]" />
              <Input
                placeholder="Search questions…"
                className="pl-9"
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
              />
            </div>
            {questions.length > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={toggleSelectAllVisible}>
                {questions.every((question) => selectedQuestionIds.has(question.id)) ? "Clear visible" : "Select visible"}
              </Button>
            )}
            {selectedQuestionIds.size > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={handleBulkDelete}
                disabled={deleteMany.isPending}
              >
                {deleteMany.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Delete Selected ({selectedQuestionIds.size})
              </Button>
            )}
          </div>

          {isLoading && (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-[#111111]" />
            </div>
          )}

          {!isLoading && questions.length === 0 && (
            <div className="text-center py-16">
              <BookOpen className="h-10 w-10 mx-auto mb-3 text-[#e8e8e8]" />
              <p className="text-[#888888] text-sm mb-4">
                {hasFilters ? "No questions match your filters." : "No questions yet for this scope."}
              </p>
              {!hasFilters && (
                <Button size="sm" onClick={() => { setDrawerMode("create-step1"); setAssignCourseId(activeCourseId); }}>
                  <Plus className="h-3.5 w-3.5" /> Add First Question
                </Button>
              )}
              {hasFilters && (
                <Button size="sm" variant="outline" onClick={clearFilters}>Clear Filters</Button>
              )}
            </div>
          )}

          {questions.map((q) => (
            <QuestionCard
              key={q.id}
              q={q}
              onEdit={() => { setEditingId(q.id); setDrawerMode("edit"); }}
              onDelete={() => del.mutate({ questionId: q.id })}
              selectable
              selected={selectedQuestionIds.has(q.id)}
              onToggleSelect={() => toggleQuestionSelection(q.id)}
              perf={perfData?.[q.id]}
            />
          ))}
        </div>
      </div>

      {/* ── Drawer ── */}
      {drawerMode && (
        <Drawer
          title={drawerMode === "edit" ? "Edit Question" : drawerMode === "create-step1" ? "New Question" : "Assign to Course"}
          onClose={() => { setDrawerMode(null); setEditingId(null); setDraftQuestion(null); }}
        >
          {drawerMode === "create-step1" && (
            <QuestionEditorForm
              onSave={(draft) => {
                setDraftQuestion(draft);
                setDrawerMode("create-step2");
              }}
              onCancel={() => { setDrawerMode(null); setDraftQuestion(null); }}
            />
          )}

          {drawerMode === "create-step2" && draftQuestion && (
            <CourseAssignStep
              courses={courses}
              selectedCourseId={assignCourseId}
              onSelect={setAssignCourseId}
              onSkip={() => {
                create.mutate({ ...draftQuestion, courseId: assignCourseId ?? undefined });
              }}
              onBack={() => setDrawerMode("create-step1")}
              saving={create.isPending}
            />
          )}

          {drawerMode === "edit" && editingQuestion && (
            <QuestionEditorForm
              initial={{
                type: editingQuestion.type,
                difficulty: editingQuestion.difficulty,
                stem: editingQuestion.stem,
                imageUrl: editingQuestion.imageUrl ?? undefined,
                points: editingQuestion.points,
                tags: editingQuestion.tags,
                explanation: editingQuestion.explanation ?? undefined,
                options: (editingQuestion.options as OptionDraft[] | null) ?? undefined,
                correctAnswer: editingQuestion.correctAnswer ?? undefined,
              }}
              onSave={(data) => update.mutate({ questionId: editingQuestion.id, ...data })}
              onCancel={() => { setDrawerMode(null); setEditingId(null); }}
              saving={update.isPending}
            />
          )}
        </Drawer>
      )}
    </div>
  );
}
