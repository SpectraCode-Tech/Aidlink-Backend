import { Router } from "express";
import {
  registerUser,
  loginUser,
  getCurrentUser,
  verifyOTP,
  resendOTP,
  RegisterSchema,
  LoginSchema,
  VerifyOTPSchema,
  ResendOTPSchema,
} from "../controllers/auth.controller.js";
import { protect } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

// Registration — creates account and sends OTP
router.post("/register", validate(RegisterSchema), registerUser);

// OTP verification — activates account and issues JWT
router.post("/verify-otp", validate(VerifyOTPSchema), verifyOTP);

// Resend OTP — generates new code and resends email
router.post("/resend-otp", validate(ResendOTPSchema), resendOTP);

// Login — blocked if account not verified
router.post("/login", validate(LoginSchema), loginUser);

// Current user profile
router.get("/me", protect, getCurrentUser);

export default router;
