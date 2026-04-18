import { z } from "zod";
import { createTRPCRouter, instructorProcedure, protectedProcedure } from "@/server/trpc";
import { TRPCError } from "@trpc/server";
import { DIFFICULTY_LEVELS, QUESTION_TYPES } from "@/lib/question-types";

function parseTags(tags: string | null | undefined) {
  if (!tags) return [] as string[];

  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function normalizeQuestion(question: {
  tags: string;
  options: string | null;
  [key: string]: unknown;
}) {
  let options: unknown = null;

  if (question.options) {
    try {
      options = JSON.parse(question.options);
    } catch {
      options = null;
    }
  }

  return {
    ...question,
    tags: parseTags(question.tags),
    options,
  };
}

const optionSchema = z.object({
  id: z.string(),
  text: z.string(),
  imageUrl: z.string().optional(),
  isCorrect: z.boolean(),
});

const questionInput = z.object({
  courseId: z.string().optional(),
  type: z.enum(QUESTION_TYPES),
  difficulty: z.enum(DIFFICULTY_LEVELS).default("MEDIUM"),
  points: z.number().min(0.5).default(1),
  stem: z.string().min(5),
  imageUrl: z.string().optional(),
  explanation: z.string().optional(),
  tags: z.array(z.string()).default([]),
  options: z.array(optionSchema).optional(),
  correctAnswer: z.string().optional(),
});

export const questionRouter = createTRPCRouter({
  list: instructorProcedure
    .input(
      z.object({
        courseId: z.string().optional(),
        type: z.enum(QUESTION_TYPES).optional(),
        difficulty: z.enum(DIFFICULTY_LEVELS).optional(),
        tags: z.array(z.string()).optional(),
        search: z.string().optional(),
        page: z.number().default(1),
        limit: z.number().default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const skip = (input.page - 1) * input.limit;
      const role = (ctx.session.user as { role: string }).role;

      const where = {
        ...(role === "INSTRUCTOR" ? { authorId: ctx.session.user.id } : {}),
        ...(input.courseId ? { courseId: input.courseId } : {}),
        ...(input.type ? { type: input.type } : {}),
        ...(input.difficulty ? { difficulty: input.difficulty } : {}),
        ...(input.search ? { stem: { contains: input.search } } : {}),
      };

      const [questions, total] = await Promise.all([
        ctx.db.question.findMany({
          skip,
          take: input.limit,
          where,
          include: { author: { select: { id: true, name: true } } },
          orderBy: { createdAt: "desc" },
        }),
        ctx.db.question.count({ where }),
      ]);

      const normalizedQuestions = questions
        .map((question) => normalizeQuestion(question))
        .filter((question) =>
          input.tags?.length ? input.tags.some((tag) => question.tags.includes(tag)) : true
        );

      return {
        questions: normalizedQuestions,
        total: input.tags?.length ? normalizedQuestions.length : total,
        pages: Math.ceil((input.tags?.length ? normalizedQuestions.length : total) / input.limit),
      };
    }),

  byId: instructorProcedure
    .input(z.object({ questionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const q = await ctx.db.question.findUnique({
        where: { id: input.questionId },
        include: { author: { select: { id: true, name: true } } },
      });
      if (!q) throw new TRPCError({ code: "NOT_FOUND" });
      return normalizeQuestion(q);
    }),

  create: instructorProcedure
    .input(questionInput)
    .mutation(async ({ ctx, input }) => {
      return ctx.db.question.create({
        data: {
          ...input,
          authorId: ctx.session.user.id,
          imageUrl: input.imageUrl || null,
          tags: JSON.stringify(input.tags),
          options: input.options ? JSON.stringify(input.options) : null,
        },
      });
    }),

  createMany: instructorProcedure
    .input(z.object({ questions: z.array(questionInput).min(1) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.$transaction(
        input.questions.map((question) =>
          ctx.db.question.create({
            data: {
              ...question,
              authorId: ctx.session.user.id,
              imageUrl: question.imageUrl || null,
              tags: JSON.stringify(question.tags),
              options: question.options ? JSON.stringify(question.options) : null,
            },
          })
        )
      );
    }),

  update: instructorProcedure
    .input(questionInput.partial().extend({ questionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { questionId, ...data } = input;
      const q = await ctx.db.question.findUnique({ where: { id: questionId } });
      if (!q) throw new TRPCError({ code: "NOT_FOUND" });

      const role = (ctx.session.user as { role: string }).role;
      if (role !== "ADMIN" && q.authorId !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      return ctx.db.question.update({
        where: { id: questionId },
        data: {
          ...(data.courseId !== undefined ? { courseId: data.courseId } : {}),
          ...(data.type !== undefined ? { type: data.type } : {}),
          ...(data.difficulty !== undefined ? { difficulty: data.difficulty } : {}),
          ...(data.points !== undefined ? { points: data.points } : {}),
          ...(data.stem !== undefined ? { stem: data.stem } : {}),
          ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl || null } : {}),
          ...(data.explanation !== undefined ? { explanation: data.explanation } : {}),
          ...(data.correctAnswer !== undefined ? { correctAnswer: data.correctAnswer } : {}),
          ...(data.tags !== undefined ? { tags: JSON.stringify(data.tags) } : {}),
          ...(data.options !== undefined ? { options: data.options ? JSON.stringify(data.options) : null } : {}),
        },
      });
    }),

  delete: instructorProcedure
    .input(z.object({ questionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const q = await ctx.db.question.findUnique({ where: { id: input.questionId } });
      if (!q) throw new TRPCError({ code: "NOT_FOUND" });

      const role = (ctx.session.user as { role: string }).role;
      if (role !== "ADMIN" && q.authorId !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      await ctx.db.question.delete({ where: { id: input.questionId } });
      return { success: true };
    }),

  deleteMany: instructorProcedure
    .input(z.object({ questionIds: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const role = (ctx.session.user as { role: string }).role;
      const questions = await ctx.db.question.findMany({
        where: { id: { in: input.questionIds } },
        select: { id: true, authorId: true },
      });

      if (questions.length !== input.questionIds.length) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (role !== "ADMIN" && questions.some((question) => question.authorId !== ctx.session.user.id)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      await ctx.db.question.deleteMany({
        where: { id: { in: input.questionIds } },
      });

      return { success: true, count: input.questionIds.length };
    }),

  // Get all tags used by this instructor
  tags: instructorProcedure.query(async ({ ctx }) => {
    const role = (ctx.session.user as { role: string }).role;
    const questions = await ctx.db.question.findMany({
      where: role === "INSTRUCTOR" ? { authorId: ctx.session.user.id } : {},
      select: { tags: true },
    });
    const allTags = questions.flatMap((q) => parseTags(q.tags));
    return [...new Set(allTags)].sort();
  }),

  // Avg score and usage count per question (for performance indicators)
  performance: instructorProcedure
    .input(z.object({ questionIds: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      const stats = await Promise.all(
        input.questionIds.map(async (id) => {
          const responses = await ctx.db.attemptResponse.findMany({
            where: { questionId: id, isCorrect: { not: null } },
            select: { isCorrect: true },
          });
          const total = responses.length;
          const correct = responses.filter((r) => r.isCorrect).length;
          return { id, total, avgScore: total > 0 ? Math.round((correct / total) * 100) : null };
        })
      );
      return Object.fromEntries(stats.map((s) => [s.id, { total: s.total, avgScore: s.avgScore }]));
    }),

  // Facet counts for sidebar filters — scoped to courseId if provided
  facets: instructorProcedure
    .input(z.object({ courseId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const role = (ctx.session.user as { role: string }).role;
      const base = {
        ...(role === "INSTRUCTOR" ? { authorId: ctx.session.user.id } : {}),
        ...(input.courseId ? { courseId: input.courseId } : {}),
      };

      const questions = await ctx.db.question.findMany({
        where: base,
        select: { type: true, difficulty: true, tags: true },
      });

      const typeCounts: Record<string, number> = {};
      const diffCounts: Record<string, number> = {};
      const tagCounts: Record<string, number> = {};

      for (const q of questions) {
        typeCounts[q.type] = (typeCounts[q.type] ?? 0) + 1;
        diffCounts[q.difficulty] = (diffCounts[q.difficulty] ?? 0) + 1;
        for (const t of parseTags(q.tags)) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
      }

      return { typeCounts, diffCounts, tagCounts, total: questions.length };
    }),
});
