import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Resend } from "resend";
import { AuthenticatedRequest, prisma } from "../middleware/auth.js";
import { z } from "zod";

const SALT_ROUNDS = 12;
const resend = new Resend(process.env.RESEND_API_KEY);

// ==========================================
// HELPERS
// ==========================================

/**
 * Generates a cryptographically random 6-digit OTP.
 */
const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Sends an OTP email to the user using Resend.
 */
const sendOTPEmail = async (
  email: string,
  otp: string,
  name?: string,
): Promise<void> => {
  await resend.emails.send({
    from: "AidLink <onboarding@resend.dev>",
    to: email,
    subject: "Your AidLink Verification Code",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <div style="background: #1a1a2e; padding: 20px; border-radius: 8px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 24px;">AidLink</h1>
          <p style="color: #94a3b8; margin: 4px 0 0;">Humanitarian Aid Platform</p>
        </div>
        <div style="padding: 24px 0;">
          <p style="color: #1a1a2e; font-size: 16px;">Hello${name ? ` ${name}` : ""},</p>
          <p style="color: #374151;">Use the code below to verify your account. This code expires in <strong>10 minutes</strong>.</p>
          <div style="background: #f4f4f8; border-radius: 8px; padding: 24px; text-align: center; margin: 24px 0;">
            <span style="font-size: 40px; font-weight: bold; letter-spacing: 12px; color: #1a1a2e;">${otp}</span>
          </div>
          <p style="color: #6b7280; font-size: 14px;">If you did not create an AidLink account, you can safely ignore this email.</p>
        </div>
        <div style="border-top: 1px solid #e5e7eb; padding-top: 16px;">
          <p style="color: #9ca3af; font-size: 12px; text-align: center;">AidLink · DevCareer x Nomba Hackathon 2026</p>
        </div>
      </div>
    `,
  });
};

// ==========================================
// SCHEMAS
// ==========================================

export const RegisterSchema = z.object({
  body: z
    .object({
      email: z.string().email("Invalid email structure provided."),
      password: z
        .string()
        .min(8, "Password must be at least 8 characters long."),
      role: z.enum(["BENEFICIARY", "DONOR", "PARTNER", "ADMIN"]).optional(),
      partnerName: z.string().min(2).optional(),
      category: z.string().min(2).optional(),
      bankAccount: z
        .string()
        .length(10, "Bank account must be a valid 10-digit NUBAN number.")
        .optional(),
      bankAccountName: z
        .string()
        .min(2, "Bank account name is required for partner payouts.")
        .optional(),
      bankCode: z
        .string()
        .length(3, "Bank code must be a valid 3-digit CBN routing code.")
        .optional(),
    })
    .superRefine((data, ctx) => {
      if (data.role === "PARTNER") {
        if (!data.partnerName) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["partnerName"],
            message: "Business name is required for partner registration.",
          });
        }
        if (!data.category) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["category"],
            message: "Business category is required for partner registration.",
          });
        }
        if (!data.bankAccount) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["bankAccount"],
            message:
              "Bank account number is required for partner registration.",
          });
        }
        if (!data.bankAccountName) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["bankAccountName"],
            message: "Bank account name is required for partner registration.",
          });
        }
        if (!data.bankCode) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["bankCode"],
            message: "Bank code is required for partner registration.",
          });
        }
      }
    }),
});

export const LoginSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email structure provided."),
    password: z.string().min(1, "Password is required."),
  }),
});

export const VerifyOTPSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email structure provided."),
    otp: z.string().length(6, "OTP must be exactly 6 digits."),
  }),
});

export const ResendOTPSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email structure provided."),
  }),
});

// ==========================================
// CONTROLLER ACTIONS
// ==========================================

/**
 * POST /auth/register
 * Creates user account and sends OTP verification email.
 * Account is inactive (isVerified: false) until OTP is confirmed.
 */
export const registerUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const {
      email,
      password,
      role,
      partnerName,
      category,
      bankAccount,
      bankAccountName,
      bankCode,
    } = req.body;

    const selectedRole = role || "BENEFICIARY";

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({
        error: "Conflict",
        message: "Email already in use on this platform.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const otp = generateOTP();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const newUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          role: selectedRole,
          isVerified: false,
          otpCode: otp,
          otpExpiresAt,
        },
      });

      if (user.role === "BENEFICIARY") {
        await tx.beneficiary.create({ data: { userId: user.id } });
      } else if (user.role === "PARTNER") {
        await tx.fulfillmentPartner.create({
          data: {
            userId: user.id,
            name: partnerName!,
            category: category!,
            bankAccount: bankAccount!,
            bankAccountName: bankAccountName!,
            bankCode: bankCode!,
          },
        });
      }

      return user;
    });

    // Send OTP email — non-blocking, don't fail registration if email fails
    try {
      await sendOTPEmail(email, otp);
    } catch (emailError) {
      console.error("[OTP EMAIL ERROR]", emailError);
    }

    return res.status(201).json({
      message:
        "Registration successful. Please check your email for a 6-digit verification code.",
      userId: newUser.id,
      role: newUser.role,
      isVerified: false,
    });
  } catch (error: any) {
    return next(error);
  }
};

/**
 * POST /auth/verify-otp
 * Verifies the 6-digit OTP and activates the user account.
 */
export const verifyOTP = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const { email, otp } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json({
        error: "NotFound",
        message: "No account found with this email address.",
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        error: "BadRequest",
        message: "This account is already verified.",
      });
    }

    if (!user.otpCode || !user.otpExpiresAt) {
      return res.status(400).json({
        error: "BadRequest",
        message: "No OTP found. Please request a new one.",
      });
    }

    // Check expiry
    if (new Date() > user.otpExpiresAt) {
      return res.status(400).json({
        error: "BadRequest",
        message: "OTP has expired. Please request a new verification code.",
      });
    }

    // Check OTP match
    if (user.otpCode !== otp) {
      return res.status(400).json({
        error: "BadRequest",
        message: "Invalid verification code. Please try again.",
      });
    }

    // Activate account and clear OTP
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        otpCode: null,
        otpExpiresAt: null,
      },
    });

    // Issue JWT immediately so user doesn't have to login again
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET is not configured.");

    const token = jwt.sign({ id: user.id, role: user.role }, secret, {
      expiresIn: "24h",
    });

    return res.status(200).json({
      message: "Email verified successfully. Welcome to AidLink.",
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        isVerified: true,
      },
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /auth/resend-otp
 * Generates a new OTP and resends it to the user's email.
 */
export const resendOTP = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const { email } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Return success even if user not found — prevents email enumeration
      return res.status(200).json({
        message:
          "If an account exists with this email, a new code has been sent.",
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        error: "BadRequest",
        message: "This account is already verified.",
      });
    }

    const otp = generateOTP();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: { otpCode: otp, otpExpiresAt },
    });

    try {
      await sendOTPEmail(email, otp);
    } catch (emailError) {
      console.error("[OTP EMAIL ERROR]", emailError);
    }

    return res.status(200).json({
      message: "A new verification code has been sent to your email.",
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /auth/login
 * Authenticates user. Blocks login if account is not verified.
 */
export const loginUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid email or password.",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid email or password.",
      });
    }

    // Block unverified accounts from logging in
    if (!user.isVerified) {
      return res.status(403).json({
        error: "Forbidden",
        message:
          "Please verify your email address before logging in. Check your inbox for the verification code.",
        isVerified: false,
      });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET is not configured.");

    const token = jwt.sign({ id: user.id, role: user.role }, secret, {
      expiresIn: "24h",
    });

    return res.status(200).json({
      message: "Login successful.",
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
      },
    });
  } catch (error: any) {
    return next(error);
  }
};

/**
 * GET /auth/me
 * Returns current authenticated user profile.
 */
export const getCurrentUser = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const authenticatedUser = req.user;
    if (!authenticatedUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { id: authenticatedUser.id },
      select: {
        id: true,
        email: true,
        role: true,
        isVerified: true,
        createdAt: true,
        beneficiaryProfile: true,
        partnerProfile: {
          select: {
            id: true,
            name: true,
            category: true,
            bankAccount: true,
            bankAccountName: true,
            bankCode: true,
            cacNumber: true,
            cacStatus: true,
            trustScore: true,
          },
        },
      },
    });

    return res.status(200).json({ user });
  } catch (error) {
    return next(error);
  }
};
