import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error("❌ CRITICAL: DATABASE_URL environment variable is missing.");
}
if (!process.env.JWT_SECRET) {
  throw new Error("❌ CRITICAL: JWT_SECRET environment variable is missing.");
}

// Remove PrismaPg adapter entirely — use Prisma's built-in connection
// The adapter was causing TLS certificate chain errors with Supabase pooler
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

export interface AuthenticatedUser {
  id: string;
  role: "BENEFICIARY" | "DONOR" | "PARTNER" | "ADMIN" | "SUPER_ADMIN";
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export const protect = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Access token missing or malformed.",
    });
    return;
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Access token credential payload is empty.",
    });
    return;
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET!,
    ) as unknown as AuthenticatedUser;

    req.user = decoded;
    next();
  } catch (err) {
    res.status(403).json({
      error: "Forbidden",
      message:
        "Invalid, tampered, or expired authorization credential signature.",
    });
  }
};
