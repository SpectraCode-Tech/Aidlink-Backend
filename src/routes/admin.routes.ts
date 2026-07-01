import { Router } from "express";
import { protect } from "../middleware/auth.js"; import { restrictTo } from "../middleware/rbac.middleware.js"; import {
  getSystemMetrics,
  getAuditLogs,
  manualOverrideFulfillment,
} from "../controllers/admin.controller.js";

const router = Router();

router.use(protect);
router.use(restrictTo("ADMIN", "SUPER_ADMIN")); 
router.get("/metrics", getSystemMetrics);
router.get("/audit-failures", getAuditLogs);
router.post("/requests/:requestId/override", manualOverrideFulfillment);

export default router;
