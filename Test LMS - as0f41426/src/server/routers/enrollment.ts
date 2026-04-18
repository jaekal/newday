import { z } from "zod";
import { createTRPCRouter, protectedProcedure, instructorProcedure } from "@/server/trpc";
import { TRPCError } from "@trpc/server";
import { createNotification } from "./notification";
import { getLearnerCourseAccess } from "@/server/course-access";
import { getNextAvailableModuleId } from "@/lib/module-path";

export const enrollmentRouter = createTRPCRouter({
  enroll: protectedProcedure
    .input(z.object({ courseId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const course = await ctx.db.course.findUnique({
        where: { id: input.courseId },
        include: { instructor: { select: { id: true, name: true } } },
      });
      if (!course || course.status !== "PUBLISHED") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Course not available" });
      }

      const existing = await ctx.db.enrollment.findUnique({
        where: { userId_courseId: { userId: ctx.session.user.id, courseId: input.courseId } },
      });
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Already enrolled" });

      const enrollment = await ctx.db.enrollment.create({
        data: { userId: ctx.session.user.id, courseId: input.courseId },
      });

      // Notify the instructor
      const student = await ctx.db.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { name: true },
      });
      await createNotification(
        ctx.db,
        course.instructorId,
        "ENROLLMENT",
        `New enrollment in ${course.title}`,
        `${student?.name ?? "A student"} just enrolled`,
        `/courses/${input.courseId}`,
      );

      return enrollment;
    }),

  drop: protectedProcedure
    .input(z.object({ courseId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.enrollment.update({
        where: { userId_courseId: { userId: ctx.session.user.id, courseId: input.courseId } },
        data: { status: "DROPPED" },
      });
    }),

  myEnrollments: protectedProcedure.query(async ({ ctx }) => {
    const enrollments = await ctx.db.enrollment.findMany({
      where: { userId: ctx.session.user.id, status: { not: "DROPPED" } },
      include: {
        course: {
          include: {
            instructor: { select: { id: true, name: true } },
            _count: { select: { modules: true, assessments: true } },
            modules: {
              select: { id: true, title: true, estimatedMinutes: true, prerequisiteModuleId: true },
              orderBy: { order: "asc" },
            },
          },
        },
      },
      orderBy: { enrolledAt: "desc" },
    });

    // Attach per-course completion %
    const withProgress = await Promise.all(
      enrollments.map(async (e) => {
        const access = await getLearnerCourseAccess(ctx.db, ctx.session.user.id, e.courseId);
        const accessibleModuleIds = access.visibleModuleIds ?? e.course.modules.map((m) => m.id);
        const accessibleModuleSet = new Set(accessibleModuleIds);
        const accessibleModules = e.course.modules
          .filter((module) => accessibleModuleSet.has(module.id))
          .map((module) => ({
            ...module,
            prerequisiteModuleId:
              module.prerequisiteModuleId && accessibleModuleSet.has(module.prerequisiteModuleId)
                ? module.prerequisiteModuleId
                : null,
          }));
        const completed = accessibleModuleIds.length
          ? await ctx.db.moduleCompletion.count({
              where: { userId: ctx.session.user.id, moduleId: { in: accessibleModuleIds } },
            })
          : 0;
        const total = accessibleModuleIds.length;
        const completionRows = accessibleModuleIds.length
          ? await ctx.db.moduleCompletion.findMany({
              where: { userId: ctx.session.user.id, moduleId: { in: accessibleModuleIds } },
              select: { moduleId: true },
            })
          : [];
        const completedSet = new Set(completionRows.map((row) => row.moduleId));
        const nextModuleId = getNextAvailableModuleId(
          accessibleModules.map((module) => ({
            ...module,
            completions: completedSet.has(module.id) ? [{ completedAt: new Date() }] : [],
          })),
        );
        const nextModule = nextModuleId
          ? accessibleModules.find((module) => module.id === nextModuleId)
          : null;
        return {
          ...e,
          progress: total > 0 ? Math.round((completed / total) * 100) : 0,
          completedModules: completed,
          accessibleModules: total,
          nextModuleTitle: nextModule?.title ?? null,
          estimatedMinutesRemaining: accessibleModules
            .filter((module) => !completedSet.has(module.id))
            .reduce((sum, module) => sum + (module.estimatedMinutes ?? 0), 0),
          pathContext: {
            isCustomPath: access.isCustomPath,
            cohortNames: access.cohortNames,
            totalModuleCount: e.course._count.modules,
          },
        };
      }),
    );

    return withProgress;
  }),

  roster: instructorProcedure
    .input(z.object({ courseId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.enrollment.findMany({
        where: { courseId: input.courseId },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { enrolledAt: "desc" },
      });
    }),

  isEnrolled: protectedProcedure
    .input(z.object({ courseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const enrollment = await ctx.db.enrollment.findUnique({
        where: { userId_courseId: { userId: ctx.session.user.id, courseId: input.courseId } },
      });
      return { enrolled: enrollment?.status === "ACTIVE" || enrollment?.status === "COMPLETED" };
    }),
});
