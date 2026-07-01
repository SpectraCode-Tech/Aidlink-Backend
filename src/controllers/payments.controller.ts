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


export const getNombaAccessToken = async (): Promise<string> => {
  const authResponse = await axios.post(
    `${process.env.NOMBA_BASE_URL}/v1/auth/token/issue`,
    {
      grant_type: "client_credentials",
      client_id: process.env.NOMBA_CLIENT_ID,
      client_secret: process.env.NOMBA_CLIENT_SECRET,
    },
    { headers: { accountId: process.env.NOMBA_ACCOUNT_ID } },
  );
  return authResponse.data.data.access_token;
};

const toKobo = (nairaAmount: number): number => {
  return Math.round(nairaAmount * 100);
};


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

            const amountInKobo = toKobo(Number(amount));

                const checkoutResponse = await axios.post(
      `${process.env.NOMBA_BASE_URL}/v1/checkout/order`,
      {
        order: {
          orderReference,
          amount: amountInKobo,
          currency: "NGN",
          customerEmail: customerEmail || "anonymous@aidlink.infrastructure",
          metadata: { requestId },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          accountId: process.env.NOMBA_ACCOUNT_ID,
        },
      },
    );

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
