"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Check } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { AssessmentImportPanel } from "@/components/course/assessment-import-panel";
import type { ImportedAssessmentDraft, ImportedQuestionDraft } from "@/lib/assessment-import";

const ASSESSMENT_TYPES = ["QUIZ", "EXAM", "PRACTICE"] as const;
type AssessmentType = (typeof ASSESSMENT_TYPES)[number];
const MIN_IMPORTED_STEM_LENGTH = 5;

function isUsableImportedQuestion(question: ImportedQuestionDraft) {
  return question.stem.trim().length >= MIN_IMPORTED_STEM_LENGTH;
}

export default function NewAssessmentPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<AssessmentType>("QUIZ");
  const [timeLimit, setTimeLimit] = useState("");
  const [maxAttempts, setMaxAttempts] = useState("1");
  const [passingScore, setPassingScore] = useState("70");
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [shuffleOptions, setShuffleOptions] = useState(true);
  const [showFeedback, setShowFeedback] = useState(true);
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>([]);
  const [importedAssessments, setImportedAssessments] = useState<ImportedAssessmentDraft[]>([]);
  const [importedQuestions, setImportedQuestions] = useState<ImportedQuestionDraft[]>([]);
  const [error, setError] = useState("");

  const { data: questionData } = trpc.question.list.useQuery({ courseId, limit: 100 });
  const create = trpc.assessment.create.useMutation();
  const createQuestions = trpc.question.createMany.useMutation();

  function toggleQuestion(id: string) {
    setSelectedQuestions((prev) =>
      prev.includes(id) ? prev.filter((q) => q !== id) : [...prev, id]
    );
  }

  function applyImportedAssessment(assessment: ImportedAssessmentDraft) {
    setTitle(assessment.title);
    setDescription(assessment.description ?? "");
    setType(assessment.type);
    setImportedQuestions(assessment.questions.filter(isUsableImportedQuestion));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    try {
      const createdQuestionIds = [...selectedQuestions];
      const usableImportedQuestions = importedQuestions.filter(isUsableImportedQuestion);

      if (usableImportedQuestions.length) {
        const createdQuestions = await createQuestions.mutateAsync({
          questions: usableImportedQuestions.map((question) => ({
            courseId,
            stem: question.stem,
            type: question.type,
            difficulty: question.difficulty,
            points: question.points,
            explanation: question.explanation,
            tags: question.tags,
            options: question.options,
            correctAnswer: question.correctAnswer,
          })),
        });
        createdQuestionIds.push(...createdQuestions.map((question) => question.id));
      }

      const assessment = await create.mutateAsync({
        courseId,
        title,
        description: description || undefined,
        type,
        timeLimit: timeLimit ? parseInt(timeLimit) : undefined,
        maxAttempts: parseInt(maxAttempts),
        passingScore: passingScore ? parseFloat(passingScore) : undefined,
        shuffleQuestions,
        shuffleOptions,
        showFeedback,
        questionIds: createdQuestionIds.length > 0 ? [...new Set(createdQuestionIds)] : undefined,
      });

      router.push(`/assessments/${assessment.id}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not create assessment");
    }
  }

  const questions = ((questionData?.questions ?? []) as unknown) as Array<{
    id: string;
    stem: string;
    type: string;
    difficulty: string;
    points: number;
  }>;
  const isSubmitting = create.isPending || createQuestions.isPending;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/courses/${courseId}`} className="hover:text-gray-700 flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />Back to Course
        </Link>
      </div>

      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">Create Assessment</h1>
        <p className="text-sm text-gray-600">Start from the bank, or import a spreadsheet or PDF and let us prefill it.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Basic Info</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Title *</label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} placeholder="e.g. Module 1 Quiz" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Description</label>
                  <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Optional instructions for students" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Type</label>
                  <Select value={type} onValueChange={(v) => setType(v as AssessmentType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ASSESSMENT_TYPES.map((assessmentType) => (
                        <SelectItem key={assessmentType} value={assessmentType}>{assessmentType}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Settings</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">Time Limit (minutes)</label>
                    <Input type="number" min="1" value={timeLimit} onChange={(e) => setTimeLimit(e.target.value)} placeholder="No limit" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">Max Attempts</label>
                    <Input type="number" min="1" value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">Passing Score (%)</label>
                    <Input type="number" min="0" max="100" value={passingScore} onChange={(e) => setPassingScore(e.target.value)} placeholder="No minimum" />
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

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Select Questions</CardTitle>
                  {selectedQuestions.length > 0 && <Badge variant="secondary">{selectedQuestions.length} selected</Badge>}
                </div>
              </CardHeader>
              <CardContent>
                {questions.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">
                    No questions in your bank yet.{" "}
                    <Link href="/question-bank" className="text-blue-600 hover:underline">Add questions first.</Link>
                  </p>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {questions.map((q) => {
                      const sel = selectedQuestions.includes(q.id);
                      return (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => toggleQuestion(q.id)}
                          className={cn(
                            "w-full text-left flex items-center gap-3 p-3 rounded-lg border transition-colors",
                            sel ? "border-blue-300 bg-blue-50" : "border-gray-200 hover:bg-gray-50"
                          )}
                        >
                          <div className={cn(
                            "h-5 w-5 rounded border-2 flex items-center justify-center shrink-0",
                            sel ? "border-blue-600 bg-blue-600" : "border-gray-300"
                          )}>
                            {sel && <Check className="h-3 w-3 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{q.stem}</p>
                            <div className="flex gap-1.5 mt-0.5">
                              <Badge variant="secondary" className="text-xs">{q.type.replace(/_/g, " ")}</Badge>
                              <Badge variant="outline" className="text-xs">{q.difficulty}</Badge>
                              <span className="text-xs text-gray-400">{q.points} pt{q.points !== 1 ? "s" : ""}</span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <AssessmentImportPanel
              onImport={(drafts) => {
                setImportedAssessments(drafts);
                if (drafts[0]) applyImportedAssessment(drafts[0]);
              }}
            />

            {importedAssessments.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Imported Drafts</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {importedAssessments.map((assessment) => (
                    <button
                      key={`${assessment.title}-${assessment.questions.length}`}
                      type="button"
                      onClick={() => applyImportedAssessment(assessment)}
                      className="w-full rounded-lg border border-gray-200 p-3 text-left hover:border-blue-300 hover:bg-blue-50"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{assessment.title}</p>
                          <p className="text-xs text-gray-500">{assessment.questions.length} imported question(s)</p>
                        </div>
                        <Badge variant="outline">{assessment.type}</Badge>
                      </div>
                    </button>
                  ))}
                </CardContent>
              </Card>
            )}

            {importedQuestions.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Imported Questions</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm text-gray-600">
                    {importedQuestions.length} question(s) will be created in the course bank automatically when you save this assessment.
                  </p>
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {importedQuestions.map((question, index) => (
                      <div key={`${question.stem}-${index}`} className="rounded-lg border border-gray-200 p-3">
                        <p className="text-sm font-medium text-gray-900">{question.stem}</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          <Badge variant="secondary" className="text-xs">{question.type.replace(/_/g, " ")}</Badge>
                          <Badge variant="outline" className="text-xs">{question.difficulty}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Assessment
          </Button>
          <Link href={`/courses/${courseId}`}>
            <Button type="button" variant="outline">Cancel</Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
