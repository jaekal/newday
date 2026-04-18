import { createTRPCContext } from "@/server/trpc";
import { appRouter } from "@/server/routers/_app";
import { createCallerFactory } from "@trpc/server";

const createCaller = createCallerFactory(appRouter);

export const serverTrpc = createCaller(createTRPCContext);
