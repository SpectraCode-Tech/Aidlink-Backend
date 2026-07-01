import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRouter from "./routes/auth.routes.js";
import requestRouter from "./routes/request.routes.js";
import paymentRouter from "./routes/payment.routes.js";
import verificationRouter from "./routes/verification.routes.js";
import webhookRouter from "./routes/webhook.routes.js";
import logisticsRouter from "./routes/logistics.routes.js";
import adminRouter from "./routes/admin.routes.js";
import securityRouter from "./routes/security.routes.js";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  }),
);

app.use("/webhooks", webhookRouter);

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "active",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

app.use("/auth", authRouter);
app.use("/requests", requestRouter);
app.use("/payments", paymentRouter);
app.use("/verification", verificationRouter);
app.use("/logistics", logisticsRouter);
app.use("/admin", adminRouter);
app.use("/security", securityRouter);

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error(`[ERROR]: ${err.stack || err.message || err}`);

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: err.name || "InternalServerError",
    message:
      err.message || "An unexpected error occurred within the platform engine.",
    ...(process.env.NODE_ENV !== "production" && {
      details: err.details || err,
    }),
  });
});

export default app;
