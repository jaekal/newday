"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, BookOpen, Download, Loader2, Mail, Target, UsersRound } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { buildCsv, formatDuration } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { useToast } from "@/components/ui/toast";

function formatDateTime(date?: Date | string | null) {
  if (!date) return "No recent activity";
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function LearnerReportDetailPage() {
  const { learnerId } = useParams<{ learnerId: string }>();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.report.learnerDetail.useQuery({ learnerId });
  const notifyOverdue = trpc.report.notifyOverdue.useMutation({
    onSuccess: (result) => {
      toast({
        title: "Reminder sent",
        description: `${result.sent} overdue assessment reminder${result.sent === 1 ? "" : "s"} sent.`,
        variant: "success",
      });
      utils.report.learnerDetail.invalidate({ learnerId });
      utils.report.overview.invalidate();
      utils.notification.list.invalidate();
    },
    onError: (error) => {
      toast({ title: "Reminder failed", description: error.message, variant: "error" });
    },
  });

  const csv = useMemo(() => {
    if (!data) return "";
    return buildCsv(
      [
        "Course",
        "Instructor",
        "Custom Path",
        "Cohorts",
        "Progress %",
        "Completed Modules",
        "Assigned Modules",
        "Next Module",
        "Remaining Time",
        "Overdue Assessments",
        "Passed Assessments",
        "In Progress Assessments",
        "Best Score",
      ],
      data.courses.map((course) => [
        course.courseTitle,
        course.instructorName,
        course.isCustomPath ? "Yes" : "No",
        course.cohortNames.join("; "),
        Math.round(course.progress),
        course.completedModules,
        course.assignedModules,
        course.nextModuleTitle ?? "",
        course.remainingMinutes ? formatDuration(course.remainingMinutes) : "",
        course.overdueCount,
        course.passedAssessments,
        course.inProgressAssessments,
        course.bestScore !== null ? Math.round(course.bestScore) : "",
      ]),
    );
  }, [data]);

  function downloadCsv(filename: string, value: string) {
    if (!value.trim()) {
      toast({ title: "Nothing to export", description: "There is no learner detail data to export yet.", variant: "error" });
      return;
    }
    const blob = new Blob([value], { type: "text/csv;charset=utf-8;" });
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
      <PageHeader
        eyebrow="Learner reporting"
        title={data.learner.name}
        description={`${data.learner.email}${data.learner.employeeId ? ` - Employee #${data.learner.employeeId}` : ""}`}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => downloadCsv(`${data.learner.name}-learner-report.csv`, csv)}>
              <Download className="h-4 w-4" />
              Export Learner Detail
            </Button>
            <Button
              type="button"
              disabled={notifyOverdue.isPending || data.summary.overdueAssessments === 0}
              onClick={() => notifyOverdue.mutate({ learnerId })}
            >
              {notifyOverdue.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Remind Learner
            </Button>
            <Link href="/reports">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4" />
                Back to Reports
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Courses" value={data.summary.enrolledCourses} icon={<BookOpen className="h-5 w-5" />} />
        <StatCard label="Avg Progress" value={`${Math.round(data.summary.avgProgress)}%`} icon={<Target className="h-5 w-5" />} />
        <StatCard label="Overdue Courses" value={data.summary.overdueCourses} icon={<AlertTriangle className="h-5 w-5" />} alert={data.summary.overdueCourses > 0} />
        <StatCard label="Overdue Items" value={data.summary.overdueAssessments} icon={<AlertTriangle className="h-5 w-5" />} alert={data.summary.overdueAssessments > 0} />
        <StatCard label="Custom Paths" value={data.summary.customPathCourses} icon={<Target className="h-5 w-5" />} />
        <StatCard label="Cohorts" value={data.summary.cohortCount} icon={<UsersRound className="h-5 w-5" />} />
      </div>

      <Card className="border-[#ece8dd] bg-[#fcfaf4]">
        <CardContent className="grid gap-4 pt-6 md:grid-cols-2 xl:grid-cols-4">
          <MetaBlock label="Latest activity" value={formatDateTime(data.summary.latestActivityAt)} />
          <MetaBlock label="Cohort memberships" value={data.cohorts.length ? data.cohorts.map((cohort) => cohort.name).join(", ") : "None"} />
          <MetaBlock label="At-risk signal" value={data.summary.overdueCourses > 0 ? "Overdue work present" : "No overdue work"} />
          <MetaBlock label="Next best review" value={data.courses[0]?.nextModuleTitle ?? "All current paths completed"} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr,0.85fr]">
        <Card>
          <CardHeader>
            <SectionHeader
              title="Course-by-Course Progress"
              description="This view shows where the learner is active, which paths are cohort-specific, and where they are blocked or overdue."
            />
          </CardHeader>
          <CardContent className="space-y-3">
            {data.courses.length === 0 ? (
              <EmptyState
                icon={<BookOpen className="h-5 w-5" />}
                title="No reportable courses"
                message="This learner does not currently have any in-scope course enrollments for reporting."
              />
            ) : (
              data.courses.map((course) => (
                <div key={course.courseId} className="rounded-xl border border-[#e8e8e8] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[#111111]">{course.courseTitle}</p>
                        {course.isCustomPath ? <Badge variant="outline">Custom path</Badge> : <Badge variant="secondary">Full course</Badge>}
                        {course.overdueCount > 0 ? <Badge variant="warning">{course.overdueCount} overdue</Badge> : null}
                      </div>
                      <p className="mt-1 text-xs text-[#888888]">Instructor: {course.instructorName}</p>
                      {course.cohortNames.length ? (
                        <p className="mt-1 text-xs text-[#888888]">Cohorts: {course.cohortNames.join(", ")}</p>
                      ) : null}
                    </div>
                    <div className="flex gap-2">
                      <Link href={`/reports/courses/${course.courseId}`}>
                        <Button size="sm" variant="outline">Course</Button>
                      </Link>
                      <Link href={`/courses/${course.courseId}`}>
                        <Button size="sm" variant="outline">Open</Button>
                      </Link>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <MiniMetric label="Progress" value={`${Math.round(course.progress)}%`} />
                    <MiniMetric label="Modules" value={`${course.completedModules}/${course.assignedModules}`} />
                    <MiniMetric label="Best score" value={course.bestScore !== null ? `${Math.round(course.bestScore)}%` : "-"} />
                    <MiniMetric label="Assessments" value={`${course.passedAssessments} passed / ${course.inProgressAssessments} active`} />
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-[#666666] sm:grid-cols-2">
                    <p>Next module: <span className="font-medium text-[#111111]">{course.nextModuleTitle ?? "Completed path"}</span></p>
                    <p>Remaining time: <span className="font-medium text-[#111111]">{course.remainingMinutes ? formatDuration(course.remainingMinutes) : "-"}</span></p>
                  </div>

                  {course.overdueTitles.length ? (
                    <p className="mt-3 text-xs text-amber-700">Overdue: {course.overdueTitles.join(", ")}</p>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <SectionHeader
                title="Recent Activity"
                description="Use this timeline to understand recency and whether the learner is still moving."
              />
            </CardHeader>
            <CardContent className="space-y-3">
              {data.timeline.length === 0 ? (
                <EmptyState title="No recent activity" message="Recent module completions and assessment events will show here." />
              ) : (
                data.timeline.map((event, index) => (
                  <div key={`${event.type}-${event.courseId}-${index}`} className="rounded-xl border border-[#e8e8e8] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-[#111111]">{event.title}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[#888888]">
                          {event.type === "module_completion" ? "Module completion" : "Assessment attempt"}
                        </p>
                      </div>
                      <span className="text-xs text-[#888888]">{formatDateTime(event.occurredAt)}</span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <SectionHeader
                title="Assessment History"
                description="Recent attempt history helps explain the score trend and whether overdue work is the result of non-starts or incomplete attempts."
              />
            </CardHeader>
            <CardContent className="space-y-3">
              {data.attemptHistory.length === 0 ? (
                <EmptyState title="No attempt history" message="Assessment attempts will show here once the learner starts or submits an assessment." />
              ) : (
                data.attemptHistory.map((attempt, index) => (
                  <div key={`${attempt.assessmentId}-${index}`} className="rounded-xl border border-[#e8e8e8] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-[#111111]">{attempt.assessmentTitle}</p>
                        <p className="mt-1 text-xs text-[#888888]">{attempt.courseTitle}</p>
                      </div>
                      <Badge variant={attempt.isPassed ? "success" : attempt.status === "IN_PROGRESS" ? "warning" : "secondary"}>
                        {attempt.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-[#666666]">
                      <p>Occurred: <span className="font-medium text-[#111111]">{formatDateTime(attempt.occurredAt)}</span></p>
                      <p>Score: <span className="font-medium text-[#111111]">{attempt.score !== null ? `${Math.round(attempt.score)}%` : "-"}</span></p>
                    </div>
                  </div>
                ))
              )}
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

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[#f8f8f8] px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.18em] text-[#888888]">{label}</p>
      <p className="mt-1 font-semibold text-[#111111]">{value}</p>
    </div>
  );
}

function MetaBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#e8dfcb] bg-white px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-[#888888]">{label}</p>
      <p className="mt-2 text-sm font-semibold text-[#111111]">{value}</p>
    </div>
  );
}
