import { initTRPC, TRPCError } from "@trpc/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import superjson from "superjson";
import { ZodError } from "zod";

export async function createTRPCContext() {
  const session = await auth();
  return { db, session };
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

const isAuthenticated = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user?.id) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if ((ctx.session.user as { isActive?: boolean }).isActive === false) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This account is inactive" });
  }
  return next({ ctx: { session: ctx.session, db: ctx.db } });
});

const isInstructor = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user?.id) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  const role = (ctx.session.user as { role: string }).role;
  if (role !== "INSTRUCTOR" && role !== "ADMIN" && role !== "MANAGER") {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({ ctx: { session: ctx.session, db: ctx.db } });
});

const isAdmin = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user?.id) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  const role = (ctx.session.user as { role: string }).role;
  if (role !== "ADMIN" && role !== "MANAGER") {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({ ctx: { session: ctx.session, db: ctx.db } });
});

export const protectedProcedure = t.procedure.use(isAuthenticated);
export const instructorProcedure = t.procedure.use(isInstructor);
export const adminProcedure = t.procedure.use(isAdmin);
