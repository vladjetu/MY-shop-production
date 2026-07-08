import { NextRequest, NextResponse } from "next/server";

const ALLOWED_HOST_SUFFIX = ".zakeke.com";

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("u");

  if (!rawUrl) {
    return new NextResponse("Chýba parameter u.", { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return new NextResponse("Neplatná URL.", { status: 400 });
  }

  // Allowlist domény, aby tento endpoint nešiel použiť ako open proxy na ľubovoľnú URL (SSRF).
  const isAllowedHost =
    target.protocol === "https:" &&
    (target.hostname === "zakeke.com" || target.hostname.endsWith(ALLOWED_HOST_SUFFIX));

  if (!isAllowedHost) {
    return new NextResponse("Nepovolená doména obrázka.", { status: 400 });
  }

  const upstream = await fetch(target.toString(), { cache: "no-store" });

  if (!upstream.ok || !upstream.body) {
    return new NextResponse("Nepodarilo sa načítať náhľad zo Zakeke.", { status: 502 });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/png",
      "Cache-Control": "private, max-age=300",
    },
  });
}
