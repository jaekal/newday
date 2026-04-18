import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getLearnerCourseAccess } from "@/server/course-access";
import { createTRPCRouter, instructorProcedure, type Context } from "@/server/trpc";
import { createNotification } from "./notification";

function round(value: number) {
  return Math.round(value * 10) / 10;
}

type CourseWhere = Record<string, unknown>;
type ReportDb = Context["db"];

function getCourseWhere(role: string, userId: string): CourseWhere {
  return role === "INSTRUCTOR" ? { instructorId: userId } : {};
}

function getLatestAttemptMap<
  TAttempt extends {
    assessmentId: string;
    userId: string;
    startedAt: Date;
  },
>(attempts: TAttempt[]) {
  const latestAttemptByAssessmentUser = new Map<string, TAttempt>();
  for (const attempt of attempts) {
    const key = `${attempt.assessmentId}:${attempt.userId}`;
    const existing = latestAttemptByAssessmentUser.get(key);
    if (!existing || existing.startedAt < attempt.startedAt) {
      latestAttemptByAssessmentUser.set(key, attempt);
    }
  }
  return latestAttemptByAssessmentUser;
}

async function getOverdueAssessments(
  db: ReportDb,
  courseWhere: CourseWhere,
) {
  const courses = await db.course.findMany({
    where: courseWhere,
    orderBy: { createdAt: "desc" },
    include: {
      enrollments: {
        where: { status: { not: "DROPPED" } },
        select: { userId: true, user: { select: { name: true, email: true } } },
      },
      assessments: {
        select: {
          id: true,
          title: true,
          availableUntil: true,
        },
      },
      cohorts: {
        include: {
          cohort: {
            include: {
              memberships: {
                select: { userId: true },
              },
            },
          },
        },
      },
    },
  });

  const attempts = await db.attempt.findMany({
    where: {
      assessment: {
        course: courseWhere,
      },
      status: { in: ["IN_PROGRESS", "SUBMITTED", "GRADED", "TIMED_OUT"] },
    },
    select: {
      id: true,
      userId: true,
      assessmentId: true,
      status: true,
      startedAt: true,
    },
  });

  const latestAttemptByAssessmentUser = getLatestAttemptMap(attempts);

  const now = new Date();
  return courses.flatMap((course) =>
    course.assessments.flatMap((assessment) => {
      if (!assessment.availableUntil || assessment.availableUntil > now) return [];

      return course.enrollments.flatMap((enrollment) => {
        const latestAttempt = latestAttemptByAssessmentUser.get(`${assessment.id}:${enrollment.userId}`);
        const isComplete = latestAttempt?.status === "GRADED" || latestAttempt?.status === "SUBMITTED";
        if (isComplete) return [];

        const cohortNames = course.cohorts
          .filter((cohortCourse) =>
            cohortCourse.cohort.memberships.some((membership) => membership.userId === enrollment.userId),
          )
          .map((cohortCourse) => cohortCourse.cohort.name);

        return [{
          assessmentId: assessment.id,
          assessmentTitle: assessment.title,
          courseId: course.id,
          courseTitle: course.title,
          learnerId: enrollment.userId,
          learnerName: enrollment.user.name ?? "Learner",
          learnerEmail: enrollment.user.email ?? "",
          dueAt: assessment.availableUntil,
          cohortNames,
          latestAttemptStatus: latestAttempt?.status ?? "NOT_STARTED",
        }];
      });
    }),
  );
}

