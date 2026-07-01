import { Request, Response, NextFunction } from "express";
import { ZodType, ZodError, z } from "zod";


export const CreateAidRequestSchema = z.object({
  body: z.object({
    title: z
      .string()
      .min(5, "Title must be at least 5 characters long.")
      .max(100, "Title cannot exceed 100 characters."),
    category: z.string().min(2, "Category is required."),
    targetAmount: z.number().positive("Target amount must be greater than 0."),
    institutionName: z.string().min(2, "Institution name is required."),
    invoiceUrl: z.string().url("Must provide a valid Cloudinary invoice URL."),
    deliveryAddress: z.string().min(5, "Full delivery address is required."),
  }),
});


export const validate = (schema: ZodType<any, any, any>) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      req.body = parsed.body ?? req.body;
      req.query = parsed.query ?? req.query;
      req.params = parsed.params ?? req.params;

      next();
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        res.status(400).json({
          status: "fail",
          errors: error.issues.map((issue) => {
                        const fieldPath =
              issue.path[0] === "body" ||
              issue.path[0] === "query" ||
              issue.path[0] === "params"
                ? issue.path.slice(1).join(".")
                : issue.path.join(".");

            return {
              field: fieldPath || "payload",
              message: issue.message,
            };
          }),
        });
        return;
      }

      res.status(500).json({
        status: "error",
        message: "Internal server error during payload validation.",
      });
    }
  };
};
