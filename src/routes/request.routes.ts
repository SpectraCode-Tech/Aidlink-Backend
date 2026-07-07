import { Router } from "express";
import {
  createAidRequest,
  getAllRequests,
  getRequestById,
  getBeneficiaryDashboard,
} from "../controllers/request.controller.js";
import { protect } from "../middleware/auth.js";
import { restrictTo } from "../middleware/rbac.middleware.js";
import { validate, CreateAidRequestSchema } from "../middleware/validate.js";

const router = Router();

// Public discovery routes
router.get("/", getAllRequests);

// Beneficiary dashboard — must be before /:id to avoid conflict
router.get("/dashboard/me", protect, restrictTo("BENEFICIARY"), getBeneficiaryDashboard);

// Single request
router.get("/:id", getRequestById);

// Create aid request
router.post(
  "/",
  protect,
  restrictTo("BENEFICIARY"),
  validate(CreateAidRequestSchema),
  createAidRequest,
);

export default router;