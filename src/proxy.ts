import { NextResponse, type NextRequest } from "next/server";

// An optimistic check only: someone with no session cookie is sent to the
// login page before any app page starts rendering. The real check happens in
// every page, Server Action and route handler, against the database.
export function proxy(request: NextRequest) {
  if (request.cookies.has("ag_session")) return NextResponse.next();
  const login = new URL("/login", request.url);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/overview/:path*", "/agents/:path*", "/activity/:path*", "/approvals/:path*", "/rules/:path*", "/limits/:path*", "/tools/:path*",
    "/responses/:path*", "/coverage/:path*", "/vault/:path*", "/connect/:path*", "/audit/:path*", "/playground/:path*", "/settings/:path*",
  ],
};
