import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "./auth.ts";

export const restrictTo = (
  ...allowedRoles: (
    | "BENEFICIARY"
    | "DONOR"
    | "PARTNER"
    | "ADMIN"
    | "SUPER_ADMIN"
  )[]
) => {
  return (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): void => {
    if (!req.user || !req.user.role) {
      res.status(401).json({
        error: "Unauthorized",
        message: "Authentication context missing or invalid.",
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: "Forbidden",
        message:
          "Access denied. Your account lacks the required operational clearance.",
      });
      return;
    }

    next();
  };
};
