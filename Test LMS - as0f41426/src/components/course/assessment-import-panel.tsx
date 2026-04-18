"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, Pencil, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  IMPORT_ASSESSMENT_TYPES,
  IMPORT_DIFFICULTY_LEVELS,
  IMPORT_QUESTION_TYPES,
  type ImportedAssessmentDraft,
} from "@/lib/assessment-import";

type AssessmentImportPanelProps = {
  onImport: (assessments: ImportedAssessmentDraft[]) => void;
};

function cloneAssessments(assessments: ImportedAssessmentDraft[]) {
  return assessments.map((assessment) => ({
    ...assessment,
    questions: assessment.questions.map((question) => ({
      ...question,
      tags: [...question.tags],
      options: question.options?.map((option) => ({ ...option })),
    })),
  }));
}

export function AssessmentImportPanel({ onImport }: AssessmentImportPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<{ fileName: string; count: number } | null>(null);
  const [drafts, setDrafts] = useState<ImportedAssessmentDraft[]>([]);
  const [activeAssessmentIndex, setActiveAssessmentIndex] = useState(0);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [isQuestionEditorOpen, setIsQuestionEditorOpen] = useState(false);

  async function handleFile(file: File) {
    setIsUploading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/assessment-import", {
        method: "POST",
        body: formData,
      });

      const raw = await response.text();
      let payload: {
        error?: string;
        fileName?: string;
        importedCount?: number;
        assessments?: ImportedAssessmentDraft[];
      } = {};

      try {
        payload = JSON.parse(raw) as typeof payload;
      } catch {
        throw new Error(response.ok ? "The server returned an unexpected response." : "The server returned an unexpected error page.");
      }

      if (!response.ok || !payload.assessments) {
        throw new Error(payload.error || "Import failed");
      }

      const nextDrafts = cloneAssessments(payload.assessments);
      setDrafts(nextDrafts);
      setActiveAssessmentIndex(0);
      setActiveQuestionIndex(0);
      setSummary({
        fileName: payload.fileName ?? file.name,
        count: payload.importedCount ?? payload.assessments.length,
      });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Import failed");
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const activeAssessment = drafts[activeAssessmentIndex];
  const activeQuestion = activeAssessment?.questions[activeQuestionIndex];

  function updateAssessment(index: number, patch: Partial<ImportedAssessmentDraft>) {
    setDrafts((current) =>
      current.map((assessment, assessmentIndex) =>
        assessmentIndex === index ? { ...assessment, ...patch } : assessment
      )
    );
  }

  function updateQuestion(
    assessmentIndex: number,
    questionIndex: number,
    patch: Partial<ImportedAssessmentDraft["questions"][number]>,
  ) {
    setDrafts((current) =>
      current.map((assessment, currentAssessmentIndex) =>
        currentAssessmentIndex !== assessmentIndex
          ? assessment
          : {
              ...assessment,
              questions: assessment.questions.map((question, currentQuestionIndex) =>
                currentQuestionIndex === questionIndex ? { ...question, ...patch } : question
              ),
            }
      )
    );
  }

  function removeQuestion(assessmentIndex: number, questionIndex: number) {
    setDrafts((current) =>
      current
        .map((assessment, currentAssessmentIndex) =>
          currentAssessmentIndex !== assessmentIndex
            ? assessment
            : {
                ...assessment,
                questions: assessment.questions.filter((_, currentQuestionIndex) => currentQuestionIndex !== questionIndex),
              }
        )
        .filter((assessment) => assessment.questions.length > 0)
    );
    setActiveQuestionIndex(0);
    setIsQuestionEditorOpen(false);
  }

  function removeAssessment(assessmentIndex: number) {
    setDrafts((current) => current.filter((_, currentAssessmentIndex) => currentAssessmentIndex !== assessmentIndex));
    setActiveAssessmentIndex(0);
    setActiveQuestionIndex(0);
    setIsQuestionEditorOpen(false);
  }

  return (
    <Card className="border-dashed border-blue-200 bg-blue-50/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4 text-blue-700" />
          Import Assessments
        </CardTitle>
      </CardHeader>
      <CardContent
        className="space-y-4"
        onKeyDownCapture={(event) => {
          if (
            event.key === "Enter" &&
            event.target instanceof HTMLElement &&
            event.target.tagName !== "TEXTAREA" &&
            event.target.tagName !== "BUTTON"
          ) {
            event.preventDefault();
          }
        }}
      >
        <p className="text-sm text-gray-600">
          Upload an Excel sheet, CSV, text file, or PDF. We&apos;ll build editable draft assessments first so you can preview and fix them before they enter the course.
        </p>

        <div className="flex flex-wrap gap-2 text-xs text-gray-500">
          <Badge variant="outline">.xlsx</Badge>
          <Badge variant="outline">.xls</Badge>
          <Badge variant="outline">.csv</Badge>
          <Badge variant="outline">.pdf</Badge>
          <Badge variant="outline">.txt</Badge>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.pdf,.txt"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />

        <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={isUploading}>
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {isUploading ? "Importing..." : drafts.length ? "Replace Preview File" : "Choose File"}
        </Button>

        {summary && <p className="text-sm text-green-700">{summary.fileName}: {summary.count} assessment draft(s) ready for review.</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="rounded-lg bg-white p-3 text-xs text-gray-500">
          Spreadsheet columns:
          <span className="ml-1 font-medium text-gray-700">Assessment, Question, Type, Difficulty, Points, Options, Correct Answer, Explanation, Tags</span>
        </div>

        {drafts.length > 0 && (
          <div className="space-y-4 rounded-xl border border-blue-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">Import Preview</p>
                <p className="text-xs text-gray-500">Review how this import will appear in the app, then edit anything before submission.</p>
              </div>
              <Button
                type="button"
                onClick={() => onImport(cloneAssessments(drafts))}
                disabled={!drafts.some((assessment) => assessment.questions.length > 0)}
              >
                Apply Import
              </Button>
            </div>

            <div className="grid gap-4 lg:grid-cols-[240px,1fr]">
              <div className="space-y-2">
                {drafts.map((assessment, assessmentIndex) => (
                  <div
                    key={`${assessment.title}-${assessmentIndex}`}
                    className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                      assessmentIndex === activeAssessmentIndex
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        className="flex-1 text-left"
                        onClick={() => {
                          setActiveAssessmentIndex(assessmentIndex);
                          setActiveQuestionIndex(0);
                        }}
                      >
                        <p className="text-sm font-medium text-gray-900">{assessment.title || `Assessment ${assessmentIndex + 1}`}</p>
                        <p className="mt-1 text-xs text-gray-500">{assessment.questions.length} question(s)</p>
                      </button>
                      <button
                        type="button"
                        className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeAssessment(assessmentIndex);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {activeAssessment && (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Assessment Title</label>
                      <Input
                        value={activeAssessment.title}
                        onChange={(event) => updateAssessment(activeAssessmentIndex, { title: event.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Type</label>
                      <Select
                        value={activeAssessment.type}
                        onValueChange={(value) => updateAssessment(activeAssessmentIndex, { type: value as ImportedAssessmentDraft["type"] })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {IMPORT_ASSESSMENT_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>{type}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5 md:col-span-1">
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Description</label>
                      <Input
                        value={activeAssessment.description ?? ""}
                        onChange={(event) => updateAssessment(activeAssessmentIndex, { description: event.target.value || undefined })}
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[220px,1fr]">
                    <div className="space-y-2">
                      {activeAssessment.questions.map((question, questionIndex) => (
                        <div
                          key={`${question.stem}-${questionIndex}`}
                          className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                            questionIndex === activeQuestionIndex
                              ? "border-blue-500 bg-blue-50"
                              : "border-gray-200 hover:border-gray-300"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              className="flex-1 text-left"
                              onClick={() => {
                                setActiveQuestionIndex(questionIndex);
                                setIsQuestionEditorOpen(true);
                              }}
                            >
                              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Question {questionIndex + 1}</p>
                              <p className="mt-1 text-sm text-gray-900 line-clamp-2">{question.stem}</p>
                            </button>
                            <button
                              type="button"
                              className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                              onClick={(event) => {
                                event.stopPropagation();
                                removeQuestion(activeAssessmentIndex, questionIndex);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-xl border border-dashed border-gray-200 p-6 text-sm text-gray-500">
                      Click any imported question to review or edit it in the side pane before applying the import.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeQuestion && isQuestionEditorOpen && (
          <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
            <div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <Pencil className="h-4 w-4" />
                  Edit Imported Question
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setIsQuestionEditorOpen(false)}>
                  Close
                </Button>
              </div>

              <div className="space-y-4 p-5">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Question</label>
                  <Textarea
                    rows={4}
                    value={activeQuestion.stem}
                    onChange={(event) =>
                      updateQuestion(activeAssessmentIndex, activeQuestionIndex, { stem: event.target.value })
                    }
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Type</label>
                    <Select
                      value={activeQuestion.type}
                      onValueChange={(value) =>
                        updateQuestion(activeAssessmentIndex, activeQuestionIndex, {
                          type: value as ImportedAssessmentDraft["questions"][number]["type"],
                        })
                      }
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {IMPORT_QUESTION_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>{type}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Difficulty</label>
                    <Select
                      value={activeQuestion.difficulty}
                      onValueChange={(value) =>
                        updateQuestion(activeAssessmentIndex, activeQuestionIndex, {
                          difficulty: value as ImportedAssessmentDraft["questions"][number]["difficulty"],
                        })
                      }
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {IMPORT_DIFFICULTY_LEVELS.map((level) => (
                          <SelectItem key={level} value={level}>{level}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Points</label>
                    <Input
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={activeQuestion.points}
                      onChange={(event) =>
                        updateQuestion(activeAssessmentIndex, activeQuestionIndex, {
                          points: Number(event.target.value) || 1,
                        })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Correct Answer</label>
                  <Input
                    value={activeQuestion.correctAnswer ?? ""}
                    onChange={(event) =>
                      updateQuestion(activeAssessmentIndex, activeQuestionIndex, {
                        correctAnswer: event.target.value || undefined,
                      })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Tags</label>
                  <Input
                    value={activeQuestion.tags.join(", ")}
                    onChange={(event) =>
                      updateQuestion(activeAssessmentIndex, activeQuestionIndex, {
                        tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean),
                      })
                    }
                    placeholder="comma, separated, tags"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Explanation</label>
                  <Textarea
                    rows={3}
                    value={activeQuestion.explanation ?? ""}
                    onChange={(event) =>
                      updateQuestion(activeAssessmentIndex, activeQuestionIndex, {
                        explanation: event.target.value || undefined,
                      })
                    }
                  />
                </div>

                {activeQuestion.options && activeQuestion.options.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Options</label>
                    {activeQuestion.options.map((option, optionIndex) => (
                      <div key={option.id} className="rounded-lg border border-gray-200 p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Input
                            value={option.text}
                            onChange={(event) =>
                              updateQuestion(activeAssessmentIndex, activeQuestionIndex, {
                                options: activeQuestion.options?.map((currentOption, currentOptionIndex) =>
                                  currentOptionIndex === optionIndex
                                    ? { ...currentOption, text: event.target.value }
                                    : currentOption
                                ),
                              })
                            }
                          />
                          <label className="flex items-center gap-2 text-xs text-gray-600">
                            <input
                              type="checkbox"
                              checked={option.isCorrect}
                              onChange={(event) =>
                                updateQuestion(activeAssessmentIndex, activeQuestionIndex, {
                                  options: activeQuestion.options?.map((currentOption, currentOptionIndex) =>
                                    currentOptionIndex === optionIndex
                                      ? { ...currentOption, isCorrect: event.target.checked }
                                      : currentOption
                                  ),
                                })
                              }
                            />
                            Correct
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
