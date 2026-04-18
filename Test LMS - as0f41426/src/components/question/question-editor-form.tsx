"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Loader2, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ImageInput } from "@/components/ui/image-input";
import { cn } from "@/lib/utils";
import {
  DIFFICULTY_LEVELS,
  QUESTION_TYPES,
  TYPE_LABEL,
  type DifficultyLevel,
  type QuestionOption,
  type QuestionType,
} from "@/lib/question-types";

export type QuestionEditorDraft = {
  type: QuestionType;
  difficulty: DifficultyLevel;
  stem: string;
  imageUrl?: string;
  points: number;
  tags: string[];
  explanation?: string;
  options?: QuestionOption[];
  correctAnswer?: string;
};

type Props = {
  initial?: QuestionEditorDraft;
  onSave: (data: QuestionEditorDraft) => void;
  onCancel: () => void;
  saving?: boolean;
};

const DEFAULT_OPTIONS: QuestionOption[] = [
  { id: "a", text: "", isCorrect: false },
  { id: "b", text: "", isCorrect: false },
  { id: "c", text: "", isCorrect: false },
  { id: "d", text: "", isCorrect: false },
];

function parseSequenceAnswer(correctAnswer: string | undefined, options: QuestionOption[]) {
  if (!correctAnswer) return options.map((option) => option.id);

  try {
    const parsed = JSON.parse(correctAnswer);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : options.map((option) => option.id);
  } catch {
    return options.map((option) => option.id);
  }
}

function renderOptionPreview(option: QuestionOption) {
  return (
    <div className="flex-1">
      <div className="text-sm text-[#111111]">{option.text || "Untitled option"}</div>
      {option.imageUrl && (
        <div className="mt-2 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
          <img src={option.imageUrl} alt={option.text || "Option image"} className="max-h-28 w-full object-contain" />
        </div>
      )}
    </div>
  );
}

