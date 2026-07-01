import { Router, Request, Response, NextFunction } from "express";
import express from "express";
import { handleNombaWebhook } from "../controllers/webhook.controller.js";

const router = Router();

router.post(
  "/payments/nomba-webhook",
  express.raw({ type: "application/json" }),
  (req: Request, res: Response, next: NextFunction) => {
    try {
            (req as any).rawBody = req.body.toString("utf8");

            req.body = JSON.parse((req as any).rawBody);

      next();
    } catch {
      res.status(400).json({
        error: "BadRequest",
        message: "Webhook payload could not be parsed as valid JSON.",
      });
    }
  },
  handleNombaWebhook,
);

export default router;
