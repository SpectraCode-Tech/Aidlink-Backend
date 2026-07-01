import { Router } from "express";
import { protect } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  createRequest,
  claimRequest,
  updateRequestStatus,
  completeFulfillment,
  getAvailableJobsFeed,
  CreateRequestSchema,
  UpdateStatusSchema,
  CompleteFulfillmentSchema,
  FeedQuerySchema,
} from "../controllers/logistics.controller.js";

const router = Router();

router.use(protect);

router.post("/requests", validate(CreateRequestSchema), createRequest);

router.patch("/requests/:requestId/claim", claimRequest);

router.patch(
  "/requests/:requestId/status",
  validate(UpdateStatusSchema),
  updateRequestStatus,
);

router.post(
  "/requests/:requestId/complete",
  validate(CompleteFulfillmentSchema),
  completeFulfillment,
);

router.get("/feed", validate(FeedQuerySchema), getAvailableJobsFeed);

export default router;
