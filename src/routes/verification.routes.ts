import { Router } from "express";
import {
  verifyNIN,
  verifyFaceBiometrics,
  verifyCAC,
} from "../controllers/verification.controller.js";
import { protect } from "../middleware/auth.js"; import { restrictTo } from "../middleware/rbac.middleware.js"; 
const router = Router();


router.post("/verify-nin", protect, restrictTo("BENEFICIARY"), verifyNIN);

router.post(
  "/verify-face",
  protect,
  restrictTo("BENEFICIARY"),
  verifyFaceBiometrics,
);


router.post("/verify-cac", protect, restrictTo("PARTNER"), verifyCAC);

export default router;
