import { z } from "zod";
import { createTRPCRouter, publicProcedure, protectedProcedure, adminProcedure } from "@/server/trpc";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";

const roleEnum = z.enum(["STUDENT", "INSTRUCTOR", "MANAGER", "ADMIN"]);
const userStatusEnum = z.enum(["ACTIVE", "INACTIVE"]);
const userSortByEnum = z.enum(["name", "email", "role", "status", "createdAt"]);
const userSortDirEnum = z.enum(["asc", "desc"]);

function isManagerRole(role: string) {
  return role === "MANAGER";
}

function assertManagerCannotTouchAdmin(
  actingRole: string,
  targetRole: string | null | undefined,
  actionMessage = "Managers cannot modify admin accounts",
) {
  if (isManagerRole(actingRole) && targetRole === "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: actionMessage });
  }
}

function assertManagerCannotAssignAdmin(actingRole: string, nextRole: string | null | undefined) {
  if (isManagerRole(actingRole) && nextRole === "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Managers cannot assign the admin role" });
  }
}

export const userRouter = createTRPCRouter({
  register: publicProcedure
    .input(z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(6) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.user.findUnique({ where: { email: input.email } });
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Email already registered" });
      const passwordHash = await bcrypt.hash(input.password, 12);
      return ctx.db.user.create({
        data: { name: input.name, email: input.email, passwordHash },
        select: { id: true, email: true, name: true, role: true },
      });
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { id: true, name: true, email: true, role: true, isActive: true, image: true, bio: true, createdAt: true },
    });
  }),

  updateProfile: protectedProcedure
    .input(z.object({ name: z.string().min(2).optional(), bio: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.user.update({
        where: { id: ctx.session.user.id },
        data: input,
        select: { id: true, name: true, bio: true },
      });
    }),

  list: adminProcedure
    .input(z.object({
      page: z.number().default(1),
      limit: z.number().default(20),
      search: z.string().optional(),
      role: roleEnum.optional(),
      status: userStatusEnum.optional(),
      sortBy: userSortByEnum.default("createdAt"),
      sortDir: userSortDirEnum.default("desc"),
    }))
    .query(async ({ ctx, input }) => {
      const skip = (input.page - 1) * input.limit;
      const where = input.search
        ? {
            OR: [
              { name: { contains: input.search, mode: "insensitive" as const } },
              { email: { contains: input.search, mode: "insensitive" as const } },
              { employeeId: { contains: input.search, mode: "insensitive" as const } },
            ],
            ...(input.role ? { role: input.role } : {}),
            ...(input.status ? { isActive: input.status === "ACTIVE" } : {}),
          }
        : {
            ...(input.role ? { role: input.role } : {}),
            ...(input.status ? { isActive: input.status === "ACTIVE" } : {}),
          };

      const orderBy =
        input.sortBy === "status"
          ? { isActive: input.sortDir }
          : { [input.sortBy]: input.sortDir };
      const [users, total] = await Promise.all([
        ctx.db.user.findMany({
          skip,
          take: input.limit,
          where,
          orderBy,
          select: { id: true, name: true, email: true, employeeId: true, role: true, isActive: true, createdAt: true },
        }),
        ctx.db.user.count({ where }),
      ]);
      return { users, total, pages: Math.ceil(total / input.limit) };
    }),

  updateRole: adminProcedure
    .input(z.object({ userId: z.string(), role: roleEnum }))
    .mutation(async ({ ctx, input }) => {
      const actingRole = ctx.session.user.role;
      const targetUser = await ctx.db.user.findUnique({
        where: { id: input.userId },
        select: { role: true },
      });
      if (!targetUser) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      assertManagerCannotTouchAdmin(actingRole, targetUser.role);
      assertManagerCannotAssignAdmin(actingRole, input.role);
      return ctx.db.user.update({
        where: { id: input.userId },
        data: { role: input.role },
        select: { id: true, role: true },
      });
    }),

  createUser: adminProcedure
    .input(z.object({
      name: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(6),
      role: roleEnum.default("STUDENT"),
      employeeId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertManagerCannotAssignAdmin(ctx.session.user.role, input.role);
      const existing = await ctx.db.user.findUnique({ where: { email: input.email } });
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Email already registered" });
      if (input.employeeId) {
        const empExists = await ctx.db.user.findUnique({ where: { employeeId: input.employeeId } });
        if (empExists) throw new TRPCError({ code: "CONFLICT", message: "Employee ID already in use" });
      }
      const passwordHash = await bcrypt.hash(input.password, 12);
      return ctx.db.user.create({
        data: {
          name: input.name,
          email: input.email,
          employeeId: input.employeeId || null,
          role: input.role,
          passwordHash,
        },
        select: { id: true, name: true, email: true, employeeId: true, role: true, createdAt: true },
      });
    }),

  updateUser: adminProcedure
    .input(z.object({
      userId: z.string(),
      name: z.string().min(2).optional(),
      email: z.string().email().optional(),
      role: roleEnum.optional(),
      employeeId: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { userId, ...data } = input;
      const actingRole = ctx.session.user.role;
      const targetUser = await ctx.db.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (!targetUser) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      assertManagerCannotTouchAdmin(actingRole, targetUser.role);
      assertManagerCannotAssignAdmin(actingRole, data.role);
      if (data.email) {
        const conflict = await ctx.db.user.findFirst({
          where: { email: data.email, NOT: { id: userId } },
        });
        if (conflict) throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });
      }
      if (data.employeeId) {
        const conflict = await ctx.db.user.findFirst({
          where: { employeeId: data.employeeId, NOT: { id: userId } },
        });
        if (conflict) throw new TRPCError({ code: "CONFLICT", message: "Employee ID already in use" });
      }
      return ctx.db.user.update({
        where: { id: userId },
        data,
        select: { id: true, name: true, email: true, employeeId: true, role: true, isActive: true, createdAt: true },
      });
    }),

  setActive: adminProcedure
    .input(z.object({ userId: z.string(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You can't change your own active status" });
      }
      const targetUser = await ctx.db.user.findUnique({
        where: { id: input.userId },
        select: { role: true },
      });
      if (!targetUser) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      assertManagerCannotTouchAdmin(ctx.session.user.role, targetUser.role);

      return ctx.db.user.update({
        where: { id: input.userId },
        data: { isActive: input.isActive },
        select: { id: true, isActive: true, name: true, email: true },
      });
    }),

  deleteUser: adminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.session.user.role === "MANAGER") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Managers cannot delete users" });
      }
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You can't delete your own account" });
      }

      const user = await ctx.db.user.findUnique({ where: { id: input.userId }, select: { id: true, role: true } });

      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      const courseIds = (
        await ctx.db.course.findMany({
          where: { instructorId: input.userId },
          select: { id: true },
        })
      ).map((course) => course.id);

      const assessmentIds = courseIds.length
        ? (
            await ctx.db.assessment.findMany({
              where: { courseId: { in: courseIds } },
              select: { id: true },
            })
          ).map((assessment) => assessment.id)
        : [];

      const attemptIdsForCourses = assessmentIds.length
        ? (
            await ctx.db.attempt.findMany({
              where: { assessmentId: { in: assessmentIds } },
              select: { id: true },
            })
          ).map((attempt) => attempt.id)
        : [];

      const enrollmentIdsForCourses = courseIds.length
        ? (
            await ctx.db.enrollment.findMany({
              where: { courseId: { in: courseIds } },
              select: { id: true },
            })
          ).map((enrollment) => enrollment.id)
        : [];

      const questionIdsForCourses = courseIds.length
        ? (
            await ctx.db.question.findMany({
              where: { courseId: { in: courseIds } },
              select: { id: true },
            })
          ).map((question) => question.id)
        : [];

      const authoredQuestionIds = (
        await ctx.db.question.findMany({
          where: { authorId: input.userId },
          select: { id: true },
        })
      ).map((question) => question.id);

      const questionIdsToDelete = [...new Set([...questionIdsForCourses, ...authoredQuestionIds])];

      const userAttemptIds = (
        await ctx.db.attempt.findMany({
          where: { userId: input.userId },
          select: { id: true },
        })
      ).map((attempt) => attempt.id);

      const attemptIdsToDelete = [...new Set([...attemptIdsForCourses, ...userAttemptIds])];

      const userEnrollmentIds = (
        await ctx.db.enrollment.findMany({
          where: { userId: input.userId },
          select: { id: true },
        })
      ).map((enrollment) => enrollment.id);

      const enrollmentIdsToDelete = [...new Set([...enrollmentIdsForCourses, ...userEnrollmentIds])];

      await ctx.db.$transaction([
        ...(attemptIdsToDelete.length
          ? [ctx.db.attemptResponse.deleteMany({ where: { attemptId: { in: attemptIdsToDelete } } })]
          : []),
        ...(questionIdsToDelete.length
          ? [
              ctx.db.attemptResponse.deleteMany({ where: { questionId: { in: questionIdsToDelete } } }),
              ctx.db.assessmentQuestion.deleteMany({ where: { questionId: { in: questionIdsToDelete } } }),
            ]
          : []),
        ...(enrollmentIdsToDelete.length
          ? [ctx.db.grade.deleteMany({ where: { enrollmentId: { in: enrollmentIdsToDelete } } })]
          : []),
        ...(attemptIdsToDelete.length
          ? [ctx.db.grade.deleteMany({ where: { attemptId: { in: attemptIdsToDelete } } })]
          : []),
        ctx.db.grade.deleteMany({ where: { userId: input.userId } }),
        ctx.db.moduleCompletion.deleteMany({ where: { userId: input.userId } }),
        ctx.db.cohortMembership.deleteMany({ where: { userId: input.userId } }),
        ctx.db.notification.deleteMany({ where: { userId: input.userId } }),
        ...(attemptIdsToDelete.length
          ? [ctx.db.attempt.deleteMany({ where: { id: { in: attemptIdsToDelete } } })]
          : []),
        ...(assessmentIds.length
          ? [ctx.db.assessment.deleteMany({ where: { id: { in: assessmentIds } } })]
          : []),
        ...(enrollmentIdsToDelete.length
          ? [ctx.db.enrollment.deleteMany({ where: { id: { in: enrollmentIdsToDelete } } })]
          : []),
        ...(questionIdsToDelete.length
          ? [ctx.db.question.deleteMany({ where: { id: { in: questionIdsToDelete } } })]
          : []),
        ...(courseIds.length
          ? [ctx.db.course.deleteMany({ where: { id: { in: courseIds } } })]
          : []),
        ctx.db.account.deleteMany({ where: { userId: input.userId } }),
        ctx.db.session.deleteMany({ where: { userId: input.userId } }),
        ctx.db.user.delete({ where: { id: input.userId } }),
      ]);

      return { success: true };
    }),

  resetPassword: adminProcedure
    .input(z.object({ userId: z.string(), newPassword: z.string().min(6) }))
    .mutation(async ({ ctx, input }) => {
      const targetUser = await ctx.db.user.findUnique({
        where: { id: input.userId },
        select: { role: true },
      });
      if (!targetUser) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      assertManagerCannotTouchAdmin(ctx.session.user.role, targetUser.role);
      const passwordHash = await bcrypt.hash(input.newPassword, 12);
      await ctx.db.user.update({
        where: { id: input.userId },
        data: { passwordHash },
      });
      return { success: true };
    }),

  bulkUpdateRole: adminProcedure
    .input(z.object({ userIds: z.array(z.string()).min(1), role: roleEnum }))
    .mutation(async ({ ctx, input }) => {
      assertManagerCannotAssignAdmin(ctx.session.user.role, input.role);
      if (ctx.session.user.role === "MANAGER") {
        const adminCount = await ctx.db.user.count({
          where: { id: { in: input.userIds }, role: "ADMIN" },
        });
        if (adminCount > 0) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Managers cannot modify admin accounts" });
        }
      }
      const result = await ctx.db.user.updateMany({
        where: { id: { in: input.userIds } },
        data: { role: input.role },
      });
      return { updated: result.count };
    }),

  bulkImport: adminProcedure
    .input(z.object({
      users: z.array(z.object({
        name: z.string().min(1),
        email: z.string().email(),
        password: z.string().min(6),
        role: roleEnum.default("STUDENT"),
        employeeId: z.string().optional(),
      })).min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const results = { created: 0, updated: 0, errors: [] as { email: string; error: string }[] };

      for (const u of input.users) {
        try {
          assertManagerCannotAssignAdmin(ctx.session.user.role, u.role);
          const passwordHash = await bcrypt.hash(u.password, 12);
          const existing = await ctx.db.user.findUnique({ where: { email: u.email } });
          if (existing) {
            assertManagerCannotTouchAdmin(ctx.session.user.role, existing.role);
            await ctx.db.user.update({
              where: { email: u.email },
              data: {
                name: u.name,
                role: u.role,
                employeeId: u.employeeId ?? existing.employeeId,
                passwordHash,
              },
            });
            results.updated++;
          } else {
            await ctx.db.user.create({
              data: {
                name: u.name,
                email: u.email,
                role: u.role,
                employeeId: u.employeeId || null,
                passwordHash,
              },
            });
            results.created++;
          }
        } catch {
          results.errors.push({ email: u.email, error: "Failed to process user" });
        }
      }

      return results;
    }),
});
