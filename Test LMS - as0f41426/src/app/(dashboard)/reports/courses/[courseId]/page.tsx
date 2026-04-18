"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, BookOpen, Download, Loader2, Mail, Target, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { buildCsv, formatDuration } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function formatDateTime(date?: Date | string | null) {
  if (!date) return "No activity yet";
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function CourseReportDetailPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.report.courseDetail.useQuery({ courseId });
  const notifyOverdue = trpc.report.notifyOverdue.useMutation({
    onSuccess: (result) => {
      toast({
        title: "Reminders sent",
        description: `${result.sent} overdue learner notification${result.sent === 1 ? "" : "s"} sent.`,
        variant: "success",
      });
      utils.report.courseDetail.invalidate({ courseId });
      utils.report.overview.invalidate();
      utils.notification.list.invalidate();
    },
    onError: (error) => {
      toast({ title: "Reminder failed", description: error.message, variant: "error" });
    },
  });

  const learnerCsv = useMemo(() => {
    if (!data) return "";
    return buildCsv(
      [
        "Learner",
        "Email",
        "Cohorts",
        "Custom Path",
        "Progress %",
        "Completed Modules",
        "Assigned Modules",
        "Next Module",
        "Remaining Time",
        "Overdue Assessments",
        "Passed Assessments",
        "In Progress Assessments",
        "Last Activity",
        "At Risk",
      ],
      data.learners.map((learner) => [
        learner.learnerName,
        learner.learnerEmail,
        learner.cohortNames.join("; "),
        learner.isCustomPath ? "Yes" : "No",
        Math.round(learner.progress),
        learner.completedModules,
        learner.assignedModules,
        learner.nextModuleTitle ?? "",
        learner.remainingMinutes ? formatDuration(learner.remainingMinutes) : "",
        learner.overdueCount,
        learner.passedAssessments,
        learner.inProgressAssessments,
        formatDateTime(learner.lastActivityAt),
        learner.isAtRisk ? "Yes" : "No",
      ]),
    );
  }, [data]);

  function downloadCsv(filename: string, csv: string) {
    if (!csv.trim()) {
      toast({ title: "Nothing to export", description: "There is no learner report data to export yet.", variant: "error" });
      return;
    }
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-[#111111]" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-[#888888]">
            <Link href="/reports" className="inline-flex items-center gap-1 hover:text-[#111111]">
              <ArrowLeft className="h-4 w-4" />
              Reports
            </Link>
            <span>/</span>
            <span>{data.course.title}</span>
          </div>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-[#111111]">{data.course.title}</h1>
          <p className="mt-1 text-sm text-[#888888]">
            Instructor: {data.course.instructorName} - {data.course.moduleCount} modules - {data.course.assessmentCount} assessments
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" onClick={() => downloadCsv(`${data.course.title}-learner-report.csv`, learnerCsv)}>
            <Download className="h-4 w-4" />
            Export Learners
          </Button>
          <Button
            type="button"
            disabled={notifyOverdue.isPending || data.summary.overdueLearners === 0}
            onClick={() => notifyOverdue.mutate({ courseId })}
          >
            {notifyOverdue.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Notify Course Overdue
          </Button>
          <Link href={`/courses/${courseId}`}>
            <Button variant="outline">Open Course</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <StatCard label="Learners" value={data.course.learnerCount} icon={<Users className="h-5 w-5" />} />
        <StatCard label="Avg Progress" value={`${Math.round(data.summary.avgProgress)}%`} icon={<Target className="h-5 w-5" />} />
        <StatCard label="Completed" value={data.summary.completedLearners} icon={<BookOpen className="h-5 w-5" />} />
        <StatCard
          label="At Risk"
          value={data.summary.atRiskLearners}
          icon={<AlertTriangle className="h-5 w-5" />}
          alert={data.summary.atRiskLearners > 0}
        />
        <StatCard label="Custom Paths" value={data.summary.customPathLearners} icon={<Target className="h-5 w-5" />} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.25fr,0.75fr] gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">Learner Progress</CardTitle>
              <Badge variant="secondary">{data.learners.length} learner{data.learners.length === 1 ? "" : "s"}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.learners.length === 0 ? (
              <EmptyState message="No enrolled learners are available for this course yet." />
            ) : (
              data.learners.map((learner) => (
                <div key={learner.learnerId} className="rounded-xl border border-[#e8e8e8] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[#111111]">{learner.learnerName}</p>
                        {learner.isAtRisk ? <Badge variant="warning">At risk</Badge> : <Badge variant="secondary">On track</Badge>}
                        {learner.isCustomPath ? <Badge variant="outline">Custom path</Badge> : null}
                        {learner.isStalled ? <Badge variant="warning">Stalled</Badge> : null}
                      </div>
                      <p className="mt-1 text-xs text-[#888888]">{learner.learnerEmail}</p>
                      {learner.cohortNames.length ? (
                        <p className="mt-1 text-xs text-[#888888]">Cohorts: {learner.cohortNames.join(", ")}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Link href={`/reports/learners/${learner.learnerId}`}>
                        <Button size="sm" variant="outline">Learner</Button>
                      </Link>
                      {learner.overdueCount > 0 ? (
                        <Button
                          size="sm"
                          onClick={() => notifyOverdue.mutate({ courseId, learnerId: learner.learnerId })}
                          disabled={notifyOverdue.isPending}
                        >
                          Remind
                        </Button>
                      ) : null}
                      <Link href={`/courses/${courseId}`}>
                        <Button size="sm" variant="outline">Open</Button>
                      </Link>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <Metric label="Progress" value={`${Math.round(learner.progress)}%`} />
                    <Metric label="Modules" value={`${learner.completedModules}/${learner.assignedModules}`} />
                    <Metric
                      label="Overdue"
                      value={learner.overdueCount}
                      tone={learner.overdueCount > 0 ? "warn" : "default"}
                    />
                    <Metric label="Best Score" value={learner.latestScore !== null ? `${Math.round(learner.latestScore)}%` : "-"} />
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-[#666666] sm:grid-cols-2">
                    <p>Next module: <span className="font-medium text-[#111111]">{learner.nextModuleTitle ?? "Completed path"}</span></p>
                    <p>Remaining time: <span className="font-medium text-[#111111]">{learner.remainingMinutes ? formatDuration(learner.remainingMinutes) : "-"}</span></p>
                    <p>Assessment state: <span className="font-medium text-[#111111]">{learner.passedAssessments} passed, {learner.inProgressAssessments} in progress</span></p>
                    <p>Last activity: <span className="font-medium text-[#111111]">{formatDateTime(learner.lastActivityAt)}</span></p>
                  </div>

                  {learner.overdueAssessmentTitles.length ? (
                    <p className="mt-3 text-xs text-amber-700">
                      Overdue: {learner.overdueAssessmentTitles.join(", ")}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Assessment Risk</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.assessmentBreakdown.length === 0 ? (
                <EmptyState message="No assessments in this course yet." />
              ) : (
                data.assessmentBreakdown.map((assessment) => (
                  <div
                    key={assessment.assessmentId}
                    className={`rounded-xl border p-4 ${assessment.overdueCount > 0 ? "border-amber-200 bg-amber-50/60" : "border-[#e8e8e8]"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[#111111]">{assessment.title}</p>
                        <p className="mt-1 text-xs text-[#888888]">
                          {assessment.availableUntil ? `Due ${formatDateTime(assessment.availableUntil)}` : "No due date"}
                        </p>
                      </div>
                      <Badge variant={assessment.overdueCount > 0 ? "warning" : "secondary"}>
                        {assessment.overdueCount} overdue
                      </Badge>
                    </div>
                    <div className="mt-3">
                      <Link href={`/assessments/${assessment.assessmentId}`}>
                        <Button size="sm" variant="outline" className="w-full">Open Assessment</Button>
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Course Pacing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-[#666666]">
              <p>
                Total designed seat time: <span className="font-semibold text-[#111111]">{data.course.totalEstimatedMinutes ? formatDuration(data.course.totalEstimatedMinutes) : "-"}</span>
              </p>
              <p>
                Learners on custom cohort paths: <span className="font-semibold text-[#111111]">{data.summary.customPathLearners}</span>
              </p>
              <p>
                Learners with overdue assessments: <span className="font-semibold text-[#111111]">{data.summary.overdueLearners}</span>
              </p>
              <p>
                This view is aligned to common LMS manager workflows: who is behind, what they should do next, and whether they are on a cohort-specific path.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  alert,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  alert?: boolean;
}) {
  return (
    <Card className={alert ? "border-amber-300 bg-amber-50/50" : ""}>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${alert ? "bg-amber-100 text-amber-600" : "bg-[#f4f4f4] text-[#555555]"}`}>
            {icon}
          </div>
          <div>
            <p className="text-2xl font-black text-[#111111]">{value}</p>
            <p className="text-sm text-[#888888]">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "warn";
}) {
  return (
    <div className="rounded-lg bg-[#f8f8f8] px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.18em] text-[#888888]">{label}</p>
      <p className={`mt-1 font-semibold ${tone === "warn" ? "text-amber-700" : "text-[#111111]"}`}>{value}</p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="py-6 text-center text-sm text-[#888888]">{message}</p>;
}
