import path from "node:path";
import { createServer as createHttpServer } from "node:http";
import express, { type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { createServer as createViteServer, loadEnv } from "vite";

const isProduction = process.env.NODE_ENV === "production";
const env = loadEnv(isProduction ? "production" : "development", process.cwd(), "");
Object.assign(env, process.env);
Object.assign(process.env, env);

const app = express();
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 8;
const uploadsByIp = new Map<string, { count: number; resetAt: number }>();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });
const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

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

function isSupportedImage(bytes: Buffer, mimeType: string) {
  if (mimeType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/gif") return ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
  if (mimeType === "image/webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

app.post("/api/upload-image", (request, response, next) => {
  if (Number(request.headers["content-length"] ?? 0) > MAX_UPLOAD_BYTES + 64 * 1024) {
    response.status(413).json({ error: "Images must be smaller than 5 MB." });
    return;
  }
  const limit = takeRateLimit(request.ip || "unknown");
  if (!limit.allowed) {
    response.setHeader("Retry-After", String(limit.retryAfter));
    response.status(429).json({ error: "Upload limit reached. Try again later." });
    return;
  }
  upload.single("file")(request, response, (error) => error ? next(error) : next());
}, async (request: Request, response: Response) => {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return response.status(503).json({ error: "Image uploads are not configured." });
  const file = request.file;
  if (!file) return response.status(400).json({ error: "Choose an image file to upload." });
  if (!allowedImageTypes.has(file.mimetype)) return response.status(415).json({ error: "Use a PNG, JPEG, WebP, or GIF image." });
  if (!isSupportedImage(file.buffer, file.mimetype)) return response.status(415).json({ error: "The selected file is not a valid supported image." });

  const extension = file.mimetype === "image/jpeg" ? "jpg" : file.mimetype.split("/")[1];
  const pinataForm = new FormData();
  const imageBytes = new Uint8Array(file.buffer.byteLength);
  imageBytes.set(file.buffer);
  pinataForm.append("file", new Blob([imageBytes.buffer], { type: file.mimetype }), `token-image.${extension}`);
  pinataForm.append("network", "public");
  try {
    const upstream = await fetch("https://uploads.pinata.cloud/v3/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
      body: pinataForm,
      signal: AbortSignal.timeout(30_000),
    });
    const result = await upstream.json() as { data?: { cid?: string }; cid?: string };
    const cid = result.data?.cid ?? result.cid;
    if (!upstream.ok || !cid || !/^[a-zA-Z0-9]+$/.test(cid)) {
      return response.status(502).json({ error: "Pinata could not store this image. Try again." });
    }
    return response.json({ cid, imageUri: `ipfs://${cid}` });
  } catch {
    return response.status(502).json({ error: "Image upload failed. Check your connection and try again." });
  }
});

function getGatewayUrl(cid: string) {
  const configuredGateway = process.env.PINATA_GATEWAY?.trim();
  if (!configuredGateway) return `https://gateway.pinata.cloud/ipfs/${cid}`;
  const gatewayUrl = new URL(configuredGateway.includes("://") ? configuredGateway : `https://${configuredGateway}`);
  if (gatewayUrl.protocol !== "https:" || gatewayUrl.username || gatewayUrl.password) {
    throw new Error("PINATA_GATEWAY must be an HTTPS gateway host.");
  }
  gatewayUrl.pathname = `${gatewayUrl.pathname.replace(/\/$/, "")}/ipfs/${cid}`;
  gatewayUrl.search = "";
  gatewayUrl.hash = "";
  return gatewayUrl.toString();
}

app.get("/api/ipfs/:cid", async (request, response) => {
  const { cid } = request.params;
  if (!/^[a-zA-Z0-9]{20,120}$/.test(cid)) return response.status(400).json({ error: "Invalid IPFS content identifier." });
  let sourceUrl: string;
  try {
    sourceUrl = getGatewayUrl(cid);
  } catch {
    return response.status(500).json({ error: "IPFS gateway configuration is invalid." });
  }
  try {
    const upstream = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" },
    });
    if (!upstream.ok) return response.status(upstream.status === 404 ? 404 : 502).json({ error: "IPFS image is unavailable." });
    const contentType = upstream.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);
    if (!imageTypes.has(contentType)) return response.status(415).json({ error: "IPFS content is not a supported image." });
    const image = await upstream.arrayBuffer();
    if (image.byteLength > 10 * 1024 * 1024) return response.status(413).json({ error: "IPFS image exceeds the 10 MB limit." });
    response.set({
      "Content-Type": contentType,
      "Content-Length": String(image.byteLength),
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    });
    return response.send(Buffer.from(image));
  } catch {
    return response.status(502).json({ error: "Could not retrieve the IPFS image." });
  }
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return response.status(413).json({ error: "Images must be smaller than 5 MB." });
  }
  return response.status(400).json({ error: "Choose a valid image file." });
});

let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
const server = createHttpServer(app);
if (isProduction) {
  const dist = path.resolve(process.cwd(), "dist");
  app.use(express.static(dist));
  app.use((request, response, next) => {
    if (request.method === "GET" && !request.path.startsWith("/api/")) {
      response.sendFile(path.join(dist, "index.html"));
      return;
    }
    next();
  });
} else {
  vite = await createViteServer({ configFile: path.resolve("vite.config.ts"), server: { middlewareMode: true, hmr: { server } }, appType: "spa" });
  app.use(vite.middlewares);
}

const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () => console.log(`Night Market listening on http://localhost:${port}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close();
    void vite?.close();
  });
}
