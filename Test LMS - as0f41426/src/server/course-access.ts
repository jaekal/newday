import type { PrismaClient } from "@prisma/client";

type AccessDb = PrismaClient;

export type LearnerCourseAccess = {
  cohortNames: string[];
  hasCohortAssignment: boolean;
  isCustomPath: boolean;
  visibleModuleIds: string[] | null;
};

export async function getLearnerCourseAccess(
  db: AccessDb,
  userId: string,
  courseId: string,
): Promise<LearnerCourseAccess> {
  const [enrollment, cohortAssignments] = await Promise.all([
    db.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { status: true },
    }),
    db.cohortCourse.findMany({
      where: {
        courseId,
        cohort: {
          memberships: {
            some: { userId },
          },
        },
      },
      select: {
        cohort: { select: { name: true } },
        moduleSelections: { select: { moduleId: true } },
      },
    }),
  ]);

  const cohortNames = cohortAssignments.map((assignment) => assignment.cohort.name);
  const hasCohortAssignment = cohortAssignments.length > 0;

  if (hasCohortAssignment) {
    const includesFullCourse = cohortAssignments.some(
      (assignment) => assignment.moduleSelections.length === 0,
    );

    if (includesFullCourse) {
      return {
        cohortNames,
        hasCohortAssignment: true,
        isCustomPath: false,
        visibleModuleIds: null,
      };
    }

    const visibleModuleIds = Array.from(
      new Set(
        cohortAssignments.flatMap((assignment) =>
          assignment.moduleSelections.map((selection) => selection.moduleId),
        ),
      ),
    );

    return {
      cohortNames,
      hasCohortAssignment: true,
      isCustomPath: true,
      visibleModuleIds,
    };
  }

  if (enrollment && enrollment.status !== "DROPPED") {
    return {
      cohortNames: [],
      hasCohortAssignment: false,
      isCustomPath: false,
      visibleModuleIds: null,
    };
  }

  return {
    cohortNames: [],
    hasCohortAssignment: false,
    isCustomPath: false,
    visibleModuleIds: null,
  };
}
