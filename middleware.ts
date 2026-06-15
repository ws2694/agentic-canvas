import { NextResponse, type NextRequest } from "next/server";

// Optional password gate. When SITE_PASSWORD is set (e.g. on a public deploy),
// every route requires HTTP Basic Auth — any username, that password. This keeps
// the agent endpoint (and your API credits) behind a password on a public URL.
// Unset locally → no gate.
export function middleware(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next();

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const pass = decoded.slice(decoded.indexOf(":") + 1);
      if (pass === password) return NextResponse.next();
    } catch {
      // fall through to 401
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="agentic-canvas"' },
  });
}

export const config = {
  // Gate everything except Next's static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
