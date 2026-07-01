import app from "./app.js";
import { prisma } from "./middleware/auth.js";

const PORT = process.env.PORT || 8080;

const startServer = async (): Promise<void> => {
  try {
        await prisma.$connect();
    console.log(
      "📂 [DATABASE] Connected to PostgreSQL pool cluster successfully via Prisma 7 Adapter.",
    );

    const server = app.listen(PORT, () => {
      console.log(
        `🚀 [SERVER RUNNING] AidLink Core Engine listening securely on port: ${PORT}`,
      );
    });

        const shutdown = async (signal: string): Promise<void> => {
      console.log(
        `\n🛑 [${signal}] Received. Closing HTTP server and flushing pool metrics...`,
      );
      server.close(async () => {
        await prisma.$disconnect();
        console.log(
          "👋 [SERVER CLOSED] Safe database connection release completed.",
        );
        process.exit(0);
      });
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    console.error(
      "❌ [FATAL] Server infrastructure initialization failed to boot:",
      error,
    );
    process.exit(1);
  }
};

void startServer();
