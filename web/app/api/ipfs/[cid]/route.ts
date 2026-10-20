import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);

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

export async function GET(_request: NextRequest, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  if (!/^[a-zA-Z0-9]{20,120}$/.test(cid)) {
    return NextResponse.json({ error: "Invalid IPFS content identifier." }, { status: 400 });
  }

  let sourceUrl: string;
  try {
    sourceUrl = getGatewayUrl(cid);
  } catch {
    return NextResponse.json({ error: "IPFS gateway configuration is invalid." }, { status: 500 });
  }

  try {
    const upstream = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" },
    });
    if (!upstream.ok) return NextResponse.json({ error: "IPFS image is unavailable." }, { status: upstream.status === 404 ? 404 : 502 });

    const contentType = upstream.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (!IMAGE_TYPES.has(contentType)) return NextResponse.json({ error: "IPFS content is not a supported image." }, { status: 415 });

    const contentLength = Number(upstream.headers.get("content-length") ?? 0);
    if (contentLength > MAX_IMAGE_BYTES) return NextResponse.json({ error: "IPFS image exceeds the 10 MB limit." }, { status: 413 });

    const image = await upstream.arrayBuffer();
    if (image.byteLength > MAX_IMAGE_BYTES) return NextResponse.json({ error: "IPFS image exceeds the 10 MB limit." }, { status: 413 });

    return new NextResponse(image, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(image.byteLength),
        "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not retrieve the IPFS image." }, { status: 502 });
  }
}