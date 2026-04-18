import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/routers/_app";
import { createTRPCContext } from "@/server/trpc";

const handler = async (req: Request) => {
  try {
    return await fetchRequestHandler({
      endpoint: "/api/trpc",
      req,
      router: appRouter,
      createContext: createTRPCContext,
      onError:
        process.env.NODE_ENV === "development"
          ? ({ path, error }) => {
              console.error(`tRPC error on ${path ?? "<no-path>"}:`, error);
            }
          : undefined,
    });
  } catch (error) {
    console.error("Unhandled tRPC route error:", error);

    return Response.json(
      {
        error: {
          message:
            error instanceof Error ? error.message : "Unhandled tRPC route error",
        },
      },
      { status: 500 }
    );
  }
};

export { handler as GET, handler as POST };
