import { z } from "zod";
import { createTRPCRouter, protectedProcedure, instructorProcedure } from "@/server/trpc";
import { TRPCError } from "@trpc/server";
import { createNotification } from "./notification";
import { getLearnerCourseAccess } from "@/server/course-access";

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional()
);

const optionalUrlString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional()
);

const optionalCategoryString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(2).max(80).optional()
);

const optionalNumber = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.number().int().positive().max(1440).optional(),
);

const optionalModuleReference = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);

export const courseRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(12),
        search: z.string().optional(),
        status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const skip = (input.page - 1) * input.limit;
      const role = (ctx.session.user as { role: string }).role;
      const userId = ctx.session.user.id;

      const where = {
        ...(role === "STUDENT" ? { status: "PUBLISHED" as const } : {}),
        ...(role === "INSTRUCTOR" ? { instructorId: userId } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.search
          ? {
              OR: [
                { title: { contains: input.search } },
                { description: { contains: input.search } },
              ],
            }
          : {}),
      };

      const [courses, total] = await Promise.all([
        ctx.db.course.findMany({
          skip,
          take: input.limit,
          where,
          orderBy: { createdAt: "desc" },
          include: {
            instructor: { select: { id: true, name: true, image: true } },
            _count: { select: { enrollments: true, modules: true, assessments: true } },
          },
        }),
        ctx.db.course.count({ where }),
      ]);

      return { courses, total, pages: Math.ceil(total / input.limit) };
    }),

  byId: protectedProcedure
    .input(z.object({ courseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const role = (ctx.session.user as { role: string }).role;
      const course = await ctx.db.course.findUnique({
        where: { id: input.courseId },
        include: {
          instructor: { select: { id: true, name: true, image: true, bio: true } },
          modules: {
            orderBy: { order: "asc" },
            include: {
              prerequisiteModule: {
                select: { id: true, title: true, order: true },
              },
              completions: {
                where: { userId: ctx.session.user.id },
                select: { completedAt: true },
              },
            },
          },
          assessments: {
            select: {
              id: true, title: true, type: true, timeLimit: true,
              maxAttempts: true, passingScore: true, availableFrom: true, availableUntil: true,
            },
          },
          _count: { select: { enrollments: true } },
        },
      });
      if (!course) throw new TRPCError({ code: "NOT_FOUND" });

      if (role === "STUDENT") {
        const access = await getLearnerCourseAccess(ctx.db, ctx.session.user.id, input.courseId);
        const visibleModuleIds = access.visibleModuleIds ? new Set(access.visibleModuleIds) : null;
        const visibleModules = visibleModuleIds
          ? course.modules.filter((module) => visibleModuleIds.has(module.id))
          : course.modules;
        const sanitizedModules = visibleModuleIds
          ? visibleModules.map((module) => ({
              ...module,
              prerequisiteModuleId:
                module.prerequisiteModuleId && visibleModuleIds.has(module.prerequisiteModuleId)
                  ? module.prerequisiteModuleId
                  : null,
              prerequisiteModule:
                module.prerequisiteModuleId && visibleModuleIds.has(module.prerequisiteModuleId)
                  ? module.prerequisiteModule
                  : null,
            }))
          : visibleModules;
        const estimatedMinutes = sanitizedModules.reduce(
          (sum, module) => sum + (module.estimatedMinutes ?? 0),
          0,
        );

        return {
          ...course,
          modules: sanitizedModules,
          pathContext: {
            isCustomPath: access.isCustomPath,
            cohortNames: access.cohortNames,
            visibleModuleCount: sanitizedModules.length,
            totalModuleCount: course.modules.length,
            hiddenModuleCount: Math.max(course.modules.length - sanitizedModules.length, 0),
            estimatedMinutes,
          },
        };
      }

      const estimatedMinutes = course.modules.reduce(
        (sum, module) => sum + (module.estimatedMinutes ?? 0),
        0,
      );

      return {
        ...course,
        pathContext: {
          isCustomPath: false,
          cohortNames: [],
          visibleModuleCount: course.modules.length,
          totalModuleCount: course.modules.length,
          hiddenModuleCount: 0,
          estimatedMinutes,
        },
      };
    }),

  create: instructorProcedure
    .input(
      z.object({
        title: z.string().min(3),
        description: optionalNonEmptyString,
        imageUrl: optionalUrlString,
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.course.create({
        data: { ...input, instructorId: ctx.session.user.id },
      });
    }),

  update: instructorProcedure
    .input(
      z.object({
        courseId: z.string(),
        title: z.string().min(3).optional(),
        description: optionalNonEmptyString,
        imageUrl: optionalUrlString,
        status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { courseId, ...data } = input;
      const course = await ctx.db.course.findUnique({ where: { id: courseId } });
      if (!course) throw new TRPCError({ code: "NOT_FOUND" });

      const role = (ctx.session.user as { role: string }).role;
      if (role !== "ADMIN" && course.instructorId !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return ctx.db.course.update({ where: { id: courseId }, data });
    }),

  delete: instructorProcedure
    .input(z.object({ courseId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const course = await ctx.db.course.findUnique({
        where: { id: input.courseId },
        select: { id: true, instructorId: true },
      });
      if (!course) throw new TRPCError({ code: "NOT_FOUND" });

      const role = (ctx.session.user as { role: string }).role;
      if (role !== "ADMIN" && course.instructorId !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const [assessments, enrollments] = await Promise.all([
        ctx.db.assessment.findMany({
          where: { courseId: input.courseId },
          select: { id: true },
        }),
        ctx.db.enrollment.findMany({
          where: { courseId: input.courseId },
          select: { id: true },
        }),
      ]);

      const assessmentIds = assessments.map((assessment) => assessment.id);
      const enrollmentIds = enrollments.map((enrollment) => enrollment.id);

      const attempts = assessmentIds.length
        ? await ctx.db.attempt.findMany({
            where: { assessmentId: { in: assessmentIds } },
            select: { id: true },
          })
        : [];

      const attemptIds = attempts.map((attempt) => attempt.id);

      await ctx.db.$transaction([
        ctx.db.grade.deleteMany({
          where: {
            OR: [
              ...(enrollmentIds.length ? [{ enrollmentId: { in: enrollmentIds } }] : []),
              ...(assessmentIds.length ? [{ assessmentId: { in: assessmentIds } }] : []),
              ...(attemptIds.length ? [{ attemptId: { in: attemptIds } }] : []),
            ],
          },
        }),
        ctx.db.attempt.deleteMany({
          where: assessmentIds.length ? { assessmentId: { in: assessmentIds } } : { id: "__none__" },
        }),
        ctx.db.assessment.deleteMany({ where: { courseId: input.courseId } }),
        ctx.db.enrollment.deleteMany({ where: { courseId: input.courseId } }),
        ctx.db.module.deleteMany({ where: { courseId: input.courseId } }),
        ctx.db.cohortCourse.deleteMany({ where: { courseId: input.courseId } }),
        ctx.db.question.updateMany({
          where: { courseId: input.courseId },
          data: { courseId: null },
        }),
        ctx.db.course.delete({ where: { id: input.courseId } }),
      ]);

      return { success: true };
    }),

  // Module management
  createModule: instructorProcedure
    .input(
      z.object({
        courseId: z.string(),
        category: optionalCategoryString,
        title: z.string().min(2),
        description: optionalNonEmptyString,
        content: optionalNonEmptyString,
        videoUrl: optionalUrlString,
        estimatedMinutes: optionalNumber,
        prerequisiteModuleId: optionalModuleReference,
        order: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const course = await ctx.db.course.findUnique({
        where: { id: input.courseId },
        select: { instructorId: true },
      });
      if (!course) throw new TRPCError({ code: "NOT_FOUND" });

      const role = (ctx.session.user as { role: string }).role;
      if (role !== "ADMIN" && course.instructorId !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const maxOrder = await ctx.db.module.aggregate({
        where: { courseId: input.courseId },
        _max: { order: true },
      });
      const order = input.order ?? (maxOrder._max.order ?? 0) + 1;
      if (input.prerequisiteModuleId) {
        const prerequisite = await ctx.db.module.findFirst({
          where: { id: input.prerequisiteModuleId, courseId: input.courseId },
          select: { id: true },
        });
        if (!prerequisite) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Prerequisite module must belong to this course" });
        }
      }

      return ctx.db.module.create({ data: { ...input, order } });
    }),

  updateModule: instructorProcedure
    .input(
      z.object({
        moduleId: z.string(),
        category: optionalCategoryString,
        title: z.string().min(2).optional(),
        description: optionalNonEmptyString,
        content: optionalNonEmptyString,
        videoUrl: optionalUrlString,
        estimatedMinutes: optionalNumber,
        prerequisiteModuleId: optionalModuleReference,
        order: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { moduleId, ...data } = input;
      const moduleRecord = await ctx.db.module.findUnique({
        where: { id: moduleId },
        include: {
          course: {
            select: { instructorId: true },
          },
        },
      });

      if (!moduleRecord) throw new TRPCError({ code: "NOT_FOUND" });

      const role = (ctx.session.user as { role: string }).role;
      if (role !== "ADMIN" && moduleRecord.course.instructorId !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      if (data.prerequisiteModuleId === moduleId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A module cannot depend on itself" });
      }

      if (data.prerequisiteModuleId) {
        const prerequisite = await ctx.db.module.findFirst({
          where: {
            id: data.prerequisiteModuleId,
            courseId: moduleRecord.courseId,
          },
          select: { id: true },
        });
        if (!prerequisite) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Prerequisite module must belong to this course" });
        }
      }

      return ctx.db.module.update({ where: { id: moduleId }, data });
    }),

  deleteModule: instructorProcedure
    .input(z.object({ moduleId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const moduleRecord = await ctx.db.module.findUnique({
        where: { id: input.moduleId },
        include: {
          course: {
            select: { instructorId: true },
          },
        },
      });

      if (!moduleRecord) throw new TRPCError({ code: "NOT_FOUND" });

      const role = (ctx.session.user as { role: string }).role;
      if (role !== "ADMIN" && moduleRecord.course.instructorId !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      await ctx.db.module.delete({ where: { id: input.moduleId } });
      return { success: true };
    }),

  completeModule: protectedProcedure
    .input(z.object({ moduleId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const moduleRecord = await ctx.db.module.findUnique({
        where: { id: input.moduleId },
        include: {
          course: {
            select: { id: true },
          },
        },
      });

      if (!moduleRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Module not found" });
      }

      const role = (ctx.session.user as { role: string }).role;
      if (role === "STUDENT") {
        const access = await getLearnerCourseAccess(ctx.db, ctx.session.user.id, moduleRecord.course.id);
        if (access.visibleModuleIds && !access.visibleModuleIds.includes(input.moduleId)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "This module is not part of your assigned course path",
          });
        }

        if (moduleRecord.prerequisiteModuleId) {
          const prerequisiteVisible =
            !access.visibleModuleIds || access.visibleModuleIds.includes(moduleRecord.prerequisiteModuleId);

          if (prerequisiteVisible) {
            const prerequisiteComplete = await ctx.db.moduleCompletion.findUnique({
              where: {
                userId_moduleId: {
                  userId: ctx.session.user.id,
                  moduleId: moduleRecord.prerequisiteModuleId,
                },
              },
              select: { id: true },
            });

            if (!prerequisiteComplete) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "Complete the required prerequisite module first",
              });
            }
          }
        }
      }

      return ctx.db.moduleCompletion.upsert({
        where: { userId_moduleId: { userId: ctx.session.user.id, moduleId: input.moduleId } },
        create: { userId: ctx.session.user.id, moduleId: input.moduleId },
        update: {},
      });
    }),

  analytics: instructorProcedure
    .input(z.object({ courseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { courseId } = input;

      const [modules, enrollments] = await Promise.all([
        ctx.db.module.findMany({
          where: { courseId },
          orderBy: { order: "asc" },
          select: { id: true, title: true, order: true },
        }),
        ctx.db.enrollment.findMany({
          where: { courseId, status: { not: "DROPPED" } },
          select: { userId: true, updatedAt: true },
        }),
      ]);

      const enrolledUserIds = enrollments.map((e) => e.userId);
      const totalEnrolled = enrolledUserIds.length;

      // Module completion funnel
      const completionCounts = await Promise.all(
        modules.map((m) =>
          ctx.db.moduleCompletion.count({
            where: { moduleId: m.id, userId: { in: enrolledUserIds } },
          })
        )
      );
      const funnel = modules.map((m, i) => ({
        moduleId: m.id,
        title: m.title,
        order: m.order,
        completed: completionCounts[i],
        pct: totalEnrolled > 0 ? Math.round((completionCounts[i] / totalEnrolled) * 100) : 0,
      }));

      // At-risk: enrolled with no module completion in 14 days
      const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const activeUserIds = await ctx.db.moduleCompletion.findMany({
        where: { moduleId: { in: modules.map((m) => m.id) }, completedAt: { gte: cutoff } },
        select: { userId: true },
      });
      const activeSet = new Set(activeUserIds.map((r) => r.userId));
      const atRiskUserIds = enrolledUserIds.filter((id) => !activeSet.has(id));
      const atRisk = await ctx.db.user.findMany({
        where: { id: { in: atRiskUserIds } },
        select: { id: true, name: true, email: true },
      });

      // Assessment performance summary
      const assessments = await ctx.db.assessment.findMany({
        where: { courseId },
        select: { id: true, title: true, passingScore: true },
      });
      const assessmentStats = await Promise.all(
        assessments.map(async (a) => {
          const attempts = await ctx.db.attempt.findMany({
            where: { assessmentId: a.id, status: { in: ["SUBMITTED", "GRADED"] } },
            select: { percentScore: true, isPassed: true },
          });
          const avg = attempts.length
            ? attempts.reduce((s, at) => s + (at.percentScore ?? 0), 0) / attempts.length
            : null;
          const passRate = attempts.length
            ? attempts.filter((at) => at.isPassed).length / attempts.length
            : null;
          return { id: a.id, title: a.title, attempts: attempts.length, avg, passRate };
        })
      );

      return { funnel, atRisk, assessmentStats, totalEnrolled };
    }),
});
