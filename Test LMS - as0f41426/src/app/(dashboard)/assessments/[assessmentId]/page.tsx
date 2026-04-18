"use client";

import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, Target, RotateCcw, ArrowLeft, Loader2, ChevronRight, Play } from "lucide-react";
import Link from "next/link";
import { formatDate, formatDuration, formatScore } from "@/lib/utils";

export default function AssessmentPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? "STUDENT";
  const router = useRouter();

  const { data, isLoading } = trpc.assessment.byId.useQuery({ assessmentId });
  const { data: myAttempts } = trpc.assessment.myAttempts.useQuery({ assessmentId }, { enabled: role === "STUDENT" });
  const startAttempt = trpc.assessment.startAttempt.useMutation({
    onSuccess: (attempt) => router.push(`/assessments/${assessmentId}/take/${attempt.id}`),
  });

  const isInstructor = role === "INSTRUCTOR" || role === "ADMIN";

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>;
  if (!data) return <p>Assessment not found</p>;

  const completedAttempts = myAttempts?.filter((a) => a.status !== "IN_PROGRESS") ?? [];

  const activeAttempt = myAttempts?.find((a) => a.status === "IN_PROGRESS");
  const now = new Date();
  const isUpcoming = Boolean(data.availableFrom && now < new Date(data.availableFrom));
  const isExpired = Boolean(data.availableUntil && now > new Date(data.availableUntil));
  const isAvailableNow = !isUpcoming && !isExpired;
  const canAttempt = completedAttempts.length < data.maxAttempts && isAvailableNow;
  const bestScore = completedAttempts.length > 0
    ? Math.max(...completedAttempts.map((a) => a.percentScore ?? 0))
    : null;

  function formatDateTime(date?: Date | string | null) {
    if (!date) return null;
    return new Date(date).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/courses/${data.course.id}`} className="hover:text-gray-700 flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />{data.course.title}
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-gray-900">{data.title}</span>
      </div>

      {isInstructor && (
        <div className="flex justify-end">
          <Link href={`/assessments/${assessmentId}/edit`}>
            <Button variant="outline" size="sm">Edit Assessment</Button>
          </Link>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          {role === "STUDENT" && (
            <div className="mb-5">
              {activeAttempt ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  You have an attempt in progress. Resume it to continue where you left off.
                </div>
              ) : isUpcoming ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  This assessment opens on {formatDateTime(data.availableFrom)}.
                </div>
              ) : isExpired ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  This assessment closed on {formatDateTime(data.availableUntil)}.
                </div>
              ) : !canAttempt ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                  You have used all available attempts for this assessment.
                </div>
              ) : (
                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                  This assessment is available now{data.availableUntil ? ` and is due ${formatDateTime(data.availableUntil)}` : ""}.
                </div>
              )}
            </div>
          )}

          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex gap-2 mb-2">
                <Badge variant="secondary">{data.type}</Badge>
                {isUpcoming && <Badge variant="warning">Upcoming</Badge>}
                {isExpired && <Badge variant="destructive">Closed</Badge>}
                {isAvailableNow && role === "STUDENT" && <Badge variant="success">Open</Badge>}
                {bestScore !== null && (
                  <Badge variant={bestScore >= (data.passingScore ?? 0) ? "success" : "destructive"}>
                    Best: {Math.round(bestScore)}%
                  </Badge>
                )}
              </div>
              <h1 className="text-2xl font-bold text-gray-900">{data.title}</h1>
              {data.description && <p className="text-gray-500 mt-1">{data.description}</p>}
            </div>
          </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 p-4 bg-gray-50 rounded-lg">
            {data.timeLimit && (
              <div className="text-center">
                <Clock className="h-5 w-5 text-gray-400 mx-auto mb-1" />
                <p className="text-sm font-semibold">{formatDuration(data.timeLimit)}</p>
                <p className="text-xs text-gray-500">Time Limit</p>
              </div>
            )}
            {data.passingScore && (
              <div className="text-center">
                <Target className="h-5 w-5 text-gray-400 mx-auto mb-1" />
                <p className="text-sm font-semibold">{data.passingScore}%</p>
                <p className="text-xs text-gray-500">Pass Score</p>
              </div>
            )}
            <div className="text-center">
              <RotateCcw className="h-5 w-5 text-gray-400 mx-auto mb-1" />
              <p className="text-sm font-semibold">{completedAttempts.length}/{data.maxAttempts}</p>
              <p className="text-xs text-gray-500">Attempts</p>
            </div>
            {data.availableUntil && (
              <div className="text-center">
                <Clock className="h-5 w-5 text-gray-400 mx-auto mb-1" />
                <p className="text-sm font-semibold">{formatDateTime(data.availableUntil)}</p>
                <p className="text-xs text-gray-500">Due</p>
              </div>
            )}
          </div>

          {role === "STUDENT" && (
            <div className="mt-6 flex gap-3">
              {activeAttempt ? (
                <Button onClick={() => router.push(`/assessments/${assessmentId}/take/${activeAttempt.id}`)}>
                  <Play className="h-4 w-4" />Resume Attempt
                </Button>
              ) : canAttempt ? (
                <Button
                  onClick={() => startAttempt.mutate({ assessmentId })}
                  disabled={startAttempt.isPending}
                >
                  {startAttempt.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  <Play className="h-4 w-4" />Start Assessment
                </Button>
              ) : (
                <p className="text-sm text-gray-500">
                  {isUpcoming
                    ? `Available ${formatDateTime(data.availableFrom)}`
                    : isExpired
                      ? "Assessment closed"
                      : "No attempts remaining"}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {myAttempts && myAttempts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attempt History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {myAttempts.map((attempt, i) => (
                <div key={attempt.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium">Attempt {myAttempts.length - i}</p>
                    <p className="text-xs text-gray-500">{formatDate(attempt.startedAt)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={attempt.status === "GRADED" ? "success" : "secondary"}>
                      {attempt.status}
                    </Badge>
                    {attempt.percentScore !== null && (
                      <span className={`text-sm font-semibold ${attempt.isPassed ? "text-green-600" : "text-red-600"}`}>
                        {Math.round(attempt.percentScore ?? 0)}%
                      </span>
                    )}
                    {attempt.status !== "IN_PROGRESS" && (
                      <Link href={`/assessments/${assessmentId}/results/${attempt.id}`}>
                        <Button size="sm" variant="outline">View</Button>
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
