import { v2 as cloudinary } from "cloudinary";
import type { Request, Response } from "express";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  api_key: process.env.CLOUDINARY_API_KEY ?? "",
  api_secret: process.env.CLOUDINARY_API_SECRET ?? "",
});

export const getCloudinarySignature = (req: Request, res: Response): void => {
  const timestamp = Math.round(new Date().getTime() / 1000);

    const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!apiSecret) {
    res.status(500).json({
      error: "InternalServerError",
      message: "Cloudinary API secret is not configured.",
    });
    return;
  }

  const signature = cloudinary.utils.api_sign_request(
    { timestamp, folder: "invoices" },
    apiSecret,
  );

  res.status(200).json({
    signature,
    timestamp,
    apiKey: process.env.CLOUDINARY_API_KEY ?? "",
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  });
};
