"use client";

import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2, XCircle, MinusCircle, ArrowLeft, Loader2,
  Trophy, Clock, Target, ChevronRight
} from "lucide-react";
import Link from "next/link";
import { cn, formatDate, formatScore } from "@/lib/utils";

export default function AssessmentResultsPage() {
  const { assessmentId, attemptId } = useParams<{ assessmentId: string; attemptId: string }>();
  const { data, isLoading } = trpc.assessment.getResult.useQuery({ attemptId });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }
  if (!data) return <p className="text-gray-500">Result not found</p>;

  const { attempt } = data;
  const assessment = attempt.assessment;
  const passed = attempt.isPassed;
  const pct = attempt.percentScore ?? 0;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/assessments/${assessmentId}`} className="hover:text-gray-700 flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />{assessment.title}
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-gray-900">Results</span>
      </div>

      {/* Score Hero */}
      <Card className={cn(
        "border-2",
        passed === true ? "border-green-200 bg-green-50" :
        passed === false ? "border-red-200 bg-red-50" :
        "border-gray-200 bg-gray-50"
      )}>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className={cn(
              "h-24 w-24 rounded-full flex items-center justify-center shrink-0",
              passed === true ? "bg-green-100" :
              passed === false ? "bg-red-100" :
              "bg-gray-100"
            )}>
              {passed === true ? (
                <Trophy className="h-12 w-12 text-green-600" />
              ) : passed === false ? (
                <XCircle className="h-12 w-12 text-red-500" />
              ) : (
                <Clock className="h-12 w-12 text-gray-500" />
              )}
            </div>
            <div className="flex-1 text-center sm:text-left">
              <p className="text-sm font-medium text-gray-500 mb-1">
                {attempt.status === "SUBMITTED" ? "Pending manual grading" : "Final Score"}
              </p>
              <p className={cn(
                "text-5xl font-bold mb-2",
                passed === true ? "text-green-700" :
                passed === false ? "text-red-600" :
                "text-gray-700"
              )}>
                {Math.round(pct)}%
              </p>
              {attempt.score !== null && attempt.score !== undefined && (
                <p className="text-sm text-gray-500">
                  {formatScore(attempt.score, attempt.responses.reduce((s, r) => s + r.question.points, 0))}
                </p>
              )}
              {passed !== null && (
                <Badge
                  variant={passed ? "success" : "destructive"}
                  className="mt-2"
                >
                  {passed ? "Passed" : "Not Passed"}
                </Badge>
              )}
            </div>
            <div className="text-center text-sm text-gray-500 space-y-1">
              {assessment.passingScore && (
                <div className="flex items-center gap-1.5">
                  <Target className="h-4 w-4" />
                  <span>Pass: {assessment.passingScore}%</span>
                </div>
              )}
              {attempt.submittedAt && (
                <p>{formatDate(attempt.submittedAt)}</p>
              )}
            </div>
          </div>
          <Progress
            value={pct}
            className={cn(
              "mt-4 h-2",
              passed === true ? "[&>div]:bg-green-500" :
              passed === false ? "[&>div]:bg-red-500" : ""
            )}
          />
        </CardContent>
      </Card>

      {/* Per-question breakdown */}
      {attempt.responses.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Question Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {attempt.responses.map((r, i) => {
              const answered = r.answer && (
                (r.answer as { selected?: string[]; text?: string }).selected?.length ||
                (r.answer as { selected?: string[]; text?: string }).text
              );
              const options = r.question.options as Array<{ id: string; text: string }> | null;
              const userSelected = (r.answer as { selected?: string[] })?.selected ?? [];
              const userText = (r.answer as { text?: string })?.text;

              return (
                <div key={r.id} className="border border-gray-200 rounded-xl p-4 space-y-3">
                  {/* Question header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2 flex-1">
                      <span className="text-sm font-semibold text-gray-500 shrink-0">Q{i + 1}</span>
                      <p className="text-sm font-medium text-gray-900">{r.question.stem}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {r.isCorrect === true && (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      )}
                      {r.isCorrect === false && (
                        <XCircle className="h-5 w-5 text-red-500" />
                      )}
                      {r.isCorrect === null && (
                        <MinusCircle className="h-5 w-5 text-gray-400" />
                      )}
                      <span className="text-sm font-semibold text-gray-700">
                        {r.pointsEarned ?? 0}/{r.question.points} pts
                      </span>
                    </div>
                  </div>

                  {/* Options (MC / Multi-select / TF) */}
                  {options && (
                    <div className="space-y-1.5">
                      {options.map((opt) => {
                        const isUserAnswer = userSelected.includes(opt.id);
                        const isCorrectAnswer = (r.question.correctAnswer as string | null)?.includes(opt.id);
                        return (
                          <div
                            key={opt.id}
                            className={cn(
                              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                              isCorrectAnswer ? "bg-green-50 text-green-800 border border-green-200" :
                              isUserAnswer ? "bg-red-50 text-red-800 border border-red-200" :
                              "bg-gray-50 text-gray-700"
                            )}
                          >
                            {isCorrectAnswer ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                            ) : isUserAnswer ? (
                              <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                            ) : (
                              <div className="h-4 w-4 shrink-0" />
                            )}
                            {opt.text}
                            {isUserAnswer && !isCorrectAnswer && (
                              <span className="ml-auto text-xs text-red-500">Your answer</span>
                            )}
                            {isCorrectAnswer && (
                              <span className="ml-auto text-xs text-green-600">Correct</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Text answer */}
                  {userText && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">Your answer:</p>
                      <p className="text-sm text-gray-800">{userText}</p>
                    </div>
                  )}

                  {!answered && (
                    <p className="text-xs text-gray-400 italic">Not answered</p>
                  )}

                  {/* Feedback from grader */}
                  {r.feedback && (
                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                      <p className="text-xs font-medium text-blue-700 mb-1">Instructor Feedback</p>
                      <p className="text-sm text-blue-800">{r.feedback}</p>
                    </div>
                  )}

                  {/* Explanation */}
                  {r.question.explanation && (
                    <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                      <p className="text-xs font-medium text-amber-700 mb-1">Explanation</p>
                      <p className="text-sm text-amber-800">{r.question.explanation}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-center pb-6">
        <div className="flex gap-3">
          <Link href={`/assessments/${assessmentId}`}>
            <Button variant="outline">Back to Assessment</Button>
          </Link>
          <Link href={`/courses/${assessment.courseId}`}>
            <Button>Return to Course</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
