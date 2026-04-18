import { z } from "zod";
import { createTRPCRouter, protectedProcedure, instructorProcedure } from "@/server/trpc";
import { TRPCError } from "@trpc/server";
import { sampleQuestions, type PoolRule, type QuestionSnapshot } from "@/lib/question-sampler";
import { gradeAttempt, type AttemptAnswer } from "@/lib/grading";
import { DIFFICULTY_LEVELS, QUESTION_TYPES } from "@/lib/question-types";
const ASSESSMENT_TYPES = ["QUIZ", "EXAM", "PRACTICE"] as const;

const poolRuleSchema = z.object({
  tags: z.array(z.string()).optional(),
  difficulty: z.enum(DIFFICULTY_LEVELS).optional(),
  type: z.enum(QUESTION_TYPES).optional(),
  count: z.number().min(1),
});

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseOptions(options: string | null | undefined) {
  const parsed = parseJson<unknown>(options, null);
  return Array.isArray(parsed) ? parsed : null;
}

function parseTags(tags: string | null | undefined) {
  const parsed = parseJson<unknown>(tags, []);
  return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
}

function normalizeQuestion<T extends { options: string | null; tags: string; [key: string]: unknown }>(question: T) {
  return {
    ...question,
    tags: parseTags(question.tags),
    options: parseOptions(question.options),
  };
}

function normalizeAssessment<T extends { poolConfig: string | null }>(assessment: T) {
  return {
    ...assessment,
    poolConfig: parseJson<PoolRule[]>(assessment.poolConfig, []),
  };
}

function requireUserId(user: { id?: string } | undefined) {
  if (!user?.id) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return user.id;
}

