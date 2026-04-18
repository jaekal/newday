import { z } from "zod";
import { createTRPCRouter, protectedProcedure, instructorProcedure } from "@/server/trpc";
import { TRPCError } from "@trpc/server";
import { createNotification } from "./notification";

export const gradeRouter = createTRPCRouter({
  myGrades: protectedProcedure
    .input(z.object({ courseId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.grade.findMany({
        where: {
          userId: ctx.session.user.id,
          ...(input.courseId
            ? {
                enrollment: { courseId: input.courseId },
              }
            : {}),
        },
        include: {
          enrollment: { include: { course: { select: { id: true, title: true } } } },
          attempt: { select: { id: true, startedAt: true, submittedAt: true } },
        },
        orderBy: { gradedAt: "desc" },
      });
    }),

  gradebook: instructorProcedure
    .input(z.object({ courseId: z.string(), assessmentId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.grade.findMany({
        where: {
          enrollment: { courseId: input.courseId },
          ...(input.assessmentId ? { assessmentId: input.assessmentId } : {}),
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
          attempt: {
            select: {
              id: true,
              status: true,
              startedAt: true,
              submittedAt: true,
              score: true,
              percentScore: true,
              isPassed: true,
            },
          },
        },
        orderBy: { gradedAt: "desc" },
      });
    }),

  overrideGrade: instructorProcedure
    .input(
      z.object({
        gradeId: z.string(),
        score: z.number().min(0),
        maxScore: z.number().min(0),
        feedback: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { gradeId, ...data } = input;
      const percentScore = data.maxScore > 0 ? (data.score / data.maxScore) * 100 : 0;
      return ctx.db.grade.update({
        where: { id: gradeId },
        data: { ...data, percentScore, gradedById: ctx.session.user.id, gradedAt: new Date() },
      });
    }),

  manualGradeResponse: instructorProcedure
    .input(
      z.object({
        attemptId: z.string(),
        questionId: z.string(),
        pointsEarned: z.number().min(0),
        feedback: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.attemptResponse.updateMany({
        where: { attemptId: input.attemptId, questionId: input.questionId },
        data: {
          pointsEarned: input.pointsEarned,
          feedback: input.feedback,
          isCorrect: input.pointsEarned > 0,
          gradedAt: new Date(),
        },
      });

      // Recalculate attempt score
      const responses = await ctx.db.attemptResponse.findMany({
        where: { attemptId: input.attemptId },
        include: { question: { select: { points: true } } },
      });

      const score = responses.reduce((sum, r) => sum + (r.pointsEarned ?? 0), 0);
      const maxScore = responses.reduce((sum, r) => sum + r.question.points, 0);
      const percentScore = maxScore > 0 ? (score / maxScore) * 100 : 0;

      const attempt = await ctx.db.attempt.findUnique({
        where: { id: input.attemptId },
        select: { userId: true, assessmentId: true, assessment: { select: { passingScore: true } } },
      });

      const isPassed = attempt?.assessment.passingScore
        ? percentScore >= attempt.assessment.passingScore
        : null;

      const allGraded = responses.every((r) => r.isCorrect !== null);

      await ctx.db.attempt.update({
        where: { id: input.attemptId },
        data: {
          score,
          percentScore,
          isPassed,
          status: allGraded ? "GRADED" : "SUBMITTED",
        },
      });

      // Update grade record
      await ctx.db.grade.updateMany({
        where: { attemptId: input.attemptId },
        data: { score, maxScore, percentScore, gradedById: ctx.session.user.id, gradedAt: new Date() },
      });

      if (allGraded && attempt) {
        await createNotification(
          ctx.db,
          attempt.userId,
          "GRADE",
          "Your assessment has been graded",
          `Score: ${Math.round(percentScore)}%${attempt.assessment.passingScore ? (isPassed ? " — Passed" : " — Not passed") : ""}`,
          `/assessments/${attempt.assessmentId}/results/${input.attemptId}`,
        );
      }

      return { success: true };
    }),
});
