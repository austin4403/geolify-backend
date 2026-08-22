import { Router, Request, Response } from "express";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import * as dotenv from "dotenv";
import { sanitizeFileName } from "../utils/sanitize";
import { strictLimiter } from "../middleware/security";
import { requireAuth } from "../middleware/auth";

dotenv.config({ path: ".env.local" });

const router = Router();

const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/tiff",
  "application/pdf",
  "text/csv",
  "application/geo+json",
  "application/json",
];

const presignRequestSchema = z.object({
  filename: z.string().min(1, "Filename is required").max(255, "Filename too long"),
  contentType: z.string().refine((type) => ALLOWED_CONTENT_TYPES.includes(type), {
    message: `Invalid content type. Allowed types: ${ALLOWED_CONTENT_TYPES.join(", ")}`,
  }),
  folder: z.enum(["rocks", "stations", "boreholes", "avatars", "reports"]).default("rocks"),
});

// Configure S3 Client for Cloudflare R2
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "geoquerry-media";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || `https://pub-r2.geoquerry.com`;

let s3Client: S3Client | null = null;

if (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
  s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

// POST /api/uploads/presigned-url - Generate 1-time presigned direct upload URL
router.post("/presigned-url", strictLimiter, requireAuth, async (req: Request, res: Response) => {
  try {
    const { filename, contentType, folder } = presignRequestSchema.parse(req.body);

    const safeFilename = sanitizeFileName(filename);
    const uniqueKey = `${folder}/${Date.now()}-${safeFilename}`;
    const publicUrl = `${R2_PUBLIC_URL}/${uniqueKey}`;

    // If R2 credentials are configured, generate real presigned URL
    if (s3Client) {
      const command = new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: uniqueKey,
        ContentType: contentType,
      });

      const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

      res.json({
        uploadUrl,
        publicUrl,
        key: uniqueKey,
        expiresInSeconds: 3600,
        provider: "cloudflare_r2",
      });
      return;
    }

    // Fallback/Mock Mode (when credentials are not yet added to .env.local)
    res.json({
      uploadUrl: `https://${R2_BUCKET_NAME}.mock.r2.cloudflarestorage.com/${uniqueKey}?mock_token=1`,
      publicUrl,
      key: uniqueKey,
      expiresInSeconds: 3600,
      provider: "mock_r2 (Add R2_ACCOUNT_ID & keys in .env.local to activate live R2)",
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

export default router;