export const assessmentRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ courseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const assessments = await ctx.db.assessment.findMany({
        where: { courseId: input.courseId },
        orderBy: { createdAt: "asc" },
        include: {
          _count: { select: { attempts: true, assessmentQuestions: true } },
        },
      });

      return assessments.map((assessment) => normalizeAssessment(assessment));
    }),

  byId: protectedProcedure
    .input(z.object({ assessmentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const role = (ctx.session.user as { role: string }).role;
      const assessment = await ctx.db.assessment.findUnique({
        where: { id: input.assessmentId },
        include: {
          course: { select: { id: true, title: true, instructorId: true } },
          assessmentQuestions: role !== "STUDENT"
            ? { include: { question: true }, orderBy: { order: "asc" } }
            : false,
          _count: { select: { attempts: true } },
        },
      });
      if (!assessment) throw new TRPCError({ code: "NOT_FOUND" });
      return {
        ...normalizeAssessment(assessment),
        assessmentQuestions: Array.isArray(assessment.assessmentQuestions)
          ? assessment.assessmentQuestions.map((aq) => ({
              ...aq,
              question: normalizeQuestion(aq.question),
            }))
          : assessment.assessmentQuestions,
      };
    }),

  create: instructorProcedure
    .input(
      z.object({
        courseId: z.string(),
        title: z.string().min(3),
        description: z.string().optional(),
        type: z.enum(ASSESSMENT_TYPES).default("QUIZ"),
        timeLimit: z.number().min(1).optional(),
        maxAttempts: z.number().min(1).default(1),
        passingScore: z.number().min(0).max(100).optional(),
        shuffleQuestions: z.boolean().default(true),
        shuffleOptions: z.boolean().default(true),
        showFeedback: z.boolean().default(true),
        availableFrom: z.date().optional(),
        availableUntil: z.date().optional(),
        poolConfig: z.array(poolRuleSchema).optional(),
        questionIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { questionIds, poolConfig, ...assessmentData } = input;

      const assessment = await ctx.db.assessment.create({
        data: {
          ...assessmentData,
          poolConfig: poolConfig ? JSON.stringify(poolConfig) : null,
        },
      });

      if (questionIds?.length) {
        await ctx.db.assessmentQuestion.createMany({
          data: questionIds.map((questionId, idx) => ({
            assessmentId: assessment.id,
            questionId,
            order: idx,
            isPinned: true,
          })),
        });
      }

      return normalizeAssessment(assessment);
    }),

  update: instructorProcedure
    .input(
      z.object({
        assessmentId: z.string(),
        title: z.string().min(3).optional(),
        description: z.string().optional(),
        timeLimit: z.number().min(1).optional().nullable(),
        maxAttempts: z.number().min(1).optional(),
        passingScore: z.number().min(0).max(100).optional().nullable(),
        shuffleQuestions: z.boolean().optional(),
        shuffleOptions: z.boolean().optional(),
        showFeedback: z.boolean().optional(),
        availableFrom: z.date().optional().nullable(),
        availableUntil: z.date().optional().nullable(),
        poolConfig: z.array(poolRuleSchema).optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { assessmentId, poolConfig, ...data } = input;
      const assessment = await ctx.db.assessment.update({
        where: { id: assessmentId },
        data: {
          ...data,
          ...(poolConfig !== undefined
            ? { poolConfig: poolConfig ? JSON.stringify(poolConfig) : null }
            : {}),
        },
      });
      return normalizeAssessment(assessment);
    }),

  delete: instructorProcedure
    .input(z.object({ assessmentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const assessment = await ctx.db.assessment.findUnique({
        where: { id: input.assessmentId },
        include: {
          course: { select: { instructorId: true } },
        },
      });

      if (!assessment) throw new TRPCError({ code: "NOT_FOUND" });

      const role = (ctx.session.user as { role: string }).role;
      if (role !== "ADMIN" && assessment.course.instructorId !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const attempts = await ctx.db.attempt.findMany({
        where: { assessmentId: input.assessmentId },
        select: { id: true },
      });

      const attemptIds = attempts.map((attempt) => attempt.id);

      await ctx.db.$transaction([
        ctx.db.grade.deleteMany({
          where: {
            OR: [
              { assessmentId: input.assessmentId },
              ...(attemptIds.length ? [{ attemptId: { in: attemptIds } }] : []),
            ],
          },
        }),
        ctx.db.attempt.deleteMany({ where: { assessmentId: input.assessmentId } }),
        ctx.db.assessment.delete({ where: { id: input.assessmentId } }),
      ]);

      return { success: true };
    }),

  addQuestion: instructorProcedure
    .input(
      z.object({
        assessmentId: z.string(),
        questionId: z.string(),
        isPinned: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const maxOrder = await ctx.db.assessmentQuestion.aggregate({
        where: { assessmentId: input.assessmentId },
        _max: { order: true },
      });
      return ctx.db.assessmentQuestion.create({
        data: {
          assessmentId: input.assessmentId,
          questionId: input.questionId,
          order: (maxOrder._max.order ?? -1) + 1,
          isPinned: input.isPinned,
        },
      });
    }),

  setQuestionEnabled: instructorProcedure
    .input(
      z.object({
        assessmentId: z.string(),
        questionId: z.string(),
        enabled: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.assessmentQuestion.updateMany({
        where: { assessmentId: input.assessmentId, questionId: input.questionId },
        data: { isPinned: input.enabled },
      });
      return { success: true };
    }),

  removeQuestion: instructorProcedure
    .input(z.object({ assessmentId: z.string(), questionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.assessmentQuestion.deleteMany({
        where: { assessmentId: input.assessmentId, questionId: input.questionId },
      });
      return { success: true };
    }),

  // ─── Student: Start an attempt ──────────────────────────────────────────────

  startAttempt: protectedProcedure
    .input(z.object({ assessmentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session.user);
      const assessment = await ctx.db.assessment.findUnique({
        where: { id: input.assessmentId },
        include: {
          assessmentQuestions: { where: { isPinned: true }, select: { questionId: true } },
          course: { select: { id: true } },
        },
      });
      if (!assessment) throw new TRPCError({ code: "NOT_FOUND" });
      const normalizedAssessment = normalizeAssessment(assessment);

      // Check availability window
      const now = new Date();
      if (normalizedAssessment.availableFrom && now < normalizedAssessment.availableFrom) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Assessment not yet available" });
      }
      if (normalizedAssessment.availableUntil && now > normalizedAssessment.availableUntil) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Assessment deadline passed" });
      }

      // Check attempt limit
      const attemptCount = await ctx.db.attempt.count({
        where: {
          assessmentId: input.assessmentId,
          userId,
          status: { not: "TIMED_OUT" },
        },
      });
      if (attemptCount >= normalizedAssessment.maxAttempts) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Max attempts reached" });
      }

      // Check for active attempt
      const activeAttempt = await ctx.db.attempt.findFirst({
        where: {
          assessmentId: input.assessmentId,
          userId,
          status: "IN_PROGRESS",
        },
      });
      if (activeAttempt) return activeAttempt;

      // Sample questions
      const pinnedIds = normalizedAssessment.assessmentQuestions.map((aq) => aq.questionId);
      const poolConfig = normalizedAssessment.poolConfig;

      const snapshot = await sampleQuestions(
        normalizedAssessment.course.id,
        poolConfig,
        pinnedIds,
        normalizedAssessment.shuffleOptions
      );

      const attempt = await ctx.db.attempt.create({
        data: {
          assessmentId: input.assessmentId,
          userId,
          questionSnapshot: JSON.stringify(snapshot),
        },
      });

      return {
        ...attempt,
        questionSnapshot: snapshot,
      };
    }),

  // ─── Student: Get attempt with questions ────────────────────────────────────

  getAttempt: protectedProcedure
    .input(z.object({ attemptId: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session.user);
      const attempt = await ctx.db.attempt.findUnique({
        where: { id: input.attemptId },
        include: {
          assessment: true,
          responses: true,
        },
      });
      if (!attempt) throw new TRPCError({ code: "NOT_FOUND" });
      if (attempt.userId !== userId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      // Fetch questions from snapshot
      const snapshot = parseJson<QuestionSnapshot[]>(attempt.questionSnapshot, []);

      const questionIds = snapshot.map((s) => s.questionId);
      const questions = await ctx.db.question.findMany({
        where: { id: { in: questionIds } },
      });

      const questionsById = new Map(questions.map((q) => [q.id, q]));

      // Reorder options per snapshot and hide correct answers
      const orderedQuestions = snapshot.map((s) => {
        const q = questionsById.get(s.questionId)!;
        let options = parseOptions(q.options) as Array<{
          id: string;
          text: string;
          isCorrect: boolean;
        }> | null;

        if (options && s.optionOrder) {
          const orderMap = new Map(s.optionOrder.map((id, i) => [id, i]));
          options = [...options].sort(
            (a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0)
          );
        }

        return {
          ...q,
          order: s.order,
          imageUrl: q.imageUrl,
          options: options?.map(({ id, text }) => ({ id, text })) ?? null, // strip isCorrect
          explanation: null, // hide until submitted
          correctAnswer: null,
        };
      });

      return {
        attempt: {
          ...attempt,
          questionSnapshot: snapshot,
          assessment: normalizeAssessment(attempt.assessment),
          responses: attempt.responses.map((response) => ({
            ...response,
            answer: parseJson<AttemptAnswer>(response.answer, {}),
          })),
        },
        questions: orderedQuestions.sort((a, b) => a.order - b.order),
      };
    }),

  // ─── Student: Save a response ───────────────────────────────────────────────

  saveResponse: protectedProcedure
    .input(
      z.object({
        attemptId: z.string(),
        questionId: z.string(),
        answer: z.object({
          selected: z.array(z.string()).optional(),
          text: z.string().optional(),
          ordered: z.array(z.string()).optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session.user);
      const attempt = await ctx.db.attempt.findUnique({ where: { id: input.attemptId } });
      if (!attempt || attempt.userId !== userId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (attempt.status !== "IN_PROGRESS") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Attempt already submitted" });
      }

      return ctx.db.attemptResponse.upsert({
        where: { attemptId_questionId: { attemptId: input.attemptId, questionId: input.questionId } },
        create: {
          attemptId: input.attemptId,
          questionId: input.questionId,
          answer: JSON.stringify(input.answer),
        },
        update: { answer: JSON.stringify(input.answer) },
      });
    }),

  // ─── Student: Submit attempt ────────────────────────────────────────────────

  submitAttempt: protectedProcedure
    .input(z.object({ attemptId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session.user);
      const attempt = await ctx.db.attempt.findUnique({
        where: { id: input.attemptId },
        include: {
          assessment: {
            include: { course: { select: { id: true } } },
          },
          responses: true,
        },
      });

      if (!attempt || attempt.userId !== userId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (attempt.status !== "IN_PROGRESS") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Already submitted" });
      }

      // Check time limit
      if (attempt.assessment.timeLimit) {
        const elapsed = (Date.now() - attempt.startedAt.getTime()) / 1000 / 60;
        if (elapsed > attempt.assessment.timeLimit + 0.5) {
          await ctx.db.attempt.update({
            where: { id: input.attemptId },
            data: { status: "TIMED_OUT", submittedAt: new Date() },
          });
          throw new TRPCError({ code: "BAD_REQUEST", message: "Time limit exceeded" });
        }
      }

      const snapshot = parseJson<QuestionSnapshot[]>(attempt.questionSnapshot, []);
      const questionIds = snapshot.map((s) => s.questionId);
      const questions = await ctx.db.question.findMany({ where: { id: { in: questionIds } } });

      const answersMap = new Map<string, AttemptAnswer>(
        attempt.responses.map((r) => [r.questionId, parseJson<AttemptAnswer>(r.answer, {})])
      );

      const { results, autoScore, autoMaxScore, needsManualGrading } = gradeAttempt(
        questions,
        answersMap
      );

      // Total max score includes manual questions
      const totalMaxScore = questions.reduce((sum, q) => sum + q.points, 0);
      const percentScore = totalMaxScore > 0 ? (autoScore / totalMaxScore) * 100 : 0;
      const isPassed = attempt.assessment.passingScore
        ? percentScore >= attempt.assessment.passingScore
        : null;

      // Update responses with grading results
      await Promise.all(
        [...results.entries()].map(([questionId, result]) => {
          if (result === null) return Promise.resolve();
          return ctx.db.attemptResponse.updateMany({
            where: { attemptId: input.attemptId, questionId },
            data: {
              isCorrect: result.isCorrect,
              pointsEarned: result.pointsEarned,
              gradedAt: new Date(),
            },
          });
        })
      );

      // Update attempt
      const updatedAttempt = await ctx.db.attempt.update({
        where: { id: input.attemptId },
        data: {
          status: needsManualGrading ? "SUBMITTED" : "GRADED",
          submittedAt: new Date(),
          score: autoScore,
          percentScore,
          isPassed,
        },
      });

      // Create grade record
      const enrollment = await ctx.db.enrollment.findUnique({
        where: { userId_courseId: { userId, courseId: attempt.assessment.courseId } },
      });

      if (enrollment) {
        await ctx.db.grade.upsert({
          where: { attemptId: input.attemptId },
          create: {
            enrollmentId: enrollment.id,
            assessmentId: attempt.assessmentId,
            attemptId: input.attemptId,
            userId,
            score: autoScore,
            maxScore: totalMaxScore,
            percentScore,
          },
          update: {
            score: autoScore,
            maxScore: totalMaxScore,
            percentScore,
          },
        });
      }

      return { attempt: updatedAttempt, needsManualGrading };
    }),

  // ─── Get result ─────────────────────────────────────────────────────────────

  getResult: protectedProcedure
    .input(z.object({ attemptId: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session.user);
      const attempt = await ctx.db.attempt.findUnique({
        where: { id: input.attemptId },
        include: {
          assessment: true,
          responses: { include: { question: true } },
        },
      });

      if (!attempt) throw new TRPCError({ code: "NOT_FOUND" });

      const role = (ctx.session.user as { role: string }).role;
      if (role === "STUDENT" && attempt.userId !== userId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const snapshot = parseJson<QuestionSnapshot[]>(attempt.questionSnapshot, []);

      // Only show feedback if allowed
      const showAnswers = attempt.assessment.showFeedback && attempt.status !== "IN_PROGRESS";

      return {
        attempt: {
          ...attempt,
          assessment: normalizeAssessment(attempt.assessment),
          questionSnapshot: snapshot,
          responses: attempt.responses.map((r) => ({
            ...r,
            answer: parseJson<AttemptAnswer>(r.answer, {}),
            question: showAnswers
              ? { ...r.question, options: parseOptions(r.question.options) }
              : {
                  ...r.question,
                  correctAnswer: null,
                  explanation: null,
                  options: parseOptions(r.question.options),
                },
          })),
        },
        snapshot,
      };
    }),

  // ─── My attempts ────────────────────────────────────────────────────────────

  myAttempts: protectedProcedure
    .input(z.object({ assessmentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session.user);
      const attempts = await ctx.db.attempt.findMany({
        where: { assessmentId: input.assessmentId, userId },
        orderBy: { startedAt: "desc" },
      });

      return attempts.map((attempt) => ({
        ...attempt,
        questionSnapshot: parseJson<QuestionSnapshot[]>(attempt.questionSnapshot, []),
      }));
    }),

  myCourseOverview: protectedProcedure
    .input(z.object({ courseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session.user);
      const assessments = await ctx.db.assessment.findMany({
        where: { courseId: input.courseId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          type: true,
          maxAttempts: true,
          passingScore: true,
          availableFrom: true,
          availableUntil: true,
          showFeedback: true,
        },
      });

      const attempts = await ctx.db.attempt.findMany({
        where: {
          userId,
          assessmentId: { in: assessments.map((assessment) => assessment.id) },
        },
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          assessmentId: true,
          status: true,
          startedAt: true,
          submittedAt: true,
          percentScore: true,
          isPassed: true,
        },
      });

      const attemptsByAssessment = new Map<string, typeof attempts>();
      for (const attempt of attempts) {
        const existing = attemptsByAssessment.get(attempt.assessmentId) ?? [];
        existing.push(attempt);
        attemptsByAssessment.set(attempt.assessmentId, existing);
      }

      const now = new Date();

      return assessments.map((assessment) => {
        const assessmentAttempts = attemptsByAssessment.get(assessment.id) ?? [];
        const completedAttempts = assessmentAttempts.filter((attempt) => attempt.status !== "IN_PROGRESS");
        const activeAttempt = assessmentAttempts.find((attempt) => attempt.status === "IN_PROGRESS") ?? null;
        const bestScore = completedAttempts.length
          ? Math.max(...completedAttempts.map((attempt) => attempt.percentScore ?? 0))
          : null;
        const attemptsUsed = completedAttempts.filter((attempt) => attempt.status !== "TIMED_OUT").length;
        const remainingAttempts = Math.max(assessment.maxAttempts - attemptsUsed, 0);
        const isUpcoming = Boolean(assessment.availableFrom && now < assessment.availableFrom);
        const isExpired = Boolean(assessment.availableUntil && now > assessment.availableUntil);
        const isAvailableNow = !isUpcoming && !isExpired;

        return {
          ...assessment,
          activeAttemptId: activeAttempt?.id ?? null,
          attemptsUsed,
          remainingAttempts,
          bestScore,
          hasPassed: completedAttempts.some((attempt) => attempt.isPassed === true),
          hasInProgressAttempt: Boolean(activeAttempt),
          isUpcoming,
          isExpired,
          isAvailableNow,
        };
      });
    }),
});
