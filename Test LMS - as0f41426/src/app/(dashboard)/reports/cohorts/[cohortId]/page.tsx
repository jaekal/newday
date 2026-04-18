"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Download, Loader2, Target, Users, UsersRound } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { buildCsv, formatDuration } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { useToast } from "@/components/ui/toast";

export default function CohortReportDetailPage() {
  const { cohortId } = useParams<{ cohortId: string }>();
  const { toast } = useToast();
  const { data, isLoading } = trpc.report.cohortDetail.useQuery({ cohortId });

  const csv = useMemo(() => {
    if (!data) return "";
    return buildCsv(
      [
        "Course",
        "Learner",
        "Email",
        "Progress %",
        "Completed Modules",
        "Assigned Modules",
        "Next Module",
        "Remaining Time",
        "Overdue Assessments",
        "Passed Assessments",
        "Best Score",
        "On Track",
      ],
      data.courses.flatMap((course) =>
        course.memberRows.map((learner) => [
          course.courseTitle,
          learner.learnerName,
          learner.learnerEmail,
          Math.round(learner.progress),
          learner.completedModules,
          learner.assignedModules,
          learner.nextModuleTitle ?? "",
          learner.remainingMinutes ? formatDuration(learner.remainingMinutes) : "",
          learner.overdueCount,
          learner.passedAssessments,
          learner.bestScore !== null ? Math.round(learner.bestScore) : "",
          learner.isOnTrack ? "Yes" : "No",
        ]),
      ),
    );
  }, [data]);

  function downloadCsv(filename: string, value: string) {
    if (!value.trim()) {
      toast({ title: "Nothing to export", description: "There is no cohort drilldown data to export yet.", variant: "error" });
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
        eyebrow="Cohort reporting"
        title={data.cohort.name}
        description={data.cohort.description ?? "Track how this cohort is progressing through assigned course paths and where intervention is needed."}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => downloadCsv(`${data.cohort.name}-cohort-report.csv`, csv)}>
              <Download className="h-4 w-4" />
              Export Cohort Detail
            </Button>
            <Link href="/reports">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4" />
                Back to Reports
              </Button>
            </Link>
            <Link href="/admin/cohorts">
              <Button>Open Cohorts</Button>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Members" value={data.cohort.memberCount} icon={<Users className="h-5 w-5" />} />
        <StatCard label="Courses" value={data.cohort.courseCount} icon={<UsersRound className="h-5 w-5" />} />
        <StatCard label="Avg Progress" value={`${Math.round(data.summary.avgProgress)}%`} icon={<Target className="h-5 w-5" />} />
        <StatCard label="Custom Paths" value={data.summary.customPathCourses} icon={<Target className="h-5 w-5" />} />
        <StatCard label="Overdue Members" value={data.summary.overdueMembers} icon={<AlertTriangle className="h-5 w-5" />} alert={data.summary.overdueMembers > 0} />
      </div>

      {data.courses.length === 0 ? (
        <EmptyState
          icon={<UsersRound className="h-5 w-5" />}
          title="No course assignments yet"
          message="This cohort exists, but it does not currently have any reportable course paths in scope."
        />
      ) : (
        <div className="space-y-6">
          {data.courses.map((course) => (
            <Card key={course.courseId}>
              <CardHeader>
                <SectionHeader
                  title={course.courseTitle}
                  description={
                    course.isCustomPath
                      ? `Custom cohort path with ${course.assignedModules} of ${course.totalCourseModules} modules assigned.`
                      : `Full course path with ${course.assignedModules} assigned modules.`
                  }
                  actions={
                    <>
                      <Badge variant={course.isCustomPath ? "outline" : "secondary"}>
                        {course.isCustomPath ? "Custom path" : "Full course"}
                      </Badge>
                      <Badge variant={course.overdueMembers > 0 ? "warning" : "secondary"}>
                        {course.overdueMembers} overdue
                      </Badge>
                    </>
                  }
                />
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <MiniMetric label="Average progress" value={`${Math.round(course.avgProgress)}%`} />
                  <MiniMetric label="On track" value={`${course.onTrackMembers}/${data.cohort.memberCount}`} />
                  <MiniMetric label="Assigned modules" value={`${course.assignedModules}/${course.totalCourseModules}`} />
                </div>

                {course.memberRows.length === 0 ? (
                  <EmptyState
                    title="No member rows"
                    message="Once this cohort has learners enrolled into the assigned course path, their progress will show here."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase text-[#888888]">
                          <th className="pb-2 font-medium">Learner</th>
                          <th className="pb-2 font-medium text-right">Progress</th>
                          <th className="pb-2 font-medium text-right">Modules</th>
                          <th className="pb-2 font-medium">Next Module</th>
                          <th className="pb-2 font-medium text-right">Overdue</th>
                          <th className="pb-2 font-medium text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#f1f1f1]">
                        {course.memberRows.map((learner) => (
                          <tr key={`${course.courseId}-${learner.learnerId}`}>
                            <td className="py-3">
                              <div className="flex flex-col">
                                <span className="font-medium text-[#111111]">{learner.learnerName}</span>
                                <span className="text-xs text-[#888888]">{learner.learnerEmail}</span>
                              </div>
                            </td>
                            <td className="py-3 text-right text-[#444444]">{Math.round(learner.progress)}%</td>
                            <td className="py-3 text-right text-[#444444]">{learner.completedModules}/{learner.assignedModules}</td>
                            <td className="py-3 text-[#444444]">
                              {learner.nextModuleTitle ?? "Completed path"}
                              {learner.remainingMinutes ? (
                                <div className="text-xs text-[#888888]">{formatDuration(learner.remainingMinutes)} left</div>
                              ) : null}
                            </td>
                            <td className="py-3 text-right">
                              <span className={learner.overdueCount > 0 ? "font-medium text-amber-700" : "text-[#444444]"}>
                                {learner.overdueCount}
                              </span>
                            </td>
                            <td className="py-3">
                              <div className="flex justify-end gap-2">
                                <Link href={`/reports/learners/${learner.learnerId}`}>
                                  <Button size="sm" variant="outline">Learner</Button>
                                </Link>
                                <Link href={`/reports/courses/${course.courseId}`}>
                                  <Button size="sm" variant="outline">Course</Button>
                                </Link>
                                <Link href={`/courses/${course.courseId}`}>
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
          ))}
        </div>
      )}
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
