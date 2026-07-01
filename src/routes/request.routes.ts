import { Router } from "express";
import {
  createAidRequest,
  getAllRequests,
  getRequestById,
} from "../controllers/request.controller.js";
import { protect } from "../middleware/auth.js";
import { restrictTo } from "../middleware/rbac.middleware.js";
import { validate, CreateAidRequestSchema } from "../middleware/validate.js";

const router = Router();

router.get("/", getAllRequests);
router.get("/:id", getRequestById);

router.post(
  "/",
  protect,
  restrictTo("BENEFICIARY"),
  validate(CreateAidRequestSchema),
  createAidRequest,
);

export default router;