export const reportRouter = createTRPCRouter({
  overview: instructorProcedure.query(async ({ ctx }) => {
    const role = (ctx.session.user as { role: string }).role;
    const userId = ctx.session.user!.id;
    const courseWhere = getCourseWhere(role, userId);

    const [courses, cohorts, completions, attempts, overdueAssessments] = await Promise.all([
      ctx.db.course.findMany({
        where: courseWhere,
        orderBy: { createdAt: "desc" },
        include: {
          instructor: { select: { id: true, name: true } },
          modules: { select: { id: true, title: true, order: true } },
          enrollments: {
            where: { status: { not: "DROPPED" } },
            select: { userId: true, user: { select: { name: true, email: true } } },
          },
          assessments: {
            select: {
              id: true,
              title: true,
              availableFrom: true,
              availableUntil: true,
              maxAttempts: true,
            },
          },
          cohorts: {
            include: {
              cohort: {
                include: {
                  memberships: {
                    select: { userId: true, user: { select: { name: true, email: true } } },
                  },
                },
              },
              moduleSelections: { select: { moduleId: true } },
            },
          },
          _count: { select: { modules: true, assessments: true, enrollments: true } },
        },
      }),
      ctx.db.cohort.findMany({
        where: {
          courses: {
            some: {
              course: courseWhere,
            },
          },
        },
        include: {
          memberships: {
            select: { userId: true, user: { select: { name: true, email: true } } },
          },
          courses: {
            where: { course: courseWhere },
            include: {
              course: {
                select: {
                  id: true,
                  title: true,
                  _count: { select: { modules: true } },
                },
              },
              moduleSelections: { select: { moduleId: true } },
            },
          },
        },
      }),
      ctx.db.moduleCompletion.findMany({
        where: {
          module: {
            course: courseWhere,
          },
        },
        select: {
          userId: true,
          moduleId: true,
          completedAt: true,
          module: { select: { courseId: true } },
        },
      }),
      ctx.db.attempt.findMany({
        where: {
          assessment: {
            course: courseWhere,
          },
          status: { in: ["IN_PROGRESS", "SUBMITTED", "GRADED", "TIMED_OUT"] },
        },
        select: {
          id: true,
          userId: true,
          assessmentId: true,
          status: true,
          startedAt: true,
          submittedAt: true,
          percentScore: true,
          isPassed: true,
          assessment: {
            select: {
              title: true,
              courseId: true,
              availableUntil: true,
              maxAttempts: true,
            },
          },
          user: { select: { name: true, email: true } },
        },
      }),
      getOverdueAssessments(ctx.db, courseWhere),
    ]);

    const completionByCourseUser = new Map<string, Set<string>>();
    for (const completion of completions) {
      const key = `${completion.module.courseId}:${completion.userId}`;
      const existing = completionByCourseUser.get(key) ?? new Set<string>();
      existing.add(completion.moduleId);
      completionByCourseUser.set(key, existing);
    }

    const courseHealth = courses.map((course) => {
      const totalModules = course.modules.length;
      const enrolledUsers = course.enrollments.length;
      const moduleProgress = course.enrollments.map((enrollment) => {
        const completed = completionByCourseUser.get(`${course.id}:${enrollment.userId}`)?.size ?? 0;
        return totalModules > 0 ? (completed / totalModules) * 100 : 0;
      });
      const avgProgress = moduleProgress.length
        ? round(moduleProgress.reduce((sum, value) => sum + value, 0) / moduleProgress.length)
        : 0;
      const lowProgressCount = moduleProgress.filter((value) => value < 50).length;
      return {
        courseId: course.id,
        title: course.title,
        instructorName: course.instructor.name ?? "Unknown",
        enrolledUsers,
        totalModules,
        totalAssessments: course._count.assessments,
        avgProgress,
        lowProgressCount,
        cohortCount: course.cohorts.length,
      };
    });

    const cohortProgress = cohorts.flatMap((cohort) =>
      cohort.courses.map((cohortCourse) => {
        const assignedModuleIds = cohortCourse.moduleSelections.length
          ? cohortCourse.moduleSelections.map((selection) => selection.moduleId)
          : null;
        const totalAssignedModules = assignedModuleIds?.length ?? cohortCourse.course._count.modules;
        const memberProgress = cohort.memberships.map((membership) => {
          const completedSet = completionByCourseUser.get(`${cohortCourse.course.id}:${membership.userId}`) ?? new Set<string>();
          const completedAssigned = assignedModuleIds
            ? assignedModuleIds.filter((moduleId) => completedSet.has(moduleId)).length
            : completedSet.size;
          return totalAssignedModules > 0 ? (completedAssigned / totalAssignedModules) * 100 : 0;
        });
        const avgProgress = memberProgress.length
          ? round(memberProgress.reduce((sum, value) => sum + value, 0) / memberProgress.length)
          : 0;
        const onTrackMembers = memberProgress.filter((value) => value >= 80).length;
        return {
          cohortId: cohort.id,
          cohortName: cohort.name,
          courseId: cohortCourse.course.id,
          courseTitle: cohortCourse.course.title,
          memberCount: cohort.memberships.length,
          assignedModules: totalAssignedModules,
          isCustomPath: cohortCourse.moduleSelections.length > 0,
          avgProgress,
          onTrackMembers,
        };
      }),
    );

    const summary = {
      totalCourses: courses.length,
      totalLearners: new Set(courses.flatMap((course) => course.enrollments.map((enrollment) => enrollment.userId))).size,
      totalCohorts: cohorts.length,
      overdueAssessmentCount: overdueAssessments.length,
      avgCourseProgress: courseHealth.length
        ? round(courseHealth.reduce((sum, course) => sum + course.avgProgress, 0) / courseHealth.length)
        : 0,
    };

    return {
      summary,
      courseHealth,
      cohortProgress,
      overdueAssessments: overdueAssessments
        .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0))
        .slice(0, 25),
    };
  }),

  courseDetail: instructorProcedure
    .input(z.object({ courseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const role = (ctx.session.user as { role: string }).role;
      const userId = ctx.session.user!.id;
      const courseWhere = getCourseWhere(role, userId);

      const course = await ctx.db.course.findFirst({
        where: {
          id: input.courseId,
          ...courseWhere,
        },
        include: {
          instructor: { select: { id: true, name: true } },
          modules: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              title: true,
              order: true,
              estimatedMinutes: true,
              prerequisiteModuleId: true,
            },
          },
          enrollments: {
            where: { status: { not: "DROPPED" } },
            select: {
              userId: true,
              updatedAt: true,
              user: { select: { name: true, email: true } },
            },
          },
          assessments: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              title: true,
              availableFrom: true,
              availableUntil: true,
            },
          },
        },
      });

      if (!course) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Course report not found" });
      }

      const enrolledUserIds = course.enrollments.map((enrollment) => enrollment.userId);
      const [completions, attempts, overdueAssessments] = await Promise.all([
        ctx.db.moduleCompletion.findMany({
          where: {
            userId: { in: enrolledUserIds.length ? enrolledUserIds : ["__none__"] },
            module: { courseId: course.id },
          },
          select: {
            userId: true,
            moduleId: true,
            completedAt: true,
          },
        }),
        ctx.db.attempt.findMany({
          where: {
            userId: { in: enrolledUserIds.length ? enrolledUserIds : ["__none__"] },
            assessment: { courseId: course.id },
            status: { in: ["IN_PROGRESS", "SUBMITTED", "GRADED", "TIMED_OUT"] },
          },
          select: {
            userId: true,
            assessmentId: true,
            status: true,
            startedAt: true,
            submittedAt: true,
            percentScore: true,
            isPassed: true,
          },
        }),
        getOverdueAssessments(ctx.db, { ...courseWhere, id: course.id }),
      ]);

      const completionByUser = new Map<string, Set<string>>();
      const activityByUser = new Map<string, Date[]>();
      for (const completion of completions) {
        const completedSet = completionByUser.get(completion.userId) ?? new Set<string>();
        completedSet.add(completion.moduleId);
        completionByUser.set(completion.userId, completedSet);

        const activity = activityByUser.get(completion.userId) ?? [];
        activity.push(completion.completedAt);
        activityByUser.set(completion.userId, activity);
      }

      const attemptsByUser = new Map<string, typeof attempts>();
      for (const attempt of attempts) {
        const learnerAttempts = attemptsByUser.get(attempt.userId) ?? [];
        learnerAttempts.push(attempt);
        attemptsByUser.set(attempt.userId, learnerAttempts);

        const activity = activityByUser.get(attempt.userId) ?? [];
        activity.push(attempt.submittedAt ?? attempt.startedAt);
        activityByUser.set(attempt.userId, activity);
      }

      const latestAttemptByAssessmentUser = getLatestAttemptMap(attempts);
      const overdueByLearner = new Map<string, typeof overdueAssessments>();
      for (const item of overdueAssessments) {
        const learnerOverdue = overdueByLearner.get(item.learnerId) ?? [];
        learnerOverdue.push(item);
        overdueByLearner.set(item.learnerId, learnerOverdue);
      }

      const totalEstimatedMinutes = course.modules.reduce(
        (sum, module) => sum + (module.estimatedMinutes ?? 0),
        0,
      );
      const stalledCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

      const learners = await Promise.all(
        course.enrollments.map(async (enrollment) => {
          const access = await getLearnerCourseAccess(ctx.db, enrollment.userId, course.id);
          const visibleModuleIds = access.visibleModuleIds ? new Set(access.visibleModuleIds) : null;
          const assignedModules = visibleModuleIds
            ? course.modules.filter((module) => visibleModuleIds.has(module.id))
            : course.modules;
          const completedSet = completionByUser.get(enrollment.userId) ?? new Set<string>();
          const completedAssignedModules = assignedModules.filter((module) => completedSet.has(module.id)).length;
          const progress = assignedModules.length
            ? round((completedAssignedModules / assignedModules.length) * 100)
            : 0;
          const remainingMinutes = assignedModules.reduce(
            (sum, module) => sum + (completedSet.has(module.id) ? 0 : (module.estimatedMinutes ?? 0)),
            0,
          );
          const nextModule =
            assignedModules.find((module) => {
              if (completedSet.has(module.id)) return false;
              if (!module.prerequisiteModuleId) return true;
              if (visibleModuleIds && !visibleModuleIds.has(module.prerequisiteModuleId)) return true;
              return completedSet.has(module.prerequisiteModuleId);
            }) ?? null;

          const learnerAttempts = attemptsByUser.get(enrollment.userId) ?? [];
          const passedAssessments = course.assessments.filter((assessment) => {
            const latestAttempt = latestAttemptByAssessmentUser.get(`${assessment.id}:${enrollment.userId}`);
            return Boolean(latestAttempt?.isPassed);
          }).length;
          const inProgressAssessments = course.assessments.filter((assessment) => {
            const latestAttempt = latestAttemptByAssessmentUser.get(`${assessment.id}:${enrollment.userId}`);
            return latestAttempt?.status === "IN_PROGRESS";
          }).length;
          const overdueItems = overdueByLearner.get(enrollment.userId) ?? [];

          const activityDates = activityByUser.get(enrollment.userId) ?? [];
          activityDates.push(enrollment.updatedAt);
          const lastActivityAt = activityDates.length
            ? new Date(Math.max(...activityDates.map((date) => date.getTime())))
            : null;
          const isStalled = progress < 100 && (!lastActivityAt || lastActivityAt < stalledCutoff);

          return {
            learnerId: enrollment.userId,
            learnerName: enrollment.user.name ?? "Learner",
            learnerEmail: enrollment.user.email ?? "",
            cohortNames: access.cohortNames,
            isCustomPath: access.isCustomPath,
            assignedModules: assignedModules.length,
            completedModules: completedAssignedModules,
            progress,
            remainingMinutes,
            nextModuleId: nextModule?.id ?? null,
            nextModuleTitle: nextModule?.title ?? null,
            overdueCount: overdueItems.length,
            overdueAssessmentTitles: overdueItems.map((item) => item.assessmentTitle),
            passedAssessments,
            inProgressAssessments,
            lastActivityAt,
            isStalled,
            isAtRisk: overdueItems.length > 0 || isStalled,
            latestScore: learnerAttempts.length
              ? Math.max(...learnerAttempts.map((attempt) => attempt.percentScore ?? 0))
              : null,
          };
        }),
      );

      learners.sort((a, b) => {
        if (a.overdueCount !== b.overdueCount) return b.overdueCount - a.overdueCount;
        if (a.isAtRisk !== b.isAtRisk) return Number(b.isAtRisk) - Number(a.isAtRisk);
        return a.progress - b.progress;
      });

      const assessmentBreakdown = course.assessments
        .map((assessment) => {
          const overdueCount = overdueAssessments.filter((item) => item.assessmentId === assessment.id).length;
          return {
            assessmentId: assessment.id,
            title: assessment.title,
            availableFrom: assessment.availableFrom,
            availableUntil: assessment.availableUntil,
            overdueCount,
          };
        })
        .sort((a, b) => b.overdueCount - a.overdueCount);

      const avgProgress = learners.length
        ? round(learners.reduce((sum, learner) => sum + learner.progress, 0) / learners.length)
        : 0;

      return {
        course: {
          id: course.id,
          title: course.title,
          instructorName: course.instructor.name ?? "Unknown",
          learnerCount: course.enrollments.length,
          moduleCount: course.modules.length,
          assessmentCount: course.assessments.length,
          totalEstimatedMinutes,
        },
        summary: {
          avgProgress,
          completedLearners: learners.filter((learner) => learner.progress >= 100).length,
          atRiskLearners: learners.filter((learner) => learner.isAtRisk).length,
          overdueLearners: new Set(overdueAssessments.map((item) => item.learnerId)).size,
          customPathLearners: learners.filter((learner) => learner.isCustomPath).length,
        },
        learners,
        assessmentBreakdown,
      };
    }),

  cohortDetail: instructorProcedure
    .input(z.object({ cohortId: z.string() }))
    .query(async ({ ctx, input }) => {
      const role = (ctx.session.user as { role: string }).role;
      const userId = ctx.session.user!.id;
      const courseWhere = getCourseWhere(role, userId);

      const cohort = await ctx.db.cohort.findFirst({
        where: {
          id: input.cohortId,
          courses: {
            some: {
              course: courseWhere,
            },
          },
        },
        include: {
          memberships: {
            select: {
              userId: true,
              user: { select: { name: true, email: true } },
            },
          },
          courses: {
            where: { course: courseWhere },
            include: {
              course: {
                include: {
                  modules: {
                    orderBy: { order: "asc" },
                    select: {
                      id: true,
                      title: true,
                      order: true,
                      estimatedMinutes: true,
                      prerequisiteModuleId: true,
                    },
                  },
                  assessments: {
                    orderBy: { createdAt: "asc" },
                    select: {
                      id: true,
                      title: true,
                      availableUntil: true,
                    },
                  },
                },
              },
              moduleSelections: {
                select: { moduleId: true },
              },
            },
          },
        },
      });

      if (!cohort) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cohort report not found" });
      }

      const learnerIds = cohort.memberships.map((membership) => membership.userId);
      const courseIds = cohort.courses.map((cohortCourse) => cohortCourse.courseId);

      const [completions, attempts, overdueAssessments] = await Promise.all([
        ctx.db.moduleCompletion.findMany({
          where: {
            userId: { in: learnerIds.length ? learnerIds : ["__none__"] },
            module: { courseId: { in: courseIds.length ? courseIds : ["__none__"] } },
          },
          select: {
            userId: true,
            moduleId: true,
            completedAt: true,
            module: { select: { courseId: true } },
          },
        }),
        ctx.db.attempt.findMany({
          where: {
            userId: { in: learnerIds.length ? learnerIds : ["__none__"] },
            assessment: { courseId: { in: courseIds.length ? courseIds : ["__none__"] } },
            status: { in: ["IN_PROGRESS", "SUBMITTED", "GRADED", "TIMED_OUT"] },
          },
          select: {
            userId: true,
            assessmentId: true,
            startedAt: true,
            status: true,
            isPassed: true,
            percentScore: true,
            assessment: { select: { courseId: true } },
          },
        }),
        getOverdueAssessments(ctx.db, {
          ...courseWhere,
          id: { in: courseIds.length ? courseIds : ["__none__"] },
        }),
      ]);

      const completionByCourseLearner = new Map<string, Set<string>>();
      for (const completion of completions) {
        const key = `${completion.module.courseId}:${completion.userId}`;
        const completedSet = completionByCourseLearner.get(key) ?? new Set<string>();
        completedSet.add(completion.moduleId);
        completionByCourseLearner.set(key, completedSet);
      }

      const attemptsByCourseLearner = new Map<string, typeof attempts>();
      for (const attempt of attempts) {
        const key = `${attempt.assessment.courseId}:${attempt.userId}`;
        const learnerAttempts = attemptsByCourseLearner.get(key) ?? [];
        learnerAttempts.push(attempt);
        attemptsByCourseLearner.set(key, learnerAttempts);
      }

      const overdueByCourseLearner = new Map<string, typeof overdueAssessments>();
      for (const item of overdueAssessments) {
        const key = `${item.courseId}:${item.learnerId}`;
        const learnerOverdue = overdueByCourseLearner.get(key) ?? [];
        learnerOverdue.push(item);
        overdueByCourseLearner.set(key, learnerOverdue);
      }

      const courseSummaries = cohort.courses.map((cohortCourse) => {
        const assignedModuleIds = cohortCourse.moduleSelections.length
          ? new Set(cohortCourse.moduleSelections.map((selection) => selection.moduleId))
          : null;
        const assignedModules = assignedModuleIds
          ? cohortCourse.course.modules.filter((module) => assignedModuleIds.has(module.id))
          : cohortCourse.course.modules;

        const memberRows = cohort.memberships.map((membership) => {
          const completedSet =
            completionByCourseLearner.get(`${cohortCourse.courseId}:${membership.userId}`) ?? new Set<string>();
          const completedAssigned = assignedModules.filter((module) => completedSet.has(module.id)).length;
          const progress = assignedModules.length
            ? round((completedAssigned / assignedModules.length) * 100)
            : 0;
          const nextModule =
            assignedModules.find((module) => {
              if (completedSet.has(module.id)) return false;
              if (!module.prerequisiteModuleId) return true;
              if (assignedModuleIds && !assignedModuleIds.has(module.prerequisiteModuleId)) return true;
              return completedSet.has(module.prerequisiteModuleId);
            }) ?? null;
          const learnerAttempts = attemptsByCourseLearner.get(`${cohortCourse.courseId}:${membership.userId}`) ?? [];
          const overdueItems = overdueByCourseLearner.get(`${cohortCourse.courseId}:${membership.userId}`) ?? [];

          return {
            learnerId: membership.userId,
            learnerName: membership.user.name ?? "Learner",
            learnerEmail: membership.user.email ?? "",
            progress,
            completedModules: completedAssigned,
            assignedModules: assignedModules.length,
            nextModuleTitle: nextModule?.title ?? null,
            remainingMinutes: assignedModules.reduce(
              (sum, module) => sum + (completedSet.has(module.id) ? 0 : (module.estimatedMinutes ?? 0)),
              0,
            ),
            overdueCount: overdueItems.length,
            overdueTitles: overdueItems.map((item) => item.assessmentTitle),
            passedAssessments: learnerAttempts.filter((attempt) => attempt.isPassed).length,
            bestScore: learnerAttempts.length
              ? Math.max(...learnerAttempts.map((attempt) => attempt.percentScore ?? 0))
              : null,
            isOnTrack: progress >= 80 && overdueItems.length === 0,
          };
        });

        return {
          courseId: cohortCourse.courseId,
          courseTitle: cohortCourse.course.title,
          isCustomPath: cohortCourse.moduleSelections.length > 0,
          assignedModules: assignedModules.length,
          totalCourseModules: cohortCourse.course.modules.length,
          memberRows: memberRows.sort((a, b) => {
            if (a.overdueCount !== b.overdueCount) return b.overdueCount - a.overdueCount;
            return a.progress - b.progress;
          }),
          avgProgress: memberRows.length
            ? round(memberRows.reduce((sum, learner) => sum + learner.progress, 0) / memberRows.length)
            : 0,
          onTrackMembers: memberRows.filter((learner) => learner.isOnTrack).length,
          overdueMembers: memberRows.filter((learner) => learner.overdueCount > 0).length,
        };
      });

      return {
        cohort: {
          id: cohort.id,
          name: cohort.name,
          description: cohort.description,
          memberCount: cohort.memberships.length,
          courseCount: cohort.courses.length,
        },
        summary: {
          avgProgress: courseSummaries.length
            ? round(courseSummaries.reduce((sum, course) => sum + course.avgProgress, 0) / courseSummaries.length)
            : 0,
          customPathCourses: courseSummaries.filter((course) => course.isCustomPath).length,
          overdueMembers: new Set(
            courseSummaries.flatMap((course) =>
              course.memberRows.filter((learner) => learner.overdueCount > 0).map((learner) => learner.learnerId),
            ),
          ).size,
          onTrackMembers: new Set(
            courseSummaries.flatMap((course) =>
              course.memberRows.filter((learner) => learner.isOnTrack).map((learner) => learner.learnerId),
            ),
          ).size,
        },
        courses: courseSummaries,
      };
    }),

  learnerDetail: instructorProcedure
    .input(z.object({ learnerId: z.string() }))
    .query(async ({ ctx, input }) => {
      const role = (ctx.session.user as { role: string }).role;
      const userId = ctx.session.user!.id;
      const courseWhere = getCourseWhere(role, userId);

      const learner = await ctx.db.user.findUnique({
        where: { id: input.learnerId },
        select: {
          id: true,
          name: true,
          email: true,
          employeeId: true,
          enrollments: {
            where: {
              status: { not: "DROPPED" },
              course: courseWhere,
            },
            include: {
              course: {
                include: {
                  instructor: { select: { name: true } },
                  modules: {
                    orderBy: { order: "asc" },
                    select: {
                      id: true,
                      title: true,
                      order: true,
                      estimatedMinutes: true,
                      prerequisiteModuleId: true,
                    },
                  },
                  assessments: {
                    orderBy: { createdAt: "asc" },
                    select: {
                      id: true,
                      title: true,
                      availableUntil: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!learner || learner.enrollments.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Learner report not found" });
      }

      const courseIds = learner.enrollments.map((enrollment) => enrollment.courseId);
      const [completions, attempts, overdueAssessments, cohortAssignments] = await Promise.all([
        ctx.db.moduleCompletion.findMany({
          where: {
            userId: learner.id,
            module: { courseId: { in: courseIds } },
          },
          select: {
            moduleId: true,
            completedAt: true,
            module: { select: { courseId: true, title: true } },
          },
        }),
        ctx.db.attempt.findMany({
          where: {
            userId: learner.id,
            assessment: { courseId: { in: courseIds } },
            status: { in: ["IN_PROGRESS", "SUBMITTED", "GRADED", "TIMED_OUT"] },
          },
          select: {
            assessmentId: true,
            startedAt: true,
            submittedAt: true,
            status: true,
            isPassed: true,
            percentScore: true,
            assessment: {
              select: {
                courseId: true,
                title: true,
              },
            },
          },
        }),
        getOverdueAssessments(ctx.db, {
          ...courseWhere,
          id: { in: courseIds },
        }),
        ctx.db.cohort.findMany({
          where: {
            memberships: { some: { userId: learner.id } },
            courses: {
              some: {
                courseId: { in: courseIds },
                course: courseWhere,
              },
            },
          },
          select: {
            id: true,
            name: true,
          },
        }),
      ]);

      const completionByCourse = new Map<string, Set<string>>();
      const activityDates: Date[] = [];
      for (const completion of completions) {
        const completedSet = completionByCourse.get(completion.module.courseId) ?? new Set<string>();
        completedSet.add(completion.moduleId);
        completionByCourse.set(completion.module.courseId, completedSet);
        activityDates.push(completion.completedAt);
      }

      const attemptsByCourse = new Map<string, typeof attempts>();
      for (const attempt of attempts) {
        const learnerAttempts = attemptsByCourse.get(attempt.assessment.courseId) ?? [];
        learnerAttempts.push(attempt);
        attemptsByCourse.set(attempt.assessment.courseId, learnerAttempts);
        activityDates.push(attempt.submittedAt ?? attempt.startedAt);
      }

      const overdueByCourse = new Map<string, typeof overdueAssessments>();
      for (const item of overdueAssessments.filter((item) => item.learnerId === learner.id)) {
        const learnerOverdue = overdueByCourse.get(item.courseId) ?? [];
        learnerOverdue.push(item);
        overdueByCourse.set(item.courseId, learnerOverdue);
      }

      const latestActivityAt = activityDates.length
        ? new Date(Math.max(...activityDates.map((date) => date.getTime())))
        : null;
      const timeline = [
        ...completions.map((completion) => ({
          type: "module_completion" as const,
          courseId: completion.module.courseId,
          title: `Completed module: ${completion.module.title}`,
          occurredAt: completion.completedAt,
        })),
        ...attempts.map((attempt) => ({
          type: "assessment_attempt" as const,
          courseId: attempt.assessment.courseId,
          title: `${attempt.assessment.title} (${attempt.status.replace(/_/g, " ")})`,
          occurredAt: attempt.submittedAt ?? attempt.startedAt,
        })),
      ]
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
        .slice(0, 12);

      const attemptHistory = attempts
        .map((attempt) => ({
          assessmentId: attempt.assessmentId,
          assessmentTitle: attempt.assessment.title,
          courseId: attempt.assessment.courseId,
          courseTitle:
            learner.enrollments.find((enrollment) => enrollment.courseId === attempt.assessment.courseId)?.course.title ??
            "Course",
          status: attempt.status,
          score: attempt.percentScore,
          isPassed: attempt.isPassed,
          occurredAt: attempt.submittedAt ?? attempt.startedAt,
        }))
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
        .slice(0, 12);

      const courseRows = await Promise.all(
        learner.enrollments.map(async (enrollment) => {
          const access = await getLearnerCourseAccess(ctx.db, learner.id, enrollment.courseId);
          const visibleModuleIds = access.visibleModuleIds ? new Set(access.visibleModuleIds) : null;
          const assignedModules = visibleModuleIds
            ? enrollment.course.modules.filter((module) => visibleModuleIds.has(module.id))
            : enrollment.course.modules;
          const completedSet = completionByCourse.get(enrollment.courseId) ?? new Set<string>();
          const completedModules = assignedModules.filter((module) => completedSet.has(module.id)).length;
          const progress = assignedModules.length
            ? round((completedModules / assignedModules.length) * 100)
            : 0;
          const nextModule =
            assignedModules.find((module) => {
              if (completedSet.has(module.id)) return false;
              if (!module.prerequisiteModuleId) return true;
              if (visibleModuleIds && !visibleModuleIds.has(module.prerequisiteModuleId)) return true;
              return completedSet.has(module.prerequisiteModuleId);
            }) ?? null;
          const courseAttempts = attemptsByCourse.get(enrollment.courseId) ?? [];
          const overdueItems = overdueByCourse.get(enrollment.courseId) ?? [];
          const remainingMinutes = assignedModules.reduce(
            (sum, module) => sum + (completedSet.has(module.id) ? 0 : (module.estimatedMinutes ?? 0)),
            0,
          );

          return {
            courseId: enrollment.courseId,
            courseTitle: enrollment.course.title,
            instructorName: enrollment.course.instructor.name ?? "Unknown",
            progress,
            isCustomPath: access.isCustomPath,
            cohortNames: access.cohortNames,
            completedModules,
            assignedModules: assignedModules.length,
            nextModuleTitle: nextModule?.title ?? null,
            remainingMinutes,
            overdueCount: overdueItems.length,
            overdueTitles: overdueItems.map((item) => item.assessmentTitle),
            passedAssessments: courseAttempts.filter((attempt) => attempt.isPassed).length,
            inProgressAssessments: courseAttempts.filter((attempt) => attempt.status === "IN_PROGRESS").length,
            bestScore: courseAttempts.length
              ? Math.max(...courseAttempts.map((attempt) => attempt.percentScore ?? 0))
              : null,
          };
        }),
      );

      courseRows.sort((a, b) => {
        if (a.overdueCount !== b.overdueCount) return b.overdueCount - a.overdueCount;
        return a.progress - b.progress;
      });

      return {
        learner: {
          id: learner.id,
          name: learner.name ?? "Learner",
          email: learner.email ?? "",
          employeeId: learner.employeeId,
        },
        summary: {
          enrolledCourses: courseRows.length,
          avgProgress: courseRows.length
            ? round(courseRows.reduce((sum, course) => sum + course.progress, 0) / courseRows.length)
            : 0,
          overdueCourses: courseRows.filter((course) => course.overdueCount > 0).length,
          overdueAssessments: courseRows.reduce((sum, course) => sum + course.overdueCount, 0),
          customPathCourses: courseRows.filter((course) => course.isCustomPath).length,
          latestActivityAt,
          cohortCount: cohortAssignments.length,
        },
        cohorts: cohortAssignments,
        courses: courseRows,
        timeline,
        attemptHistory,
      };
    }),

  notifyOverdue: instructorProcedure
    .input(
      z.object({
        courseId: z.string().optional(),
        assessmentId: z.string().optional(),
        learnerId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const role = (ctx.session.user as { role: string }).role;
      const userId = ctx.session.user!.id;
      const courseWhere = role === "INSTRUCTOR" ? { instructorId: userId } : {};
      const overdueAssessments = await getOverdueAssessments(ctx.db, courseWhere);

      const targets = overdueAssessments.filter((item) =>
        (!input.courseId || item.courseId === input.courseId) &&
        (!input.assessmentId || item.assessmentId === input.assessmentId) &&
        (!input.learnerId || item.learnerId === input.learnerId),
      );

      const uniqueTargets = Array.from(
        new Map(targets.map((item) => [`${item.assessmentId}:${item.learnerId}`, item])).values(),
      );

      await Promise.all(
        uniqueTargets.map((target) =>
          createNotification(
            ctx.db,
            target.learnerId,
            "REMINDER",
            `Assessment overdue: ${target.assessmentTitle}`,
            `Please complete ${target.assessmentTitle} in ${target.courseTitle} as soon as possible.`,
            `/assessments/${target.assessmentId}`,
          ),
        ),
      );

      return { sent: uniqueTargets.length };
    }),
});
