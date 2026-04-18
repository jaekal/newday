import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";

// Helper — call from other routers to create notifications
export async function createNotification(
  db: PrismaClient,
  userId: string,
  type: string,
  title: string,
  body?: string,
  link?: string,
) {
  return db.notification.create({ data: { userId, type, title, body, link } });
}

export const notificationRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(30) }))
    .query(async ({ ctx, input }) => {
      const notifications = await ctx.db.notification.findMany({
        where: { userId: ctx.session.user.id },
        orderBy: { createdAt: "desc" },
        take: input.limit,
      });
      const unread = notifications.filter((n) => !n.read).length;
      return { notifications, unread };
    }),

  markRead: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const notification = await ctx.db.notification.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        select: { id: true },
      });

      if (!notification) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return ctx.db.notification.update({
        where: { id: notification.id },
        data: { read: true },
      });
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.notification.updateMany({
      where: { userId: ctx.session.user.id, read: false },
      data: { read: true },
    });
    return { success: true };
  }),
});
