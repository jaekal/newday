import { createTRPCRouter } from "@/server/trpc";
import { userRouter } from "./user";
import { courseRouter } from "./course";
import { enrollmentRouter } from "./enrollment";
import { questionRouter } from "./question";
import { assessmentRouter } from "./assessment";
import { gradeRouter } from "./grade";
import { activityRouter } from "./activity";
import { notificationRouter } from "./notification";
import { cohortRouter } from "./cohort";
import { reportRouter } from "./report";

export const appRouter = createTRPCRouter({
  user: userRouter,
  course: courseRouter,
  enrollment: enrollmentRouter,
  question: questionRouter,
  assessment: assessmentRouter,
  grade: gradeRouter,
  activity: activityRouter,
  notification: notificationRouter,
  cohort: cohortRouter,
  report: reportRouter,
});

export type AppRouter = typeof appRouter;
