import { Router } from "express";
import { protect } from "../middleware/auth.js"; import {
  generateAccessPass,
  verifyAndProcessPass,
} from "../controllers/security.controller.js";

const router = Router();

router.use(protect);

router.post("/passes/generate", generateAccessPass);
router.post("/passes/verify", verifyAndProcessPass);

export default router;
