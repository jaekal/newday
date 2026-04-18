"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/components/ui/toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, BookOpen, Download, Loader2, Mail, Target, Users, UsersRound } from "lucide-react";
import { buildCsv } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";

function formatDateTime(date?: Date | string | null) {
  if (!date) return "-";
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ReportsPage() {
  const { toast } = useToast();
  const { data, isLoading } = trpc.report.overview.useQuery();
  const [courseView, setCourseView] = useState<"all" | "risk" | "custom">("all");
  const utils = trpc.useUtils();
  const notifyOverdue = trpc.report.notifyOverdue.useMutation({
    onSuccess: (result) => {
      toast({
        title: "Reminders sent",
        description: `${result.sent} overdue learner notification${result.sent === 1 ? "" : "s"} sent.`,
        variant: "success",
      });
      utils.notification.list.invalidate();
    },
    onError: (error) => {
      toast({ title: "Reminder failed", description: error.message, variant: "error" });
    },
  });

  const courseHealthCsv = useMemo(() => {
    if (!data) return "";
    return buildCsv(
      ["Course", "Instructor", "Learners", "Modules", "Assessments", "Average Progress %", "Below 50%", "Cohorts"],
      data.courseHealth.map((course) => [
        course.title,
        course.instructorName,
        course.enrolledUsers,
        course.totalModules,
        course.totalAssessments,
        Math.round(course.avgProgress),
        course.lowProgressCount,
        course.cohortCount,
      ]),
    );
  }, [data]);

  const overdueCsv = useMemo(() => {
    if (!data) return "";
    return buildCsv(
      ["Assessment", "Course", "Learner", "Email", "Due", "Latest Attempt Status", "Cohorts"],
      data.overdueAssessments.map((item) => [
        item.assessmentTitle,
        item.courseTitle,
        item.learnerName,
        item.learnerEmail,
        formatDateTime(item.dueAt),
        item.latestAttemptStatus.replace(/_/g, " "),
        item.cohortNames.join("; "),
      ]),
    );
  }, [data]);

  const cohortCsv = useMemo(() => {
    if (!data) return "";
    return buildCsv(
      ["Cohort", "Course", "Custom Path", "Members", "Assigned Modules", "Average Progress %", "On Track"],
      data.cohortProgress.map((item) => [
        item.cohortName,
        item.courseTitle,
        item.isCustomPath ? "Yes" : "No",
        item.memberCount,
        item.assignedModules,
        Math.round(item.avgProgress),
        `${item.onTrackMembers}/${item.memberCount}`,
      ]),
    );
  }, [data]);

  function downloadCsv(filename: string, csv: string) {
    if (!csv.trim()) {
      toast({ title: "Nothing to export", description: "There is no report data available for this export yet.", variant: "error" });
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

  async function copyOverdueEmails() {
    if (!data?.overdueAssessments.length) {
      toast({ title: "No overdue learners", description: "There are no overdue assessment emails to copy.", variant: "error" });
      return;
    }

    const emails = Array.from(new Set(data.overdueAssessments.map((item) => item.learnerEmail).filter(Boolean))).join("; ");
    try {
      await navigator.clipboard.writeText(emails);
      toast({ title: "Emails copied", description: "Overdue learner emails are now on your clipboard.", variant: "success" });
    } catch {
      toast({ title: "Copy failed", description: "Clipboard access was blocked in this browser session.", variant: "error" });
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-[#111111]" />
      </div>
    );
  }

  if (!data) return null;

  const visibleCourseHealth = data.courseHealth.filter((course) => {
    if (courseView === "risk") return course.lowProgressCount > 0;
    if (courseView === "custom") return course.cohortCount > 0;
    return true;
  });

  const visibleCohortProgress = data.cohortProgress.filter((item) =>
    courseView === "custom" ? item.isCustomPath : true,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reporting workspace"
        title="Reports"
        description="Monitor course health, cohort path adherence, and overdue assessments from one action-oriented workspace."
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => downloadCsv("course-health.csv", courseHealthCsv)}>
              <Download className="h-4 w-4" />
              Export Course Health
            </Button>
            <Button type="button" variant="outline" onClick={() => downloadCsv("cohort-adherence.csv", cohortCsv)}>
              <Download className="h-4 w-4" />
              Export Cohort Progress
            </Button>
            <Button type="button" variant="outline" onClick={() => downloadCsv("overdue-assessments.csv", overdueCsv)}>
              <Download className="h-4 w-4" />
              Export Overdue Assessments
            </Button>
          </>
        }
      />

      <Card className="border-[#ece8dd] bg-[#fcfaf4]">
        <CardContent className="flex flex-col gap-4 pt-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#111111]">Action center</p>
            <p className="mt-1 text-sm text-[#888888]">
              Keep interventions near the findings: copy emails, notify overdue learners, and focus the page by risk or path type.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={() => void copyOverdueEmails()}>
              <Mail className="h-4 w-4" />
              Copy Overdue Emails
            </Button>
            <Button
              type="button"
              disabled={notifyOverdue.isPending || !data.overdueAssessments.length}
              onClick={() => notifyOverdue.mutate({})}
            >
              {notifyOverdue.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
              Notify All Overdue
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {[
          { id: "all", label: "All reporting" },
          { id: "risk", label: "At-risk courses" },
          { id: "custom", label: "Custom paths" },
        ].map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setCourseView(option.id as "all" | "risk" | "custom")}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              courseView === option.id
                ? "border-transparent text-white"
                : "border-[#d9d9d9] bg-white text-[#666666] hover:border-[#bdbdbd]"
            }`}
            style={courseView === option.id ? { background: "var(--c-accent)" } : undefined}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <StatCard label="Courses" value={data.summary.totalCourses} icon={<BookOpen className="h-5 w-5" />} />
        <StatCard label="Learners" value={data.summary.totalLearners} icon={<Users className="h-5 w-5" />} />
        <StatCard label="Cohorts" value={data.summary.totalCohorts} icon={<UsersRound className="h-5 w-5" />} />
        <StatCard label="Avg Progress" value={`${Math.round(data.summary.avgCourseProgress)}%`} icon={<Target className="h-5 w-5" />} />
        <StatCard
          label="Overdue"
          value={data.summary.overdueAssessmentCount}
          icon={<AlertTriangle className="h-5 w-5" />}
          alert={data.summary.overdueAssessmentCount > 0}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr,0.8fr] gap-6">
        <Card>
          <CardHeader>
            <SectionHeader
              title="Course Health"
              description="Find where learners are progressing well and where intervention is starting to become necessary."
              actions={<Badge variant="secondary">{visibleCourseHealth.length} course{visibleCourseHealth.length === 1 ? "" : "s"}</Badge>}
            />
          </CardHeader>
          <CardContent className="space-y-3">
            {visibleCourseHealth.length === 0 ? (
              <EmptyState
                icon={<BookOpen className="h-5 w-5" />}
                title="No courses match this view"
                message={courseView === "risk" ? "There are no low-progress courses in the current report scope." : "No courses are available for this report filter yet."}
              />
            ) : (
              visibleCourseHealth.map((course) => (
                <div key={course.courseId} className="rounded-xl border border-[#e8e8e8] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[#111111]">{course.title}</p>
                      <p className="text-xs text-[#888888] mt-1">
                        {course.instructorName} - {course.totalModules} modules - {course.totalAssessments} assessments
                      </p>
                    </div>
                    <Link href={`/reports/courses/${course.courseId}`}>
                      <Button size="sm" variant="outline">Open</Button>
                    </Link>
                  </div>
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <Metric label="Learners" value={course.enrolledUsers} />
                    <Metric label="Avg progress" value={`${Math.round(course.avgProgress)}%`} />
                    <Metric label="Below 50%" value={course.lowProgressCount} tone={course.lowProgressCount > 0 ? "warn" : "default"} />
                    <Metric label="Cohorts" value={course.cohortCount} />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionHeader
              title="Overdue Assessments"
              description="These rows need direct follow-up. Keep this list short by resolving the oldest due work first."
              actions={<Badge variant={data.overdueAssessments.length > 0 ? "warning" : "secondary"}>{data.overdueAssessments.length}</Badge>}
            />
          </CardHeader>
          <CardContent className="space-y-3">
            {data.overdueAssessments.length === 0 ? (
              <EmptyState icon={<AlertTriangle className="h-5 w-5" />} title="No overdue assessments" message="Nothing is overdue right now, so this panel can stay quiet until a learner slips past a due date." />
            ) : (
              data.overdueAssessments.map((item) => (
                <div key={`${item.assessmentId}-${item.learnerId}`} className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[#111111]">{item.assessmentTitle}</p>
                      <p className="text-xs text-[#888888] mt-1">{item.courseTitle}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="warning">{item.latestAttemptStatus.replace(/_/g, " ")}</Badge>
                      <Link href={`/assessments/${item.assessmentId}`}>
                        <Button size="sm" variant="outline">Open</Button>
                      </Link>
                      <Button
                        size="sm"
                        onClick={() =>
                          notifyOverdue.mutate({
                            assessmentId: item.assessmentId,
                            learnerId: item.learnerId,
                          })
                        }
                        disabled={notifyOverdue.isPending}
                      >
                        Remind
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 text-sm text-[#444444] space-y-1">
                    <p>{item.learnerName}</p>
                    <p className="text-xs text-[#888888]">{item.learnerEmail}</p>
                    <p className="text-xs text-[#888888]">Due {formatDateTime(item.dueAt)}</p>
                    {item.cohortNames.length > 0 ? (
                      <p className="text-xs text-[#888888]">Cohorts: {item.cohortNames.join(", ")}</p>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <SectionHeader
            title="Cohort Path Adherence"
            description="Track whether assigned cohorts are staying on pace, especially when custom paths are used instead of full courses."
            actions={<Badge variant="secondary">{visibleCohortProgress.length} assignment{visibleCohortProgress.length === 1 ? "" : "s"}</Badge>}
          />
        </CardHeader>
        <CardContent className="space-y-3">
          {visibleCohortProgress.length === 0 ? (
            <EmptyState icon={<UsersRound className="h-5 w-5" />} title="No cohort paths in this view" message="Once cohorts have assigned learning paths, this section will show whether they are on track and how much of the course is assigned." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-[#888888]">
                    <th className="pb-2 font-medium">Cohort</th>
                    <th className="pb-2 font-medium">Course</th>
                    <th className="pb-2 font-medium text-right">Members</th>
                    <th className="pb-2 font-medium text-right">Modules</th>
                    <th className="pb-2 font-medium text-right">Avg Progress</th>
                    <th className="pb-2 font-medium text-right">On Track</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f1f1f1]">
                  {visibleCohortProgress.map((item) => (
                    <tr key={`${item.cohortId}-${item.courseId}`}>
                      <td className="py-3 font-medium text-[#111111]">
                        <div className="flex items-center gap-2">
                          <span>{item.cohortName}</span>
                          {item.isCustomPath ? <Badge variant="outline">Custom path</Badge> : null}
                        </div>
                      </td>
                      <td className="py-3 text-[#444444]">{item.courseTitle}</td>
                      <td className="py-3 text-right text-[#444444]">{item.memberCount}</td>
                      <td className="py-3 text-right text-[#444444]">{item.assignedModules}</td>
                      <td className="py-3 text-right text-[#444444]">{Math.round(item.avgProgress)}%</td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <span className={item.memberCount > 0 && item.onTrackMembers < item.memberCount ? "text-amber-600 font-medium" : "text-green-700 font-medium"}>
                            {item.onTrackMembers}/{item.memberCount}
                          </span>
                          <Link href={`/reports/cohorts/${item.cohortId}`}>
                            <Button size="sm" variant="outline">Open</Button>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
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
          <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${alert ? "bg-amber-100 text-amber-600" : "bg-[#f4f4f4] text-[#555555]"}`}>
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
