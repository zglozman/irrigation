// Next.js middleware for authentication
// Redirects unauthenticated requests to /login for pages, returns 401 JSON for API routes

import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Public paths that don't require authentication
  const publicPaths = [
    "/login",
    "/api/auth/login",
    "/api/auth/challenge",
    "/api/auth/google",
    "/api/auth/callback",
  ];

  // Check if path is exactly or starts with a public path
  const isPublicPath = publicPaths.some(
    (path) => pathname === path || pathname.startsWith(path + "/")
  );
  if (isPublicPath) {
    return NextResponse.next();
  }

  // Static assets don't need auth
  if (pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  // Check for ID token cookie
  const idToken = request.cookies.get("idToken");
  if (!idToken) {
    // API routes return 401 JSON, pages redirect to login
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }
    // Redirect to login for page requests
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
