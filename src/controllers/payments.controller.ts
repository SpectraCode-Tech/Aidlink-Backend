import { Request, Response, NextFunction } from "express";
import { AuthenticatedRequest, prisma } from "../middleware/auth.js";
import { v2 as cloudinary } from "cloudinary";
import axios from "axios";
import { z } from "zod";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "",
  api_key: process.env.CLOUDINARY_API_KEY || "",
  api_secret: process.env.CLOUDINARY_API_SECRET || "",
});

// ==========================================
// CENTRALIZED ROUTE INPUT SCHEMAS
// ==========================================

export const InitializeDonationSchema = z.object({
  body: z.object({
    requestId: z.string().min(1, "Target aid request ID is required."),
    amount: z.number().positive("Donation amount must be greater than 0."),
    customerEmail: z
      .string()
      .email("Invalid donor email structure provided.")
      .optional(),
  }),
});

// ==========================================
// TOKEN CACHE
// Nomba access tokens are short-lived. We cache them in memory
// and only re-authenticate when the token has expired.
// This avoids a round-trip auth call on every payment action.
// ==========================================

let cachedToken: string | null = null;
let tokenExpiresAt: Date | null = null;

export const getNombaAccessToken = async (): Promise<string> => {
  // Return cached token if it's still valid (with 60s buffer)
  if (cachedToken && tokenExpiresAt) {
    const bufferMs = 60 * 1000;
    if (new Date().getTime() < tokenExpiresAt.getTime() - bufferMs) {
      return cachedToken;
    }
  }

  // Auth uses client_id + client_secret (private key from Nomba dashboard)
  const authResponse = await axios.post(
    `${process.env.NOMBA_BASE_URL}/v1/auth/token/issue`,
    {
      grant_type: "client_credentials",
      client_id: process.env.NOMBA_CLIENT_ID,
      client_secret: process.env.NOMBA_CLIENT_SECRET,
    },
    { headers: { accountId: process.env.NOMBA_ACCOUNT_ID } },
  );

  const { access_token, expiresAt } = authResponse.data.data;

  // Cache the token and its expiry
  cachedToken = access_token;
  tokenExpiresAt = new Date(expiresAt);

  return access_token;
};

// ==========================================
// CONTROLLER ACTIONS
// ==========================================

/**
 * GET /payments/cloudinary-signature
 * Returns a signed Cloudinary upload token for secure client-side invoice uploads.
 */
export const getCloudinarySignature = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!apiSecret) {
      return res.status(500).json({
        error: "InternalServerError",
        message: "Cloudinary API secret is not configured.",
      });
    }

    const timestamp = Math.round(new Date().getTime() / 1000);

    const signature = cloudinary.utils.api_sign_request(
      { timestamp, folder: "invoices" },
      apiSecret,
    );

    return res.status(200).json({
      signature,
      timestamp,
      apiKey: process.env.CLOUDINARY_API_KEY,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /payments/donate
 *
 * Initializes a Nomba hosted checkout session for a donor contributing
 * to an aid campaign.
 *
 * Key facts from Nomba docs:
 * - amount is a STRING in NAIRA ("10000.00"), not an integer in Kobo
 * - Custom data must go in `orderMetaData`, not `metadata`
 * - callbackUrl is where Nomba redirects the donor after payment
 * - Webhook event fired on success: "payment_success"
 * - orderReference is appended as query param on callbackUrl redirect
 */
export const initializeDonation = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const { requestId, amount, customerEmail } = req.body;

    const targetRequest = await prisma.request.findUnique({
      where: { id: requestId },
    });

    if (!targetRequest) {
      return res.status(404).json({
        error: "NotFound",
        message: "Target aid request not found.",
      });
    }

    if (targetRequest.status === "REJECTED") {
      return res.status(400).json({
        error: "BadRequest",
        message: "Cannot donate to a rejected aid request.",
      });
    }

    const accessToken = await getNombaAccessToken();
    const orderReference = `AL-TX-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // NAIRA STRING: Nomba checkout amount must be a decimal string in Naira
    // e.g. 10000 → "10000.00"  NOT 1000000 (Kobo)
    const amountAsString = Number(amount).toFixed(2);

    const checkoutResponse = await axios.post(
      `${process.env.NOMBA_BASE_URL}/v1/checkout/order`,
      {
        order: {
          orderReference,
          amount: amountAsString,
          currency: "NGN",
          customerEmail: customerEmail || "anonymous@aidlink.ng",
          // callbackUrl: where Nomba redirects the donor after payment
          // orderReference is appended as ?orderReference=... query param
          callbackUrl: process.env.NOMBA_CALLBACK_URL,
          // orderMetaData: custom envelope mirrored back in the webhook
          // This is how we know which campaign to credit on payment_success
          orderMetaData: { requestId },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          accountId: process.env.NOMBA_ACCOUNT_ID,
        },
      },
    );

    // Log pending transaction in Naira for our own records
    await prisma.transaction.create({
      data: {
        requestId,
        amount: Number(amount),
        reference: orderReference,
        status: "PENDING",
        donorEmail: customerEmail ?? null,
      },
    });

    return res.status(200).json({
      checkoutLink: checkoutResponse.data.data.checkoutLink,
      orderReference,
    });
  } catch (error: any) {
    return res.status(502).json({
      error: "BadGateway",
      message:
        error.response?.data?.description ||
        "Downstream payment gateway connection timeout.",
    });
  }
};
