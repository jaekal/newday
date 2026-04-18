"use client";

import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/components/ui/toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen, Clock, Users, ClipboardList,
  ChevronRight, Plus, Loader2, ArrowLeft,
} from "lucide-react";
import Link from "next/link";
import { formatDuration } from "@/lib/utils";
import { VerticalProgressSpine } from "@/components/ui/module-node-rail";
import { getNextAvailableModuleId } from "@/lib/module-path";
import { SectionHeader } from "@/components/ui/section-header";

export default function CoursePage() {
  const { courseId } = useParams<{ courseId: string }>();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? "STUDENT";
  const router = useRouter();

  const { toast } = useToast();
  const { data: course, isLoading } = trpc.course.byId.useQuery({ courseId });
  const { data: enrollment, refetch: refetchEnrollment } = trpc.enrollment.isEnrolled.useQuery({
    courseId,
  });
  const { data: assessmentOverview } = trpc.assessment.myCourseOverview.useQuery(
    { courseId },
    { enabled: role === "STUDENT" && (enrollment?.enrolled ?? false) },
  );
  const enroll = trpc.enrollment.enroll.useMutation({
    onSuccess: () => {
      refetchEnrollment();
      toast({ title: "Enrolled!", description: "You have been enrolled in this course.", variant: "success" });
    },
    onError: (e) => toast({ title: "Enrollment failed", description: e.message, variant: "error" }),
  });
  const publish = trpc.course.update.useMutation({
    onSuccess: () => {
      router.refresh();
      toast({ title: "Course published!", variant: "success" });
    },
    onError: (e) => toast({ title: "Update failed", description: e.message, variant: "error" }),
  });
  const deleteCourse = trpc.course.delete.useMutation({
    onSuccess: () => {
      toast({ title: "Course deleted", description: "The course has been removed.", variant: "success" });
      router.push("/courses");
      router.refresh();
    },
    onError: (e) => toast({ title: "Delete failed", description: e.message, variant: "error" }),
  });

  if (isLoading)
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  if (!course) return <p className="text-gray-500">Course not found</p>;

  const isInstructor = role === "INSTRUCTOR" || role === "ADMIN";
  const customPath = Boolean(course.pathContext?.isCustomPath);
  const customPathLabel = customPath
    ? `${course.pathContext.visibleModuleCount} of ${course.pathContext.totalModuleCount} modules assigned`
    : null;
  const nextModuleId = getNextAvailableModuleId(course.modules);
  const nextModule = nextModuleId
    ? course.modules.find((module) => module.id === nextModuleId)
    : null;

  function formatAvailability(date?: Date | string | null) {
    if (!date) return null;
    return new Date(date).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/courses" className="hover:text-gray-700 flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />Courses
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-gray-900">{course.title}</span>
      </div>

      {/* Hero */}
      <div
        className="rounded-xl p-8 text-white border"
        style={{
          background: "linear-gradient(135deg, var(--c-sidebar) 0%, color-mix(in srgb, var(--c-sidebar) 82%, black) 100%)",
          borderColor: "color-mix(in srgb, var(--c-accent) 30%, transparent)",
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <Badge
              className="mb-3 border"
              style={{
                background: "color-mix(in srgb, var(--c-accent) 18%, transparent)",
                borderColor: "color-mix(in srgb, var(--c-accent) 45%, transparent)",
                color: "white",
              }}
            >
              {course.status}
            </Badge>
            <h1 className="text-3xl font-bold mb-2">{course.title}</h1>
            <p className="text-sm mb-4 line-clamp-2 text-white/72">{course.description}</p>
            <div className="flex items-center gap-4 text-sm text-white/72">
              <span className="flex items-center gap-1.5">
                <Users className="h-4 w-4" />{course._count.enrollments} enrolled
              </span>
              <span className="flex items-center gap-1.5">
                <BookOpen className="h-4 w-4" />{course.modules.length} modules
              </span>
              <span className="flex items-center gap-1.5">
                <ClipboardList className="h-4 w-4" />{course.assessments.length} assessments
              </span>
              {course.pathContext?.estimatedMinutes ? (
                <span className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4" />{formatDuration(course.pathContext.estimatedMinutes)}
                </span>
              ) : null}
            </div>
            {customPath && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/80">
                <Badge
                  className="border"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    borderColor: "rgba(255,255,255,0.15)",
                    color: "white",
                  }}
                >
                  Cohort path
                </Badge>
                <span>{customPathLabel}</span>
                {course.pathContext?.cohortNames?.length ? (
                  <span className="text-white/60">
                    via {course.pathContext.cohortNames.join(", ")}
                  </span>
                ) : null}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            {!isInstructor && !enrollment?.enrolled && course.status === "PUBLISHED" && (
              <Button
                size="lg"
                className="hover:opacity-95"
                style={{ background: "var(--c-accent)", color: "var(--c-accent-fg)" }}
                disabled={enroll.isPending}
                onClick={() => enroll.mutate({ courseId })}
              >
                {enroll.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Enroll Now
              </Button>
            )}
            {isInstructor && course.status === "DRAFT" && (
              <Button
                size="lg"
                className="hover:opacity-95"
                style={{ background: "var(--c-accent)", color: "var(--c-accent-fg)" }}
                onClick={() => publish.mutate({ courseId, status: "PUBLISHED" })}
              >
                Publish Course
              </Button>
            )}
            {isInstructor && (
              <Button
                size="lg"
                variant="destructive"
                disabled={deleteCourse.isPending}
                onClick={() => {
                  const confirmed = window.confirm(`Delete "${course.title}"? This removes modules, assessments, enrollments, and linked course data.`);
                  if (confirmed) {
                    deleteCourse.mutate({ courseId });
                  }
                }}
              >
                {deleteCourse.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Delete Course
              </Button>
            )}
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-white/12 flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">
            {course.instructor.name?.[0]}
          </div>
          <div>
            <p className="text-sm font-medium">{course.instructor.name}</p>
            <p className="text-xs text-white/60">Instructor</p>
          </div>
        </div>
      </div>

      {(enrollment?.enrolled || isInstructor) && (
        <Card className="border-[#ece8dd] bg-[#fcfaf4]">
          <CardContent className="grid gap-4 py-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryPill
              label="Visible modules"
              value={`${course.pathContext?.visibleModuleCount ?? course.modules.length}/${course.pathContext?.totalModuleCount ?? course.modules.length}`}
            />
            <SummaryPill
              label="Seat time"
              value={course.pathContext?.estimatedMinutes ? formatDuration(course.pathContext.estimatedMinutes) : "Flexible"}
            />
            <SummaryPill
              label="Path type"
              value={customPath ? "Custom cohort path" : "Full course"}
            />
            <SummaryPill
              label="Next action"
              value={nextModule ? nextModule.title : "Review complete"}
            />
          </CardContent>
        </Card>
      )}

      {/* Module path + Assessments */}
      <div className="space-y-6">
        {nextModule && (enrollment?.enrolled || isInstructor) && (
          <Card>
            <CardContent className="py-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Next Up</p>
                <p className="text-base font-semibold text-gray-900 mt-1">{nextModule.title}</p>
                <p className="text-sm text-gray-500 mt-1">
                  {nextModule.prerequisiteModule
                    ? `Unlocked after ${nextModule.prerequisiteModule.title}`
                    : "Ready to start now"}
                  {nextModule.estimatedMinutes ? ` • ${nextModule.estimatedMinutes} min` : ""}
                </p>
              </div>
              <Link href={`/courses/${courseId}/modules/${nextModule.id}`}>
                <Button>{nextModule.completions.length > 0 ? "Review" : "Open module"}</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Module Node Rail */}
        <div>
          <SectionHeader
            title={customPath ? "Assigned Course Path" : "Course Path"}
            description={
              customPath && course.pathContext?.hiddenModuleCount
                ? `${course.pathContext.hiddenModuleCount} module${course.pathContext.hiddenModuleCount === 1 ? "" : "s"} hidden for this cohort path.`
                : "Follow the path in order to keep prerequisites and assessments aligned."
            }
            actions={
              isInstructor ? (
                <>
                  <Link href={`/courses/${courseId}/analytics`}>
                    <Button size="sm" variant="outline">Analytics</Button>
                  </Link>
                  <Link href={`/courses/${courseId}/edit`}>
                    <Button size="sm" variant="outline">Edit Course</Button>
                  </Link>
                  <Link href={`/courses/${courseId}/modules/new`}>
                    <Button size="sm" variant="outline">
                      <Plus className="h-4 w-4" />Add Module
                    </Button>
                  </Link>
                </>
              ) : undefined
            }
            className="mb-4"
          />
          <Card>
            <CardContent className="py-4">
              <VerticalProgressSpine
                modules={course.modules}
                assessments={course.assessments}
                courseId={courseId}
                isEnrolled={enrollment?.enrolled ?? false}
                isInstructor={isInstructor}
              />
            </CardContent>
          </Card>
        </div>

        {/* Assessments quick-access (instructors or enrolled students) */}
        {course.assessments.length > 0 && (
          <div>
            <SectionHeader
              title="Assessments"
              description="Keep assessments close to the learning path so learners can see what is available, upcoming, and already in progress."
              actions={
                isInstructor ? (
                  <Link href={`/courses/${courseId}/assessments/new`}>
                    <Button size="sm" variant="outline">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </Link>
                ) : undefined
              }
              className="mb-3"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {course.assessments.map((a) => (
                <Card key={a.id} className="hover:border-blue-200 transition-colors">
                  <CardContent className="py-4">
                    {(() => {
                      const overview = assessmentOverview?.find((item) => item.id === a.id);
                      const showStudentStatus = role === "STUDENT" && enrollment?.enrolled && overview;
                      const availabilityText = showStudentStatus
                        ? overview.isUpcoming
                          ? `Opens ${formatAvailability(overview.availableFrom)}`
                          : overview.isExpired
                            ? `Closed ${formatAvailability(overview.availableUntil)}`
                            : overview.availableUntil
                              ? `Due ${formatAvailability(overview.availableUntil)}`
                              : "Available now"
                        : a.availableUntil
                          ? `Due ${formatAvailability(a.availableUntil)}`
                          : a.availableFrom
                            ? `Opens ${formatAvailability(a.availableFrom)}`
                            : null;
                      const ctaLabel = showStudentStatus
                        ? overview.hasInProgressAttempt
                          ? "Resume"
                          : overview.isUpcoming
                            ? "Upcoming"
                            : overview.isExpired
                              ? "Closed"
                              : overview.remainingAttempts === 0
                                ? "Review"
                                : "Start"
                        : isInstructor
                          ? "Manage"
                          : "Start";

                      return (
                        <>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{a.title}</p>
                        <div className="flex gap-2 mt-1 flex-wrap">
                          <Badge variant="secondary" className="text-xs">{a.type}</Badge>
                          {a.timeLimit && (
                            <span className="text-xs text-gray-400 flex items-center gap-1">
                              <Clock className="h-3 w-3" />{formatDuration(a.timeLimit)}
                            </span>
                          )}
                          {a.passingScore && (
                            <span className="text-xs text-gray-400">Pass: {a.passingScore}%</span>
                          )}
                          {showStudentStatus && overview.bestScore !== null && (
                            <span className="text-xs text-gray-400">Best: {Math.round(overview.bestScore)}%</span>
                          )}
                        </div>
                        {availabilityText && (
                          <p className="text-xs text-gray-500 mt-2">{availabilityText}</p>
                        )}
                        {showStudentStatus && (
                          <p className="text-xs text-gray-400 mt-1">
                            {overview.remainingAttempts} of {overview.maxAttempts} attempt{overview.maxAttempts === 1 ? "" : "s"} remaining
                          </p>
                        )}
                      </div>
                    </div>
                    {(enrollment?.enrolled || isInstructor) && (
                      <Link href={`/assessments/${a.id}`} className="mt-3 block">
                        <Button
                          size="sm"
                          className="w-full"
                          disabled={Boolean(showStudentStatus && overview && !overview.hasInProgressAttempt && (overview.isUpcoming || overview.isExpired) && overview.remainingAttempts > 0)}
                        >
                          {ctaLabel}
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </Link>
                    )}
                        </>
                      );
                    })()}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#e8dfcb] bg-white px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-[#888888]">{label}</p>
      <p className="mt-2 font-semibold text-[#111111]">{value}</p>
    </div>
  );
}
