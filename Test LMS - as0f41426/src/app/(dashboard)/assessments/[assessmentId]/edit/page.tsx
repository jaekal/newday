"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Check, Library, Plus, Power, Trash2, X } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { QuestionEditorForm } from "@/components/question/question-editor-form";
import {
  DIFFICULTY_LEVELS,
  getQuestionCorrectAnswerText,
  TYPE_LABEL,
  type DifficultyLevel,
  type QuestionOption,
  type QuestionType,
} from "@/lib/question-types";
import { useToast } from "@/components/ui/toast";

function QuestionEditorDrawer({
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
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-xl bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
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

export default function EditAssessmentPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const { data, isLoading } = trpc.assessment.byId.useQuery({ assessmentId });
  const utils = trpc.useUtils();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [timeLimit, setTimeLimit] = useState("");
  const [maxAttempts, setMaxAttempts] = useState("1");
  const [passingScore, setPassingScore] = useState("");
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [shuffleOptions, setShuffleOptions] = useState(true);
  const [showFeedback, setShowFeedback] = useState(true);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [libraryDifficulty, setLibraryDifficulty] = useState<"ALL" | DifficultyLevel>("ALL");
  const [error, setError] = useState("");

  useEffect(() => {
    if (data) {
      setTitle(data.title);
      setDescription(data.description ?? "");
      setTimeLimit(data.timeLimit?.toString() ?? "");
      setMaxAttempts(data.maxAttempts.toString());
      setPassingScore(data.passingScore?.toString() ?? "");
      setShuffleQuestions(data.shuffleQuestions);
      setShuffleOptions(data.shuffleOptions);
      setShowFeedback(data.showFeedback);
    }
  }, [data]);

  const update = trpc.assessment.update.useMutation({
    onSuccess: () => router.push(`/assessments/${assessmentId}`),
    onError: (e) => setError(e.message),
  });

  const removeQuestion = trpc.assessment.removeQuestion.useMutation({
    onSuccess: async () => {
      await utils.assessment.byId.invalidate({ assessmentId });
      toast({ title: "Question moved to library", variant: "success" });
    },
  });
  const addQuestion = trpc.assessment.addQuestion.useMutation({
    onSuccess: async () => {
      await utils.assessment.byId.invalidate({ assessmentId });
      toast({ title: "Question added to assessment", variant: "success" });
    },
    onError: (e) => setError(e.message),
  });
  const setQuestionEnabled = trpc.assessment.setQuestionEnabled.useMutation({
    onSuccess: async () => {
      await utils.assessment.byId.invalidate({ assessmentId });
    },
    onError: (e) => setError(e.message),
  });
  const updateQuestion = trpc.question.update.useMutation({
    onSuccess: async () => {
      await utils.assessment.byId.invalidate({ assessmentId });
      toast({ title: "Question updated", variant: "success" });
      setEditingQuestionId(null);
    },
    onError: (e) => setError(e.message),
  });

  function handleSubmit() {
    setError("");
    update.mutate({
      assessmentId,
      title,
      description: description || undefined,
      timeLimit: timeLimit ? parseInt(timeLimit) : null,
      maxAttempts: parseInt(maxAttempts),
      passingScore: passingScore ? parseFloat(passingScore) : null,
      shuffleQuestions,
      shuffleOptions,
      showFeedback,
    });
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }
  if (!data) return <p className="text-gray-500">Assessment not found</p>;

  const questions = data.assessmentQuestions ?? [];
  const editingQuestion = questions.find((item) => item.question.id === editingQuestionId)?.question;
  const linkedQuestionIds = new Set(questions.map((item) => item.question.id));
  const { data: libraryData, isLoading: loadingLibrary } = trpc.question.list.useQuery(
    {
      courseId: data.course.id,
      difficulty: libraryDifficulty === "ALL" ? undefined : libraryDifficulty,
      limit: 100,
    },
    { enabled: Boolean(data.course.id) }
  );
  const libraryQuestions = (libraryData?.questions ?? []).filter((question) => !linkedQuestionIds.has(question.id));

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/assessments/${assessmentId}`} className="hover:text-gray-700 flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />{data.title}
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-gray-900">Edit Assessment</h1>

      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Basic Info</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Title *</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Description</label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Settings</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Time Limit (min)</label>
                <Input type="number" min="1" value={timeLimit} onChange={(e) => setTimeLimit(e.target.value)} placeholder="No limit" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Max Attempts</label>
                <Input type="number" min="1" value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Passing Score (%)</label>
                <Input type="number" min="0" max="100" value={passingScore} onChange={(e) => setPassingScore(e.target.value)} placeholder="No min" />
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {[
                { label: "Shuffle Questions", value: shuffleQuestions, set: setShuffleQuestions },
                { label: "Shuffle Options", value: shuffleOptions, set: setShuffleOptions },
                { label: "Show Feedback", value: showFeedback, set: setShowFeedback },
              ].map(({ label, value, set }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => set(!value)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors",
                    value
                      ? "border-blue-300 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                  )}
                >
                  <div className={cn(
                    "h-4 w-4 rounded border flex items-center justify-center",
                    value ? "bg-blue-600 border-blue-600" : "border-gray-300"
                  )}>
                    {value && <Check className="h-2.5 w-2.5 text-white" />}
                  </div>
                  {label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Current questions */}
        {questions.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Questions</CardTitle>
                <Badge variant="secondary">{questions.length} question{questions.length !== 1 ? "s" : ""}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {questions.map((aq, i) => (
                <div
                  key={aq.id}
                  className="rounded-lg border border-gray-200 bg-gray-50 transition-colors hover:border-gray-300"
                >
                  {(() => {
                    const correctAnswer = getQuestionCorrectAnswerText({
                      type: aq.question.type as QuestionType,
                      options: Array.isArray(aq.question.options) ? aq.question.options as QuestionOption[] : null,
                      correctAnswer: aq.question.correctAnswer,
                    });

                    return (
                      <div className="flex items-start gap-3 p-3">
                        <button
                          type="button"
                          className="flex flex-1 items-start gap-3 text-left"
                          onClick={() => setEditingQuestionId(aq.question.id)}
                        >
                          <span className="text-sm font-semibold text-gray-400 w-6 shrink-0">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900">{aq.question.stem}</p>
                            {aq.question.imageUrl && (
                              <div className="mt-2 overflow-hidden rounded-lg border border-gray-200 bg-white">
                                <img src={aq.question.imageUrl} alt="Question" className="max-h-36 w-full object-contain" />
                              </div>
                            )}
                            <div className="flex gap-1.5 mt-2 flex-wrap">
                              <Badge variant="secondary" className="text-xs">{TYPE_LABEL[aq.question.type as QuestionType] ?? aq.question.type.replace(/_/g, " ")}</Badge>
                              <Badge variant={aq.isPinned ? "success" : "secondary"} className="text-xs">
                                {aq.isPinned ? "Enabled" : "Disabled"}
                              </Badge>
                              <span className="text-xs text-gray-400">{aq.question.points} pt{aq.question.points !== 1 ? "s" : ""}</span>
                            </div>
                            {correctAnswer && (
                              <p className="mt-2 text-xs font-medium text-green-700">
                                Correct answer: {correctAnswer}
                              </p>
                            )}
                          </div>
                        </button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className={cn(
                            "shrink-0",
                            aq.isPinned
                              ? "text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                              : "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                          )}
                          onClick={() => {
                            setQuestionEnabled.mutate({
                              assessmentId,
                              questionId: aq.question.id,
                              enabled: !aq.isPinned,
                            });
                          }}
                          disabled={setQuestionEnabled.isPending}
                        >
                          <Power className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0"
                          onClick={() => {
                            removeQuestion.mutate({ assessmentId, questionId: aq.question.id });
                          }}
                          disabled={removeQuestion.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })()}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Course Question Library</CardTitle>
                <p className="mt-1 text-sm text-gray-500">
                  Questions not currently tied to this assessment stay in the library and can be reused elsewhere.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={libraryDifficulty === "ALL" ? "default" : "outline"}
                  onClick={() => setLibraryDifficulty("ALL")}
                >
                  All
                </Button>
                {DIFFICULTY_LEVELS.map((level) => (
                  <Button
                    key={level}
                    type="button"
                    size="sm"
                    variant={libraryDifficulty === level ? "default" : "outline"}
                    onClick={() => setLibraryDifficulty(level)}
                  >
                    {level.charAt(0) + level.slice(1).toLowerCase()}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {loadingLibrary ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              </div>
            ) : libraryQuestions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
                No library questions match this difficulty filter.
              </div>
            ) : (
              libraryQuestions.map((question) => (
                <div key={question.id} className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{question.stem}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge variant="secondary" className="text-xs">
                          {TYPE_LABEL[question.type as QuestionType] ?? question.type.replace(/_/g, " ")}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {question.difficulty}
                        </Badge>
                        <span className="text-xs text-gray-400">
                          {question.points} pt{question.points !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => addQuestion.mutate({ assessmentId, questionId: question.id, isPinned: true })}
                      disabled={addQuestion.isPending}
                    >
                      <Plus className="h-4 w-4" />
                      Add
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <Button type="button" onClick={handleSubmit} disabled={update.isPending}>
            {update.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
          <Link href={`/assessments/${assessmentId}`}>
            <Button type="button" variant="outline">Cancel</Button>
          </Link>
        </div>
      </div>

      {editingQuestion && (
        <QuestionEditorDrawer
          title="Edit Question"
          onClose={() => setEditingQuestionId(null)}
        >
          <QuestionEditorForm
            initial={{
              type: editingQuestion.type as QuestionType,
              difficulty: editingQuestion.difficulty as DifficultyLevel,
              stem: editingQuestion.stem,
              imageUrl: editingQuestion.imageUrl ?? undefined,
              points: editingQuestion.points,
              tags: Array.isArray(editingQuestion.tags) ? editingQuestion.tags : [],
              explanation: editingQuestion.explanation ?? undefined,
              options: Array.isArray(editingQuestion.options) ? editingQuestion.options as QuestionOption[] : undefined,
              correctAnswer: editingQuestion.correctAnswer ?? undefined,
            }}
            onSave={(question) => updateQuestion.mutate({ questionId: editingQuestion.id, ...question })}
            onCancel={() => setEditingQuestionId(null)}
            saving={updateQuestion.isPending}
          />
        </QuestionEditorDrawer>
      )}
    </div>
  );
}
