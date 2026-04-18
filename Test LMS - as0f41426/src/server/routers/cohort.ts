import { z } from "zod";
import { createTRPCRouter, adminProcedure } from "@/server/trpc";
import { TRPCError } from "@trpc/server";
import { createNotification } from "./notification";

async function assertCourseModules(
  ctx: { db: typeof import("@/lib/db").db },
  courseId: string,
  moduleIds: string[],
) {
  if (!moduleIds.length) return;

  const modules = await ctx.db.module.findMany({
    where: { courseId, id: { in: moduleIds } },
    select: { id: true },
  });

  if (modules.length !== moduleIds.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "One or more selected modules do not belong to this course",
    });
  }

  const moduleSet = new Set(moduleIds);
  const modulesWithPrerequisites = await ctx.db.module.findMany({
    where: {
      courseId,
      id: { in: moduleIds },
      prerequisiteModuleId: { not: null },
    },
    select: {
      title: true,
      prerequisiteModuleId: true,
      prerequisiteModule: { select: { title: true } },
    },
  });

  const invalidPrerequisite = modulesWithPrerequisites.find(
    (module) =>
      module.prerequisiteModuleId && !moduleSet.has(module.prerequisiteModuleId),
  );

  if (invalidPrerequisite?.prerequisiteModuleId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Include "${invalidPrerequisite.prerequisiteModule?.title ?? "its prerequisite"}" before assigning "${invalidPrerequisite.title}" to a cohort path`,
    });
  }
}

export const cohortRouter = createTRPCRouter({
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.cohort.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { memberships: true, courses: true } },
      },
    });
  }),

  byId: adminProcedure
    .input(z.object({ cohortId: z.string() }))
    .query(async ({ ctx, input }) => {
      const cohort = await ctx.db.cohort.findUnique({
        where: { id: input.cohortId },
        include: {
          memberships: {
            include: { user: { select: { id: true, name: true, email: true, employeeId: true, role: true } } },
            orderBy: { joinedAt: "asc" },
          },
          courses: {
            include: {
              course: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  _count: { select: { enrollments: true, modules: true } },
                },
              },
              moduleSelections: {
                include: {
                  module: {
                    select: { id: true, title: true, order: true, category: true },
                  },
                },
              },
            },
            orderBy: { addedAt: "asc" },
          },
        },
      });
      if (!cohort) throw new TRPCError({ code: "NOT_FOUND" });
      return cohort;
    }),

  create: adminProcedure
    .input(z.object({ name: z.string().min(2), description: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.cohort.create({ data: input });
    }),

  update: adminProcedure
    .input(z.object({ cohortId: z.string(), name: z.string().min(2).optional(), description: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { cohortId, ...data } = input;
      return ctx.db.cohort.update({ where: { id: cohortId }, data });
    }),

  delete: adminProcedure
    .input(z.object({ cohortId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.cohort.delete({ where: { id: input.cohortId } });
      return { success: true };
    }),

  addMembers: adminProcedure
    .input(z.object({ cohortId: z.string(), userIds: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const cohort = await ctx.db.cohort.findUnique({
        where: { id: input.cohortId },
        include: { courses: { select: { courseId: true } } },
      });
      if (!cohort) throw new TRPCError({ code: "NOT_FOUND" });

      let added = 0;
      for (const userId of input.userIds) {
        try {
          await ctx.db.cohortMembership.create({ data: { cohortId: input.cohortId, userId } });
          added++;
          // Enroll in all cohort courses
          for (const { courseId } of cohort.courses) {
            const existing = await ctx.db.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } } });
            if (!existing) {
              await ctx.db.enrollment.create({ data: { userId, courseId } });
              await createNotification(ctx.db, userId, "ENROLLMENT", "You've been enrolled in a new course", undefined, `/courses/${courseId}`);
            }
          }
        } catch { /* duplicate membership — skip */ }
      }
      return { added };
    }),

  removeMembers: adminProcedure
    .input(z.object({ cohortId: z.string(), userIds: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.cohortMembership.deleteMany({
        where: { cohortId: input.cohortId, userId: { in: input.userIds } },
      });
      return { removed: result.count };
    }),

  addCourse: adminProcedure
    .input(
      z.object({
        cohortId: z.string(),
        courseId: z.string(),
        moduleIds: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.cohortCourse.findUnique({
        where: { cohortId_courseId: { cohortId: input.cohortId, courseId: input.courseId } },
      });
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Course already in cohort" });

      const moduleIds = Array.from(new Set(input.moduleIds ?? []));
      await assertCourseModules(ctx, input.courseId, moduleIds);

      await ctx.db.cohortCourse.create({
        data: {
          cohortId: input.cohortId,
          courseId: input.courseId,
          moduleSelections: moduleIds.length
            ? {
                create: moduleIds.map((moduleId) => ({ moduleId })),
              }
            : undefined,
        },
      });

      // Enroll all existing members
      const members = await ctx.db.cohortMembership.findMany({
        where: { cohortId: input.cohortId },
        select: { userId: true },
      });
      for (const { userId } of members) {
        const enrolled = await ctx.db.enrollment.findUnique({
          where: { userId_courseId: { userId, courseId: input.courseId } },
        });
        if (!enrolled) {
          await ctx.db.enrollment.create({ data: { userId, courseId: input.courseId } });
          await createNotification(ctx.db, userId, "ENROLLMENT", "You've been enrolled in a new course", undefined, `/courses/${input.courseId}`);
        }
      }
      return { success: true };
    }),

  updateCoursePath: adminProcedure
    .input(
      z.object({
        cohortId: z.string(),
        courseId: z.string(),
        moduleIds: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cohortCourse = await ctx.db.cohortCourse.findUnique({
        where: { cohortId_courseId: { cohortId: input.cohortId, courseId: input.courseId } },
        select: { id: true },
      });
      if (!cohortCourse) throw new TRPCError({ code: "NOT_FOUND", message: "Course assignment not found" });

      const moduleIds = Array.from(new Set(input.moduleIds ?? []));
      await assertCourseModules(ctx, input.courseId, moduleIds);

      await ctx.db.$transaction([
        ctx.db.cohortCourseModule.deleteMany({
          where: { cohortCourseId: cohortCourse.id },
        }),
        ...(moduleIds.length
          ? [
              ctx.db.cohortCourse.update({
                where: { id: cohortCourse.id },
                data: {
                  moduleSelections: {
                    create: moduleIds.map((moduleId) => ({ moduleId })),
                  },
                },
              }),
            ]
          : []),
      ]);

      return { success: true };
    }),

  removeCourse: adminProcedure
    .input(z.object({ cohortId: z.string(), courseId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.cohortCourse.delete({
        where: { cohortId_courseId: { cohortId: input.cohortId, courseId: input.courseId } },
      });
      return { success: true };
    }),
});