export function QuestionEditorForm({ initial, onSave, onCancel, saving }: Props) {
  const [type, setType] = useState<QuestionType>(initial?.type ?? "MULTIPLE_CHOICE");
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(initial?.difficulty ?? "MEDIUM");
  const [stem, setStem] = useState(initial?.stem ?? "");
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? "");
  const [points, setPoints] = useState(initial?.points ?? 1);
  const [explanation, setExplanation] = useState(initial?.explanation ?? "");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [options, setOptions] = useState<QuestionOption[]>(
    initial?.options ?? DEFAULT_OPTIONS
  );
  const [correctAnswer, setCorrectAnswer] = useState(initial?.correctAnswer ?? "");
  const [sequenceOrder, setSequenceOrder] = useState<string[]>(() =>
    parseSequenceAnswer(initial?.correctAnswer, initial?.options ?? DEFAULT_OPTIONS)
  );

  const showOptions = ["MULTIPLE_CHOICE", "MULTI_SELECT", "TRUE_FALSE", "SEQUENCE"].includes(type);
  const showCorrectAnswer = type === "FILL_IN_BLANK";
  const sequenceOptions = useMemo(
    () => sequenceOrder
      .map((id) => options.find((option) => option.id === id))
      .filter((option): option is QuestionOption => Boolean(option)),
    [options, sequenceOrder]
  );

  function syncSequenceOrder(nextOptions: QuestionOption[]) {
    setSequenceOrder((prev) => {
      const retained = prev.filter((id) => nextOptions.some((option) => option.id === id));
      const missing = nextOptions.map((option) => option.id).filter((id) => !retained.includes(id));
      return [...retained, ...missing];
    });
  }

  function addTag() {
    const value = tagInput.trim().toLowerCase();
    if (value && !tags.includes(value)) {
      setTags([...tags, value]);
    }
    setTagInput("");
  }

  function setOptionCorrect(id: string) {
    if (type === "MULTI_SELECT") {
      setOptions(options.map((option) => option.id === id ? { ...option, isCorrect: !option.isCorrect } : option));
      return;
    }

    if (type === "SEQUENCE") return;

    setOptions(options.map((option) => ({ ...option, isCorrect: option.id === id })));
  }

  function updateOptionText(id: string, text: string) {
    const next = options.map((option) => option.id === id ? { ...option, text } : option);
    setOptions(next);
    syncSequenceOrder(next);
  }

  function updateOptionImage(id: string, imageUrl: string) {
    const next = options.map((option) => option.id === id ? { ...option, imageUrl } : option);
    setOptions(next);
    syncSequenceOrder(next);
  }

  function removeOption(id: string) {
    const next = options.filter((option) => option.id !== id);
    setOptions(next);
    syncSequenceOrder(next);
  }

  function addOption() {
    const next = [...options, { id: String.fromCharCode(97 + options.length), text: "", imageUrl: "", isCorrect: false }];
    setOptions(next);
    syncSequenceOrder(next);
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

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const normalizedOptions =
      type === "TRUE_FALSE"
        ? [
            { id: "true", text: "True", isCorrect: options.find((option) => option.id === "true")?.isCorrect ?? false },
            { id: "false", text: "False", isCorrect: options.find((option) => option.id === "false")?.isCorrect ?? false },
          ]
        : options;

    onSave({
      type,
      difficulty,
      stem,
      imageUrl: imageUrl || undefined,
      points,
      tags,
      explanation: explanation || undefined,
      options: showOptions ? normalizedOptions : undefined,
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
          <Select value={type} onValueChange={(value) => setType(value as QuestionType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {QUESTION_TYPES.map((questionType) => (
                <SelectItem key={questionType} value={questionType}>{TYPE_LABEL[questionType]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[#555555] uppercase tracking-wide">Difficulty</label>
          <Select value={difficulty} onValueChange={(value) => setDifficulty(value as DifficultyLevel)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DIFFICULTY_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>{level.charAt(0) + level.slice(1).toLowerCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-[#555555] uppercase tracking-wide">Question</label>
        <Textarea
          value={stem}
          onChange={(event) => setStem(event.target.value)}
          placeholder="Write your question here..."
          required
          rows={3}
          className="resize-none"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-[#555555] uppercase tracking-wide">Image</label>
        <ImageInput
          value={imageUrl}
          onChange={setImageUrl}
          placeholder="Paste a question image URL"
          previewAlt="Question preview"
          uploadLabel="Browse image"
        />
      </div>

      {showOptions && (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[#555555] uppercase tracking-wide">
            {type === "SEQUENCE"
              ? "Sequence Items"
              : `Answer Options ${type === "MULTI_SELECT" ? "- select all correct" : "- select one correct"}`}
          </label>
          {(type === "TRUE_FALSE"
            ? [
                { id: "true", text: "True", isCorrect: options.find((option) => option.id === "true")?.isCorrect ?? false },
                { id: "false", text: "False", isCorrect: options.find((option) => option.id === "false")?.isCorrect ?? false },
              ]
            : options
          ).map((option) => (
            <div key={option.id} className="flex items-center gap-2.5">
              {type !== "SEQUENCE" && (
                <button
                  type="button"
                  onClick={() => setOptionCorrect(option.id)}
                  className={cn(
                    "h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                    option.isCorrect
                      ? "bg-[var(--c-accent)] border-[var(--c-accent)] text-[var(--c-accent-fg)]"
                      : "border-[#e8e8e8] hover:border-[#aaa]",
                  )}
                >
                  {option.isCorrect && <Check className="h-3 w-3" />}
                </button>
              )}
              {type === "TRUE_FALSE" ? (
                <span className="text-sm text-[#111111]">{option.text}</span>
              ) : (
                <div className="flex-1 space-y-2">
                  <Input
                    value={option.text}
                    onChange={(event) => updateOptionText(option.id, event.target.value)}
                    placeholder={type === "SEQUENCE" ? "Sequence step" : `Option ${option.id.toUpperCase()}`}
                    required
                    className="h-8 text-sm"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="w-full">
                      <ImageInput
                        value={option.imageUrl ?? ""}
                        onChange={(value) => updateOptionImage(option.id, value)}
                        placeholder="Paste an option image URL"
                        previewAlt={option.text || "Option image"}
                        uploadLabel="Browse option image"
                        compact
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeOption(option.id)}
                      disabled={options.length <= 2}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      <X className="h-4 w-4" />
                      Remove option
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {type !== "TRUE_FALSE" && (
            <button
              type="button"
              onClick={addOption}
              className="text-xs text-[#888888] hover:text-[#111111] flex items-center gap-1 mt-1"
            >
              <Plus className="h-3 w-3" /> Add option
            </button>
          )}
        </div>
      )}

      {type === "SEQUENCE" && sequenceOptions.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[#555555] uppercase tracking-wide">Correct Order</label>
          <div className="space-y-2">
            {sequenceOptions.map((option, index) => (
              <div key={option.id} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <Badge variant="secondary" className="text-xs">{index + 1}</Badge>
                {renderOptionPreview(option)}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveSequenceOption(option.id, "up")}
                    className="rounded-md p-1 text-gray-400 hover:bg-white hover:text-gray-700"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSequenceOption(option.id, "down")}
                    className="rounded-md p-1 text-gray-400 hover:bg-white hover:text-gray-700"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCorrectAnswer && (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[#555555] uppercase tracking-wide">Correct Answer</label>
          <Input value={correctAnswer} onChange={(event) => setCorrectAnswer(event.target.value)} placeholder="Exact answer..." required />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[#555555] uppercase tracking-wide">Points</label>
          <Input type="number" min="0.5" step="0.5" value={points} onChange={(event) => setPoints(Number(event.target.value))} className="h-8" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[#555555] uppercase tracking-wide">Tags</label>
          <div className="flex gap-2">
            <Input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              placeholder="Add tag..."
              onKeyDown={(event) => event.key === "Enter" && (event.preventDefault(), addTag())}
              className="h-8 text-sm"
            />
            <Button type="button" variant="outline" size="sm" onClick={addTag}>Add</Button>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="gap-1 text-xs">
                  {tag}
                  <button type="button" onClick={() => setTags(tags.filter((value) => value !== tag))}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-[#555555] uppercase tracking-wide">
          Explanation <span className="normal-case font-normal">(optional - shown after submission)</span>
        </label>
        <Textarea
          value={explanation}
          onChange={(event) => setExplanation(event.target.value)}
          placeholder="Explain why the answer is correct..."
          rows={2}
          className="resize-none"
        />
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
