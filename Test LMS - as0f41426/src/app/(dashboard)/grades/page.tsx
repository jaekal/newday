"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, TrendingUp, Trophy, ClipboardList, BarChart2, Table2 } from "lucide-react";
import Link from "next/link";
import { formatDate, formatScore } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { AssessmentHeatmap } from "@/components/ui/assessment-heatmap";
import { Button } from "@/components/ui/button";

const ALL_ASSESSMENTS_VALUE = "__all_assessments__";

export default function GradesPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? "STUDENT";
  const [selectedCourseId, setSelectedCourseId] = useState<string | undefined>(undefined);
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string | undefined>(undefined);
  const [gradebookView, setGradebookView] = useState<"table" | "heatmap">("table");

  const { data: myGrades, isLoading: loadingGrades } = trpc.grade.myGrades.useQuery(
    { courseId: selectedCourseId },
    { enabled: role === "STUDENT" },
  );
  const { data: courses } = trpc.course.list.useQuery(
    { limit: 50 },
    { enabled: role !== "STUDENT" },
  );
  const { data: assessments } = trpc.assessment.list.useQuery(
    { courseId: selectedCourseId ?? "" },
    { enabled: role !== "STUDENT" && !!selectedCourseId },
  );
  const { data: gradebook, isLoading: loadingGradebook } = trpc.grade.gradebook.useQuery(
    { courseId: selectedCourseId ?? "", assessmentId: selectedAssessmentId },
    { enabled: role !== "STUDENT" && !!selectedCourseId },
  );

  // ── Student view ──────────────────────────────────────────────────────────────
  if (role === "STUDENT") {
    const avgScore =
      myGrades && myGrades.length > 0
        ? Math.round(myGrades.reduce((s, g) => s + g.percentScore, 0) / myGrades.length)
        : null;

    const byCourse = myGrades?.reduce<Record<string, typeof myGrades>>((acc, g) => {
      const courseId = g.enrollment.course.id;
      if (!acc[courseId]) acc[courseId] = [];
      acc[courseId].push(g);
      return acc;
    }, {}) ?? {};

    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">My Grades</h1>

        {loadingGrades ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 rounded-lg">
                      <ClipboardList className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{myGrades?.length ?? 0}</p>
                      <p className="text-sm text-gray-500">Graded Assessments</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-50 rounded-lg">
                      <TrendingUp className="h-5 w-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">
                        {avgScore !== null ? `${avgScore}%` : "—"}
                      </p>
                      <p className="text-sm text-gray-500">Overall Average</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-50 rounded-lg">
                      <Trophy className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">
                        {myGrades?.filter((g) => g.percentScore >= 70).length ?? 0}
                      </p>
                      <p className="text-sm text-gray-500">Passed</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {Object.entries(byCourse).length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-gray-400">
                  No grades yet. Complete an assessment to see your results here.
                </CardContent>
              </Card>
            ) : (
              Object.entries(byCourse).map(([cId, grades]) => (
                <Card key={cId}>
                  <CardHeader>
                    <CardTitle className="text-base">
                      <Link
                        href={`/courses/${cId}`}
                        className="hover:underline text-blue-700"
                      >
                        {grades[0].enrollment.course.title}
                      </Link>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {grades.map((g) => (
                      <div key={g.id} className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-gray-900 truncate flex-1 mr-4">
                            {g.attempt?.id ? (
                              <Link
                                href={`/assessments/${g.assessmentId}/results/${g.attempt.id}`}
                                className="hover:underline text-blue-700"
                              >
                                Assessment Result
                              </Link>
                            ) : (
                              "Assessment"
                            )}
                          </span>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-xs text-gray-400">
                              {formatDate(g.gradedAt)}
                            </span>
                            <span
                              className={cn(
                                "font-semibold",
                                g.percentScore >= 70 ? "text-green-600" : "text-red-600",
                              )}
                            >
                              {Math.round(g.percentScore)}%
                            </span>
                            <Badge
                              variant={g.percentScore >= 70 ? "success" : "destructive"}
                              className="text-xs"
                            >
                              {g.percentScore >= 70 ? "Pass" : "Fail"}
                            </Badge>
                          </div>
                        </div>
                        <Progress value={g.percentScore} />
                        <p className="text-xs text-gray-400">
                          {formatScore(g.score, g.maxScore)}
                          {g.feedback && ` · ${g.feedback}`}
                        </p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))
            )}
          </>
        )}
      </div>
    );
  }

  // ── Instructor / Admin view ───────────────────────────────────────────────────
  const heatmapAttempts =
    gradebook
      ?.filter((g) => g.assessmentId != null)
      .map((g) => ({
        id: g.id,
        studentName: g.user.name ?? "Unknown",
        studentEmail: g.user.email ?? "",
        submittedAt: g.attempt?.submittedAt ?? null,
        percentScore: g.percentScore,
        assessmentId: g.assessmentId!,
        attemptId: g.attempt?.id,
        isPassed: g.attempt?.isPassed ?? null,
      })) ?? [];

  return (
    <div className="space-y-6">
      {/* Selectors */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Gradebook</h1>
        <div className="flex gap-3 flex-wrap">
          <Select
            value={selectedCourseId ?? ""}
            onValueChange={(v) => {
              setSelectedCourseId(v || undefined);
              setSelectedAssessmentId(undefined);
            }}
          >
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Select a course" />
            </SelectTrigger>
            <SelectContent>
              {courses?.courses.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedCourseId && assessments && assessments.length > 0 && (
            <Select
              value={selectedAssessmentId ?? ALL_ASSESSMENTS_VALUE}
              onValueChange={(value) =>
                setSelectedAssessmentId(value === ALL_ASSESSMENTS_VALUE ? undefined : value)
              }
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All assessments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ASSESSMENTS_VALUE}>All assessments</SelectItem>
                {assessments.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {!selectedCourseId && (
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            Select a course above to view its gradebook.
          </CardContent>
        </Card>
      )}

      {selectedCourseId && loadingGradebook && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      )}

      {selectedCourseId && !loadingGradebook && gradebook && (
        <>
          {gradebook.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-gray-400">
                No grades submitted for this course yet.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">
                  {selectedAssessmentId
                    ? assessments?.find((a) => a.id === selectedAssessmentId)?.title ?? "Assessment"
                    : "All Grades"}
                </CardTitle>
                {/* View toggle — only meaningful when an assessment is selected */}
                {selectedAssessmentId && (
                  <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                    <Button
                      size="sm"
                      variant={gradebookView === "table" ? "default" : "ghost"}
                      className="h-7 px-2 gap-1.5"
                      onClick={() => setGradebookView("table")}
                    >
                      <Table2 className="h-3.5 w-3.5" /> Table
                    </Button>
                    <Button
                      size="sm"
                      variant={gradebookView === "heatmap" ? "default" : "ghost"}
                      className="h-7 px-2 gap-1.5"
                      onClick={() => setGradebookView("heatmap")}
                    >
                      <BarChart2 className="h-3.5 w-3.5" /> Heatmap
                    </Button>
                  </div>
                )}
              </CardHeader>

              <CardContent>
                {selectedAssessmentId && gradebookView === "heatmap" ? (
                  <AssessmentHeatmap
                    attempts={heatmapAttempts}
                    assessmentTitle={
                      assessments?.find((a) => a.id === selectedAssessmentId)?.title ?? ""
                    }
                  />
                ) : (
                  <div className="overflow-x-auto -mx-6">
                    <table className="w-full text-sm">
                      <thead className="border-b border-gray-200 bg-gray-50">
                        <tr>
                          <th className="text-left py-3 px-4 font-semibold text-gray-600">Student</th>
                          <th className="text-left py-3 px-4 font-semibold text-gray-600">Email</th>
                          <th className="text-left py-3 px-4 font-semibold text-gray-600">Score</th>
                          <th className="text-left py-3 px-4 font-semibold text-gray-600">Status</th>
                          <th className="text-left py-3 px-4 font-semibold text-gray-600">Graded</th>
                          <th className="text-left py-3 px-4 font-semibold text-gray-600">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {gradebook.map((g) => (
                          <tr key={g.id} className="hover:bg-gray-50">
                            <td className="py-3 px-4 font-medium text-gray-900">
                              {g.user.name}
                            </td>
                            <td className="py-3 px-4 text-gray-500">{g.user.email}</td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <span
                                  className={cn(
                                    "font-semibold",
                                    g.percentScore >= 70 ? "text-green-600" : "text-red-600",
                                  )}
                                >
                                  {Math.round(g.percentScore)}%
                                </span>
                                <span className="text-gray-400 text-xs">
                                  ({formatScore(g.score, g.maxScore)})
                                </span>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <Badge
                                variant={g.attempt?.isPassed ? "success" : "destructive"}
                              >
                                {g.attempt?.status ?? "GRADED"}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-gray-500">
                              {formatDate(g.gradedAt)}
                            </td>
                            <td className="py-3 px-4">
                              {g.attempt?.id && g.assessmentId && (
                                <Link
                                  href={`/assessments/${g.assessmentId}/results/${g.attempt.id}`}
                                  className="text-blue-600 hover:underline text-xs font-medium"
                                >
                                  View
                                </Link>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
