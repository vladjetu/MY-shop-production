import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getExpectedSessionToken } from "@/lib/auth";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /brand obsahuje len verejné statické assety (logo, fonty) — potrebné aj
  // na neprihlásenej /login stránke, žiadne citlivé dáta.
  // /api/webhooks volá priamo Shopify (nemá našu session cookie) — chránené je
  // výhradne HMAC podpisom overeným v samotnom route handleri.
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/brand") ||
    pathname.startsWith("/api/webhooks")
  ) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const expectedToken = await getExpectedSessionToken();

  if (!sessionCookie || sessionCookie !== expectedToken) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
