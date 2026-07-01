import { Router } from "express";
import {
  initializeDonation,
  getCloudinarySignature,
  InitializeDonationSchema,
} from "../controllers/payments.controller.js";
import { protect } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

router.post(
  "/donate",
  protect,
  validate(InitializeDonationSchema),
  initializeDonation,
);

router.get("/cloudinary-signature", protect, getCloudinarySignature);


export default router;
