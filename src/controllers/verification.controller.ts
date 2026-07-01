import { Response, NextFunction } from "express";
import { AuthenticatedRequest, prisma } from "../middleware/auth.js";
import crypto from "crypto";
import { z } from "zod";


export const NinVerificationSchema = z.object({
  body: z.object({
    nin: z.string().length(11, "NIN must be exactly 11 digits long."),
  }),
});

export const CacVerificationSchema = z.object({
  body: z.object({
    cacNumber: z.string().min(3, "Valid CAC RC/BN number required."),
    companyType: z.enum(["RC", "BN", "LLC"]),
    businessName: z
      .string()
      .min(2, "Business legal name is required for verification."),
  }),
});

export const FaceMatchSchema = z.object({
  body: z.object({
    selfieUrl: z
      .string()
      .url("A valid secured image URL is required for the live selfie."),
    documentImageUrl: z
      .string()
      .url("A valid image URL is required for the document profile photo."),
  }),
});


const SMILE_ID_BASE_URL =
  process.env.SMILE_ID_BASE_URL || "https://sandbox.smileidentity.com/v1";
const generateSmileSignature = (timestamp: string) => {
  const partnerId = process.env.SMILE_ID_PARTNER_ID!;
  const apiKey = process.env.SMILE_ID_API_KEY!;
  const hmac = crypto.createHmac("sha256", apiKey);
  hmac.update(timestamp);
  hmac.update(partnerId);
  hmac.update("sid_request");
  return hmac.digest("base64");
};

const hashValue = (value: string) => {
  return crypto.createHash("sha256").update(value).digest("hex");
};


export const verifyNIN = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const { nin } = NinVerificationSchema.parse({ body: req.body }).body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "User context trace missing.",
      });
    }

    const beneficiary = await prisma.beneficiary.findUnique({
      where: { userId },
    });

    if (!beneficiary) {
      return res.status(404).json({
        error: "NotFound",
        message: "Beneficiary profile trace failed.",
      });
    }

    const hashedNin = hashValue(nin);

    const duplicateCheck = await prisma.beneficiary.findUnique({
      where: { ninHash: hashedNin },
    });
    if (duplicateCheck && duplicateCheck.id !== beneficiary.id) {
      return res.status(400).json({
        error: "Conflict",
        message: "This National Identification Number is already registered.",
      });
    }

    /* ==========================================
       REAL SMILE ID ENDPOINT (Production)
       ==========================================
    const timestamp = new Date().toISOString();
    const signature = generateSmileSignature(timestamp);
    const response = await axios.post(`${SMILE_ID_BASE_URL}/id_verification`, {
      partner_id: process.env.SMILE_ID_PARTNER_ID,
      timestamp,
      signature,
      id_number: nin,
      id_type: "NIN_V2",
      country: "NG",
      partner_params: {
        job_id: `JOB-NIN-${Date.now()}`,
        user_id: `USER-${userId.substring(0, 8)}`,
        job_type: 5,
      },
    });
    const resultCode = response.data?.ResultCode;
    if (resultCode === "1012") {
      await prisma.beneficiary.update({
        where: { id: beneficiary.id },
        data: { ninHash: hashedNin, ninStatus: "VERIFIED" },
      });
      return res.status(200).json({ status: "VERIFIED", message: "NIN verified against NIMC registry." });
    }
    return res.status(422).json({ status: "FAILED", code: resultCode, message: response.data?.ResultText || "NIMC match failed." });
    ========================================== */

    const lastDigit = nin.charAt(nin.length - 1);
    if (lastDigit === "1") {
      return res.status(422).json({
        status: "FAILED",
        code: "1013",
        message: "[MOCK] No document registry matches discovered.",
      });
    }
    if (lastDigit === "2") {
      return res.status(400).json({
        status: "FAILED",
        code: "1014",
        message: "[MOCK] Format validation constraints failed.",
      });
    }

    await prisma.beneficiary.update({
      where: { id: beneficiary.id },
      data: { ninHash: hashedNin, ninStatus: "VERIFIED" },
    });

    return res.status(200).json({
      status: "VERIFIED",
      message: "[MOCK] NIN verified successfully.",
    });
  } catch (error: any) {
    return next(error);
  }
};

export const verifyFaceBiometrics = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
        const { selfieUrl, documentImageUrl } = FaceMatchSchema.parse({
      body: req.body,
    }).body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "User context trace missing.",
      });
    }

    const beneficiary = await prisma.beneficiary.findUnique({
      where: { userId },
    });

    if (!beneficiary) {
      return res.status(404).json({
        error: "NotFound",
        message: "Beneficiary profile trace failed.",
      });
    }

    
        if (
      selfieUrl.toLowerCase().includes("fail") ||
      documentImageUrl.toLowerCase().includes("fail")
    ) {
      await prisma.beneficiary.update({
        where: { id: beneficiary.id },
        data: { faceMatchStatus: "FAILED" },
      });
      return res.status(422).json({
        status: "FAILED",
        message: "[MOCK] Face biometric validation failed.",
      });
    }

    await prisma.beneficiary.update({
      where: { id: beneficiary.id },
      data: { faceMatchStatus: "VERIFIED" },
    });

    return res.status(200).json({
      status: "VERIFIED",
      message: "[MOCK] Biometric identity correlation cleared successfully.",
    });
  } catch (error) {
    return next(error);
  }
};

export const verifyCAC = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
        const { cacNumber, businessName } = CacVerificationSchema.parse({
      body: req.body,
    }).body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "User context trace missing.",
      });
    }

    const partner = await prisma.fulfillmentPartner.findUnique({
      where: { userId },
    });

    if (!partner) {
      return res.status(404).json({
        error: "NotFound",
        message: "Fulfillment partner profile not found.",
      });
    }

    
        if (cacNumber.endsWith("1")) {
      return res.status(422).json({
        status: "FAILED",
        message: "[MOCK] No matching entity found on CAC register.",
      });
    }

    await prisma.fulfillmentPartner.update({
      where: { id: partner.id },
      data: { cacNumber, cacStatus: "VERIFIED" },
    });

    return res.status(200).json({
      status: "VERIFIED",
      businessName: businessName.toUpperCase(),
      message: "[MOCK] Corporate entity verified by development register.",
    });
  } catch (error) {
    return next(error);
  }
};
