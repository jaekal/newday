"use client";

import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookOpen, ClipboardList, ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";

export default function MyCoursesPage() {
  const { data: enrollments, isLoading } = trpc.enrollment.myEnrollments.useQuery();

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-[#111111]" />
      </div>
    );
  }

  const inProgress = (enrollments ?? []).filter((enrollment) => enrollment.progress < 100);
  const completed = (enrollments ?? []).filter((enrollment) => enrollment.progress >= 100);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Learner workspace"
        title="My Courses"
        description={`${enrollments?.length ?? 0} enrolled path${(enrollments?.length ?? 0) === 1 ? "" : "s"} across active and completed learning.`}
        actions={
          <Link href="/courses">
            <Button variant="outline">Browse More</Button>
          </Link>
        }
      />

      {!enrollments || enrollments.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-5 w-5" />}
          title="Nothing here yet"
          message="Browse available courses and enroll to start building your active learning queue."
          action={
            <Link href="/courses">
              <Button>Browse Courses</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-8">
          <section className="space-y-4">
            <SectionHeader
              title="In Progress"
              description="These are your active paths. The next module and remaining time are surfaced so you can pick back up quickly."
            />
            {inProgress.length === 0 ? (
              <EmptyState
                icon={<ClipboardList className="h-5 w-5" />}
                title="No active courses"
                message="You have completed everything in your current enrollments. Browse the catalog to start a new learning path."
                action={<Link href="/courses"><Button>Find Another Course</Button></Link>}
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {inProgress.map((enrollment) => renderCourseCard(enrollment))}
              </div>
            )}
          </section>

          {completed.length > 0 ? (
            <section className="space-y-4">
              <SectionHeader
                title="Completed"
                description="Finished paths stay visible so learners can review material or track what they have already accomplished."
              />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {completed.map((enrollment) => renderCourseCard(enrollment))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function renderCourseCard(e: {
  id: string;
  courseId: string;
  status: string;
  progress: number;
  enrolledAt: Date | string;
  nextModuleTitle?: string | null;
  accessibleModules: number;
  estimatedMinutesRemaining?: number | null;
  course: {
    title: string;
    instructor: { name: string | null };
    _count: { modules: number; assessments: number };
  };
  pathContext?: {
    isCustomPath: boolean;
    totalModuleCount: number;
    cohortNames: string[];
  };
}) {
  const initial = e.course.title[0]?.toUpperCase() ?? "?";
  const isCompleted = e.progress >= 100;

  return (
    <Card
      key={e.id}
      className="overflow-hidden transition-shadow duration-200 hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)]"
    >
      <CardContent className="space-y-4 pt-0">
        <div className="relative -mx-6 -mt-0 h-36 overflow-hidden" style={{ background: isCompleted ? "linear-gradient(135deg, #0f5132 0%, #083a24 100%)" : "var(--c-dark)" }}>
          <span
            className="absolute right-3 top-1/2 -translate-y-1/2 select-none font-black leading-none text-white"
            style={{ fontSize: "6rem", opacity: 0.07 }}
          >
            {initial}
          </span>
          <div className="absolute inset-0 flex items-end p-4">
            <p className="pr-10 text-sm font-black leading-snug text-white line-clamp-2">
              {e.course.title}
            </p>
          </div>
          <div className="absolute left-3 top-3 flex gap-2">
            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: isCompleted ? "rgba(255,255,255,0.16)" : "var(--c-accent)", color: isCompleted ? "white" : "var(--c-accent-fg)" }}>
              {isCompleted ? "COMPLETED" : e.status}
            </span>
            {e.pathContext?.isCustomPath ? (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white">
                Cohort path
              </span>
            ) : null}
          </div>
          <div className="absolute bottom-3 right-3">
            <svg width="40" height="40" viewBox="0 0 40 40" className="-rotate-90">
              <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
              <circle
                cx="20"
                cy="20"
                r="16"
                fill="none"
                stroke="var(--c-accent)"
                strokeWidth="3"
                strokeDasharray={`${(e.progress / 100) * 100.5} 100.5`}
                strokeLinecap="round"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white rotate-0">
              {e.progress}%
            </span>
          </div>
        </div>

        <div className="space-y-1">
          <p className="font-semibold leading-snug text-[#111111]">{e.course.title}</p>
          <div className="flex items-center justify-between">
            <p className="text-xs text-[#888888]">{e.course.instructor.name}</p>
            <p className="text-xs text-[#888888]">Since {formatDate(e.enrolledAt)}</p>
          </div>
          <p className="text-xs text-[#888888]">
            {isCompleted ? "Path completed. Review any module anytime." : e.nextModuleTitle ? `Next: ${e.nextModuleTitle}` : "Ready for your next session"}
          </p>
          {e.pathContext?.isCustomPath ? (
            <p className="text-xs text-[#888888]">
              Cohort path: {e.accessibleModules} of {e.pathContext.totalModuleCount} modules
              {e.pathContext.cohortNames.length ? ` via ${e.pathContext.cohortNames.join(", ")}` : ""}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-4 text-xs text-[#888888]">
          <span className="flex items-center gap-1">
            <BookOpen className="h-3.5 w-3.5" />
            {e.accessibleModules} of {e.course._count.modules} modules
          </span>
          <span className="flex items-center gap-1">
            <ClipboardList className="h-3.5 w-3.5" />
            {e.course._count.assessments} assessments
          </span>
          {e.estimatedMinutesRemaining ? <span>{e.estimatedMinutesRemaining} min left</span> : null}
        </div>

        <Link href={`/courses/${e.courseId}`} className="block">
          <Button size="sm" className="w-full">
            {isCompleted ? "Review Course" : "Continue"}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
