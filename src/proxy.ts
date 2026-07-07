import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";

const PUBLIC_PATHS = [
  "/login",
  "/api/health",
];

const PUBLIC_PREFIXES = [
  "/api/auth",
  "/_next",
  "/favicon",
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ── ONBOARDING GATE (Task 6 hook) ────────────────────────────────────────
  // TODO(task-6): Once the infrastructure config loader exists, check
  // `onboardingCompleted` here and redirect unauthenticated/unconfigured users
  // to/from /onboarding. The config loader is not yet available; do NOT
  // implement onboarding redirect logic here yet.
  // Example (do not uncomment until Task 6):
  // const config = await getInfraConfig();
  // if (!config?.onboardingCompleted && pathname !== "/onboarding") {
  //   return NextResponse.redirect(new URL("/onboarding", request.url));
  // }
  // ─────────────────────────────────────────────────────────────────────────

  return NextResponse.next();
}

