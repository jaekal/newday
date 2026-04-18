import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { getLearnerCourseAccess } from "@/server/course-access";
import { getNextAvailableModuleId } from "@/lib/module-path";

export const activityRouter = createTRPCRouter({
  /** Per-course progress for the radar chart */
  courseProgress: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user!.id;

    const enrollments = await ctx.db.enrollment.findMany({
      where: { userId, status: "ACTIVE" },
      include: {
        course: {
          include: {
            modules: {
              select: { id: true, title: true, estimatedMinutes: true, prerequisiteModuleId: true },
              orderBy: { order: "asc" },
            },
          },
        },
      },
    });

    const completions = await ctx.db.moduleCompletion.findMany({
      where: { userId },
      select: { moduleId: true, completedAt: true },
    });

    const completedSet = new Set(completions.map((c) => c.moduleId));

    return Promise.all(enrollments.map(async (e) => {
      const access = await getLearnerCourseAccess(ctx.db, userId, e.courseId);
      const visibleModuleIds = access.visibleModuleIds ? new Set(access.visibleModuleIds) : null;
      const modules = visibleModuleIds
        ? e.course.modules
            .filter((module) => visibleModuleIds.has(module.id))
            .map((module) => ({
              ...module,
              prerequisiteModuleId:
                module.prerequisiteModuleId && visibleModuleIds.has(module.prerequisiteModuleId)
                  ? module.prerequisiteModuleId
                  : null,
            }))
        : e.course.modules;
      const total = modules.length;
      const completed = modules.filter((m) => completedSet.has(m.id)).length;
      const relevantDates = completions
        .filter((c) => modules.some((m) => m.id === c.moduleId))
        .map((c) => c.completedAt.getTime());
      const lastActivityAt =
        relevantDates.length > 0 ? new Date(Math.max(...relevantDates)) : null;
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const nextModuleId = getNextAvailableModuleId(
        modules.map((module) => ({
          ...module,
          completions: completedSet.has(module.id) ? [{ completedAt: new Date() }] : [],
        })),
      );
      const nextModule = nextModuleId ? modules.find((module) => module.id === nextModuleId) : null;
      return {
        courseId: e.courseId,
        title: e.course.title,
        totalModules: total,
        completedModules: completed,
        progress: total > 0 ? Math.round((completed / total) * 100) : 0,
        recentlyActive: lastActivityAt ? lastActivityAt.getTime() > sevenDaysAgo : false,
        lastActivityAt,
        nextModuleId: nextModule?.id ?? null,
        nextModuleTitle: nextModule?.title ?? null,
        estimatedMinutesRemaining: modules
          .filter((module) => !completedSet.has(module.id))
          .reduce((sum, module) => sum + (module.estimatedMinutes ?? 0), 0),
      };
    }));
  }),

  /** Streak + today's progress for the momentum ring */
  streak: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user!.id;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const todayStr = new Date().toISOString().split("T")[0];

    const [moduleCompletions, attempts] = await Promise.all([
      ctx.db.moduleCompletion.findMany({
        where: { userId, completedAt: { gte: thirtyDaysAgo } },
        select: { completedAt: true },
      }),
      ctx.db.attempt.findMany({
        where: { userId, submittedAt: { gte: thirtyDaysAgo, not: null } },
        select: { submittedAt: true },
      }),
    ]);

    const activeDays = new Set<string>();
    moduleCompletions.forEach((c) => activeDays.add(toDateStr(c.completedAt)));
    attempts.forEach((a) => { if (a.submittedAt) activeDays.add(toDateStr(a.submittedAt)); });

    // Walk backwards from today to find streak length
    let streakDays = 0;
    const cursor = new Date();
    if (!activeDays.has(todayStr)) cursor.setDate(cursor.getDate() - 1);
    while (activeDays.has(toDateStr(cursor))) {
      streakDays++;
      cursor.setDate(cursor.getDate() - 1);
    }

    const todayModules = moduleCompletions.filter(
      (c) => toDateStr(c.completedAt) === todayStr,
    ).length;
    const todayAssessments = attempts.filter(
      (a) => a.submittedAt && toDateStr(a.submittedAt) === todayStr,
    ).length;

    const weekHistory = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const dateStr = toDateStr(d);
      return { date: dateStr, active: activeDays.has(dateStr) };
    });

    return {
      streakDays,
      todayModules,
      todayAssessments,
      todayTotal: todayModules + todayAssessments,
      dailyGoal: 1,
      weekHistory,
    };
  }),
});

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}
