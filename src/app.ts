import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
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

// =========================================================================
// RATE LIMITERS
// =========================================================================

/**
 * Auth limiter — 10 attempts per 15 minutes per IP
 * Prevents brute force on login and registration
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "TooManyRequests",
    message: "Too many attempts from this IP. Please try again in 15 minutes.",
  },
});

/**
 * KYC limiter — 5 attempts per hour per IP
 * Prevents abuse of Smile ID verification endpoints
 */
const kycLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "TooManyRequests",
    message: "KYC attempt limit reached. Please try again in 1 hour.",
  },
});

/**
 * General API limiter — 100 requests per minute per IP
 * Prevents general abuse across all endpoints
 */
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "TooManyRequests",
    message: "Too many requests. Please slow down.",
  },
});

/**
 * Donation limiter — 20 donations per hour per IP
 * Prevents checkout spam which costs money
 */
const donationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "TooManyRequests",
    message: "Donation limit reached. Please try again in 1 hour.",
  },
});

// =========================================================================
// CORS
// =========================================================================

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  }),
);

// =========================================================================
// WEBHOOK REGION — mounted BEFORE global body parsers
// Preserves raw body bytes needed for HMAC signature validation
// =========================================================================

app.use("/webhooks", webhookRouter);

// =========================================================================
// GLOBAL BODY PARSERS — applied AFTER webhook routes
// =========================================================================

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// =========================================================================
// APPLY RATE LIMITERS
// =========================================================================

app.use(generalLimiter);
app.use("/auth/login", authLimiter);
app.use("/auth/register", authLimiter);
app.use("/verification", kycLimiter);
app.use("/payments/donate", donationLimiter);

// =========================================================================
// HEALTH CHECK
// =========================================================================

app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "active",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// =========================================================================
// DOMAIN ROUTING
// =========================================================================

app.use("/auth", authRouter);
app.use("/requests", requestRouter);
app.use("/payments", paymentRouter);
app.use("/verification", verificationRouter);
app.use("/logistics", logisticsRouter);
app.use("/admin", adminRouter);
app.use("/security", securityRouter);

// =========================================================================
// GLOBAL ERROR HANDLER
// =========================================================================

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