import { Response, NextFunction } from "express";
import { AuthenticatedRequest, prisma } from "../middleware/auth.js";
import crypto from "crypto";
import { z } from "zod";


export const CreatePassSchema = z.object({
  body: z.object({
    visitorName: z.string().min(2, "Visitor legal name is required."),
    purpose: z.string().optional(),
    validDurationHours: z.number().min(1).max(72).default(24),
    maxUses: z.number().min(1).default(1),
  }),
});

export const VerifyPassSchema = z.object({
  body: z.object({
    passCode: z.string().transform((val) => val.trim().toUpperCase()),
    notes: z.string().optional(),
  }),
});

const generateReadableToken = (): string => {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let token = "";
  for (let i = 0; i < 6; i++) {
    const randomIndex = crypto.randomInt(0, chars.length);
    token += chars[randomIndex];
  }
  return token;
};


export const generateAccessPass = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
        const { visitorName, purpose, validDurationHours, maxUses } =
      CreatePassSchema.parse({ body: req.body }).body;

    const creatorId = req.user?.id;
    if (!creatorId) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "User context trace missing.",
      });
    }

    const passCode = generateReadableToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + validDurationHours);

    const accessPass = await prisma.accessPass.create({
      data: {
        creatorId,
        visitorName,
        purpose: purpose ?? null,
        passCode,
        maxUses,
        expiresAt,
      },
    });

    const qrPayload = JSON.stringify({
      v: "1.0",
      code: passCode,
      name: visitorName,
    });

    return res.status(201).json({
      message: "Security entry access token generated successfully.",
      passDetails: {
        id: accessPass.id,
        passCode: accessPass.passCode,
        visitorName: accessPass.visitorName,
        expiresAt: accessPass.expiresAt,
        status: accessPass.status,
      },
      qrPayload,
    });
  } catch (error) {
    return next(error);
  }
};

export const verifyAndProcessPass = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
        const { passCode, notes } = VerifyPassSchema.parse({ body: req.body }).body;

    const checkpointBy = req.user?.id;
    if (!checkpointBy) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Terminal device authentication missing.",
      });
    }

    const verificationResult = await prisma.$transaction(async (tx) => {
      const pass = await tx.accessPass.findUnique({ where: { passCode } });

      if (!pass) throw new Error("NOT_FOUND");

      const now = new Date();

            if (now > pass.expiresAt) {
        if (pass.status === "ACTIVE") {
          await tx.accessPass.update({
            where: { id: pass.id },
            data: { status: "EXPIRED" },
          });
        }
        await tx.securityAccessLog.create({
          data: {
            passId: pass.id,
            action: "DENIED_EXPIRED",
            checkpointBy,
            notes: notes ?? null,
          },
        });
        throw new Error("PASS_EXPIRED");
      }

            if (pass.status !== "ACTIVE" || pass.useCount >= pass.maxUses) {
        await tx.securityAccessLog.create({
          data: {
            passId: pass.id,
            action: "DENIED_REUSED",
            checkpointBy,
            notes: notes ?? null,
          },
        });
        throw new Error("PASS_UNAVAILABLE");
      }

      const nextUseCount = pass.useCount + 1;
      const finalStatus = nextUseCount >= pass.maxUses ? "USED" : "ACTIVE";

      const updatedPass = await tx.accessPass.update({
        where: { id: pass.id },
        data: { useCount: nextUseCount, status: finalStatus },
      });

      await tx.securityAccessLog.create({
        data: {
          passId: pass.id,
          action: "CHECK_IN",
          checkpointBy,
          notes:
            notes ?? `Successful check-in: ${nextUseCount}/${pass.maxUses}`,
        },
      });

      return updatedPass;
    });

    return res.status(200).json({
      accessGranted: true,
      message: "Access confirmed.",
      visitor: verificationResult.visitorName,
      status: verificationResult.status,
    });
  } catch (error: any) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({
        accessGranted: false,
        error: "NotFound",
        message: "Security pass code not found.",
      });
    }
    if (error.message === "PASS_EXPIRED") {
      return res.status(410).json({
        accessGranted: false,
        error: "Gone",
        message: "This pass has expired.",
      });
    }
    if (error.message === "PASS_UNAVAILABLE") {
      return res.status(422).json({
        accessGranted: false,
        error: "Unprocessable",
        message: "This pass has already been used or is inactive.",
      });
    }
    return next(error);
  }
};
