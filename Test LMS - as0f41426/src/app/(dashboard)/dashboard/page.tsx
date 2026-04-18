"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ArrowRight, BarChart3, BookOpen, GraduationCap, Play, Target, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SkillRadarChart } from "@/components/ui/skill-radar";
import { MomentumRing } from "@/components/ui/momentum-ring";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";

type CourseAxis = {
  courseId: string;
  title: string;
  progress: number;
  totalModules: number;
  completedModules: number;
  recentlyActive: boolean;
  nextModuleId?: string | null;
  nextModuleTitle?: string | null;
  estimatedMinutesRemaining?: number;
};

export default function DashboardPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? "STUDENT";
  const [skillGapCourse, setSkillGapCourse] = useState<CourseAxis | null>(null);

  const { data: enrollments } = trpc.enrollment.myEnrollments.useQuery(undefined, {
    enabled: role === "STUDENT",
  });
  const { data: courseProgress } = trpc.activity.courseProgress.useQuery(undefined, {
    enabled: role === "STUDENT",
  });
  const { data: streakData } = trpc.activity.streak.useQuery(undefined, {
    enabled: role === "STUDENT",
  });
  const { data: courses } = trpc.course.list.useQuery(
    { limit: 5 },
    { enabled: role !== "STUDENT" },
  );
  const continueCourse = (courseProgress ?? []).find((course) => course.progress < 100) ?? null;
  const atRiskCourses = (courseProgress ?? []).filter((course) => course.progress < 50 && !course.recentlyActive);
  const completedCourses = (courseProgress ?? []).filter((course) => course.progress >= 100);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={role === "STUDENT" ? "Learner workspace" : "Training operations"}
        title={`Welcome back, ${session?.user?.name?.split(" ")[0] ?? "there"}`}
        description={
          role === "STUDENT"
            ? "Use this workspace to pick up the next module quickly, review momentum, and keep your active paths visible."
            : "Use this overview to monitor your course footprint and jump into the workflows that matter most."
        }
        actions={
          role === "STUDENT" ? (
            <Link href="/my-courses">
              <Button variant="outline">Open My Courses</Button>
            </Link>
          ) : (
            <>
              <Link href="/reports">
                <Button variant="outline">Reports</Button>
              </Link>
              <Link href="/courses/new">
                <Button>Create Course</Button>
              </Link>
            </>
          )
        }
      />

      {role === "STUDENT" && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <SummaryCard
              label="Continue"
              value={continueCourse?.nextModuleTitle ?? "Pick a course"}
              description={continueCourse ? continueCourse.title : "No active module yet"}
              icon={<Play className="h-5 w-5" />}
            />
            <SummaryCard
              label="At Risk"
              value={atRiskCourses.length}
              description={atRiskCourses.length ? "Courses need attention this week" : "No courses need recovery right now"}
              icon={<AlertTriangle className="h-5 w-5" />}
              tone={atRiskCourses.length ? "warn" : "default"}
            />
            <SummaryCard
              label="Completed"
              value={completedCourses.length}
              description="Finished learning paths in your current enrollment"
              icon={<Target className="h-5 w-5" />}
            />
          </div>
          {/* Dark cards for data viz — Midnight Atlas treatment */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 border-transparent shadow-[0_4px_24px_rgba(0,0,0,0.15)]" style={{ background: "var(--c-dark)" }}>
              <CardHeader>
                <CardTitle className="text-base text-white">Skill Web</CardTitle>
                <p className="text-xs text-white/30">
                  Progress across enrolled courses — click any node to explore gaps
                </p>
              </CardHeader>
              <CardContent className="pb-6">
                <SkillRadarChart
                  courses={courseProgress ?? []}
                  variant="dark"
                  className="mx-auto"
                  onNodeClick={(c) => setSkillGapCourse(c)}
                />
              </CardContent>
            </Card>

            <Card className="border-transparent shadow-[0_4px_24px_rgba(0,0,0,0.15)]" style={{ background: "var(--c-dark)" }}>
              <CardHeader>
                <CardTitle className="text-base text-white">Momentum</CardTitle>
                <p className="text-xs text-white/30">Study streak &amp; daily goal</p>
              </CardHeader>
              <CardContent className="flex items-center justify-center py-4">
                {streakData ? (
                  <MomentumRing data={streakData} variant="dark" />
                ) : (
                  <div className="h-36 w-36 rounded-full bg-white/5 animate-pulse" />
                )}
              </CardContent>
            </Card>
          </div>

          {/* Course list */}
          <Card>
            <CardHeader>
              <SectionHeader
                title="My Courses"
                description="The fastest way back into your work. Prioritize the next module and keep active paths moving."
              />
            </CardHeader>
            <CardContent>
              {enrollments?.length === 0 && (
                <EmptyState
                  icon={<BookOpen className="h-5 w-5" />}
                  title="No courses yet"
                  message="Browse the catalog and enroll to start building your active learning queue."
                  action={
                    <Link href="/courses">
                      <Button>Browse courses</Button>
                    </Link>
                  }
                />
              )}
              <div className="space-y-1">
                {enrollments?.slice(0, 6).map((e) => {
                  const prog = courseProgress?.find((p) => p.courseId === e.courseId);
                  return (
                    <Link
                      key={e.id}
                      href={`/courses/${e.courseId}`}
                      className="flex items-center gap-3 hover:bg-[#f4f4f4] rounded-lg p-2.5 -mx-2 transition-colors"
                    >
                      <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--c-dark)" }}>
                        <span className="text-white font-black text-xs">
                          {e.course.title[0]?.toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#111111] truncate">
                          {e.course.title}
                        </p>
                        <p className="text-xs text-[#888888]">
                          {prog?.nextModuleTitle
                            ? `Next: ${prog.nextModuleTitle}`
                            : e.course.instructor.name}
                        </p>
                      </div>
                      {prog && (
                        <div className="text-right shrink-0">
                          <span className="text-xs font-bold text-[#111111]">{prog.progress}%</span>
                          <p className="text-xs text-[#888888]">
                            {prog.completedModules}/{prog.totalModules}
                          </p>
                          {prog.estimatedMinutesRemaining ? (
                            <p className="text-[11px] text-[#b0b0b0]">{prog.estimatedMinutesRemaining} min left</p>
                          ) : null}
                        </div>
                      )}
                      {prog?.recentlyActive && (
                        <div className="h-2 w-2 rounded-full shrink-0" style={{ background: "var(--c-accent)" }} title="Active this week" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {role !== "STUDENT" && (
        <>
          <Card className="border-[#ece8dd] bg-[#fcfaf4]">
            <CardContent className="flex flex-col gap-4 pt-6 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold text-[#111111]">Operations shortcuts</p>
                <p className="mt-1 text-sm text-[#888888]">
                  Use the dashboard as a launch point into reporting, cohort orchestration, and catalog updates.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link href="/reports">
                  <Button variant="outline">
                    <BarChart3 className="h-4 w-4" />
                    Open Reports
                  </Button>
                </Link>
                <Link href="/admin/cohorts">
                  <Button variant="outline">Manage Cohorts</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ background: "var(--c-dark)" }}>
                    <BookOpen className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="text-2xl font-black">{courses?.total ?? 0}</p>
                    <p className="text-sm text-[#888888]">My Courses</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ background: "var(--c-accent)" }}>
                    <GraduationCap className="h-5 w-5" style={{ color: "var(--c-accent-fg)" }} />
                  </div>
                  <div>
                    <p className="text-2xl font-black">
                      {courses?.courses.reduce((s, c) => s + c._count.enrollments, 0) ?? 0}
                    </p>
                    <p className="text-sm text-[#888888]">Total Enrollments</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <SectionHeader
                title="My Courses"
                description="Keep status, enrollment volume, and the quickest next action visible in one list."
              />
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {courses?.courses.map((c) => (
                  <Link
                    key={c.id}
                    href={`/courses/${c.id}`}
                    className="flex items-center gap-3 hover:bg-[#f4f4f4] rounded-lg p-2.5 -mx-2 transition-colors"
                  >
                    <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--c-dark)" }}>
                      <span className="text-white font-black text-xs">{c.title[0]?.toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[#111111] text-sm truncate">{c.title}</p>
                      <p className="text-xs text-[#888888]">
                        {c._count.enrollments} students · {c._count.assessments} assessments
                      </p>
                    </div>
                    <Badge variant={c.status === "PUBLISHED" ? "success" : "secondary"}>
                      {c.status}
                    </Badge>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
      {/* Skill Gap Panel — slide in from right */}
      {skillGapCourse && (
        <SkillGapPanel
          course={skillGapCourse}
          onClose={() => setSkillGapCourse(null)}
        />
      )}
    </div>
  );
}

// ─── Skill Gap Panel ─────────────────────────────────────────────────────────

function SkillGapPanel({
  course,
  onClose,
}: {
  course: CourseAxis;
  onClose: () => void;
}) {
  const { data: courseData } = trpc.course.byId.useQuery({ courseId: course.courseId });
  const incompleteModules = courseData?.modules.filter((m) => m.completions.length === 0) ?? [];
  const completedCount = courseData ? courseData.modules.length - incompleteModules.length : course.completedModules;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" />

      {/* Panel */}
      <div
        className="relative w-80 h-full shadow-2xl flex flex-col overflow-y-auto"
        style={{ background: "var(--c-dark)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-white/10">
          <div>
            <p className="text-xs text-white/40 uppercase tracking-widest mb-1">Skill Gap</p>
            <h3 className="font-bold text-white leading-snug">{course.title}</h3>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors mt-0.5">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Progress ring summary */}
        <div className="px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="relative h-14 w-14 shrink-0">
              <svg viewBox="0 0 48 48" className="h-14 w-14 -rotate-90">
                <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
                <circle
                  cx="24" cy="24" r="20" fill="none"
                  stroke="var(--c-accent)" strokeWidth="4"
                  strokeDasharray={`${course.progress * 1.257} 125.7`}
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
                {course.progress}%
              </span>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{completedCount} of {course.totalModules} modules</p>
              <p className="text-xs text-white/40 mt-0.5">{course.recentlyActive ? "Active this week" : "Not active recently"}</p>
            </div>
          </div>
        </div>

        {/* Incomplete modules */}
        <div className="flex-1 p-5 space-y-2">
          <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">
            Remaining ({incompleteModules.length})
          </p>
          {incompleteModules.length === 0 && (
            <p className="text-xs text-white/30 text-center py-6">All modules complete!</p>
          )}
          {incompleteModules.map((m) => (
            <Link
              key={m.id}
              href={`/courses/${course.courseId}/modules/${m.id}`}
              onClick={onClose}
              className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors group"
            >
              <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-white/50">{m.order}</span>
              </div>
              <p className="flex-1 text-sm text-white/80 group-hover:text-white transition-colors truncate">{m.title}</p>
              <Play className="h-3.5 w-3.5 text-white/20 group-hover:text-white/60 shrink-0 transition-colors" />
            </Link>
          ))}
        </div>

        {/* CTA */}
        <div className="p-5 border-t border-white/10">
          <Link href={`/courses/${course.courseId}`} onClick={onClose}>
            <Button className="w-full">
              Go to Course <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  description,
  icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  description: string;
  icon: React.ReactNode;
  tone?: "default" | "warn";
}) {
  return (
    <Card className={tone === "warn" ? "border-amber-300 bg-amber-50/60" : ""}>
      <CardContent className="pt-6">
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone === "warn" ? "bg-amber-100 text-amber-700" : "bg-[#f4f4f4] text-[#111111]"}`}>
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#888888]">{label}</p>
            <p className="mt-1 truncate text-lg font-bold text-[#111111]">{value}</p>
            <p className="mt-1 text-xs text-[#888888]">{description}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
