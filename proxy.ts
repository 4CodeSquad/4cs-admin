import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Fast, optimistic gate: no session cookie → straight to /login, without
 * rendering anything. It does NOT prove the session is valid — every page and
 * action still checks it against the database (lib/dal.ts).
 */
const PUBLIC = ["/login", "/two-factor", "/forgot-password", "/reset-password", "/api/auth", "/api/cron"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (!getSessionCookie(request)) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|icon).*)"],
};
