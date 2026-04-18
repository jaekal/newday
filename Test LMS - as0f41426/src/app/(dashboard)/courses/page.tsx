"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, Plus, Search, Loader2 } from "lucide-react";
import Link from "next/link";

function CourseCard({
  course,
  role,
}: {
  course: {
    id: string;
    title: string;
    description?: string | null;
    status: string;
    _count: { enrollments: number; modules: number };
    instructor: { name?: string | null };
  };
  role: string;
}) {
  const enroll = trpc.enrollment.enroll.useMutation();
  const { data: enrollment, refetch } = trpc.enrollment.isEnrolled.useQuery({ courseId: course.id });
  const initial = course.title[0]?.toUpperCase() ?? "?";

  return (
    <Card className="flex flex-col hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-shadow duration-200">
      {/* Editorial dark thumbnail */}
      <div className="h-36 rounded-t-xl relative overflow-hidden flex-shrink-0" style={{ background: "var(--c-dark)" }}>
        <span
          className="absolute right-3 top-1/2 -translate-y-1/2 font-black text-white select-none leading-none"
          style={{ fontSize: "6rem", opacity: 0.07 }}
        >
          {initial}
        </span>
        <div className="absolute inset-0 flex items-end p-4">
          <p className="text-white font-black text-sm leading-snug line-clamp-2 pr-12">
            {course.title}
          </p>
        </div>
        <div className="absolute top-3 right-3">
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={
              course.status === "PUBLISHED"
                ? { background: "var(--c-accent)", color: "var(--c-accent-fg)" }
                : { background: "rgba(255,255,255,0.15)", color: "white" }
            }
          >
            {course.status}
          </span>
        </div>
      </div>

      <CardHeader className="pb-2">
        <CardTitle className="text-sm line-clamp-1">{course.title}</CardTitle>
        <CardDescription className="line-clamp-2">{course.description}</CardDescription>
      </CardHeader>

      <CardContent className="pb-2">
        <div className="flex items-center gap-3 text-xs text-[#888888]">
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {course._count.enrollments}
          </span>
          <span>{course._count.modules} modules</span>
          <span className="truncate">{course.instructor.name}</span>
        </div>
      </CardContent>

      <CardFooter className="mt-auto gap-2">
        <Link href={`/courses/${course.id}`} className="flex-1">
          <Button variant="outline" size="sm" className="w-full">
            View
          </Button>
        </Link>
        {role === "STUDENT" && !enrollment?.enrolled && course.status === "PUBLISHED" && (
          <Button
            size="sm"
            className="flex-1"
            disabled={enroll.isPending}
            onClick={() => enroll.mutate({ courseId: course.id }, { onSuccess: () => refetch() })}
          >
            {enroll.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            Enroll
          </Button>
        )}
        {role === "STUDENT" && enrollment?.enrolled && (
          <Link href={`/courses/${course.id}`} className="flex-1">
            <Button size="sm" variant="success" className="w-full">
              Continue
            </Button>
          </Link>
        )}
      </CardFooter>
    </Card>
  );
}

export default function CoursesPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? "STUDENT";
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const statusParam = searchParams.get("status");
  const status =
    statusParam === "DRAFT" || statusParam === "PUBLISHED" || statusParam === "ARCHIVED"
      ? statusParam
      : undefined;
  const headingLabel =
    status === "DRAFT"
      ? "Draft Courses"
      : status === "PUBLISHED"
        ? "Published Courses"
        : status === "ARCHIVED"
          ? "Archived Courses"
          : "Courses";
  const emptyStateLabel = status
    ? `No ${status.toLowerCase()} courses found`
    : "No courses found";
  const emptyStateHint = status
    ? "Try a different search term or switch course views"
    : "Try a different search term";

  const { data, isLoading } = trpc.course.list.useQuery({
    search: search || undefined,
    status,
    limit: 20,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-[#111111]">{headingLabel}</h1>
          <p className="text-[#888888] mt-1">
            {data?.total ?? 0} {status ? `${status.toLowerCase()} ` : ""}course{(data?.total ?? 0) === 1 ? "" : "s"} available
          </p>
        </div>
        {(role === "INSTRUCTOR" || role === "ADMIN") && (
          <Link href="/courses/new">
            <Button>
              <Plus className="h-4 w-4" />
              New Course
            </Button>
          </Link>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#888888]" />
        <Input
          placeholder="Search courses…"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-[#111111]" />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {data?.courses.map((course) => (
          <CourseCard key={course.id} course={course} role={role} />
        ))}
      </div>

      {data?.courses.length === 0 && !isLoading && (
        <div className="text-center py-16">
          <p className="text-4xl font-black text-[#e8e8e8] mb-2">{emptyStateLabel}</p>
          <p className="text-[#888888] text-sm">{emptyStateHint}</p>
        </div>
      )}
    </div>
  );
}
