import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 8;
const uploadsByIp = new Map<string, { count: number; resetAt: number }>();

function isSupportedImage(bytes: Buffer, mimeType: string) {
  if (mimeType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/gif") return ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
  if (mimeType === "image/webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

function takeRateLimit(ip: string) {
  const now = Date.now();
  if (uploadsByIp.size > 1000) {
    for (const [key, entry] of uploadsByIp) if (entry.resetAt <= now) uploadsByIp.delete(key);
  }

  const entry = uploadsByIp.get(ip);
  if (!entry || entry.resetAt <= now) {
    uploadsByIp.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }
  if (entry.count >= RATE_LIMIT) return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  entry.count += 1;
  return { allowed: true, retryAfter: 0 };
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_IMAGE_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "Images must be smaller than 5 MB." }, { status: 413 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = takeRateLimit(ip);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Upload limit reached. Try again later." }, {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfter) },
    });
  }

  const jwt = process.env.PINATA_JWT;
  if (!jwt) return NextResponse.json({ error: "Image uploads are not configured." }, { status: 503 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Choose a valid image file." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an image file to upload." }, { status: 400 });
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Images must be smaller than 5 MB." }, { status: 413 });
  }
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
    return NextResponse.json({ error: "Use a PNG, JPEG, WebP, or GIF image." }, { status: 415 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!isSupportedImage(bytes, file.type)) return NextResponse.json({ error: "The selected file is not a valid supported image." }, { status: 415 });

  const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
  const safeFile = new File([bytes], `token-image.${extension}`, { type: file.type });
  const pinataForm = new FormData();
  pinataForm.append("file", safeFile);
  pinataForm.append("network", "public");

  try {
    const response = await fetch("https://uploads.pinata.cloud/v3/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
      body: pinataForm,
      signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json() as { data?: { cid?: string }; cid?: string };
    const cid = result.data?.cid ?? result.cid;
    if (!response.ok || !cid || !/^[a-zA-Z0-9]+$/.test(cid)) {
      return NextResponse.json({ error: "Pinata could not store this image. Try again." }, { status: 502 });
    }
    return NextResponse.json({ cid, imageUri: `ipfs://${cid}` });
  } catch {
    return NextResponse.json({ error: "Image upload failed. Check your connection and try again." }, { status: 502 });
  }
}