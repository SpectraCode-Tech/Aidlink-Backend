import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { AuthenticatedRequest, prisma } from "../middleware/auth.ts";
import { z } from "zod";

const SALT_ROUNDS = 12;


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

        const newUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          role: selectedRole,
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

    return res.status(201).json({
      message: "User registered successfully.",
      userId: newUser.id,
      role: newUser.role,
    });
  } catch (error: any) {
    return next(error);
  }
};

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
      },
    });
  } catch (error: any) {
    return next(error);
  }
};

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
