import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { isOnboardingCompleted } from "@/lib/config";

// In Next.js 16, proxy.ts always runs on the Node.js runtime — no config export needed.

const PUBLIC_PATHS = ["/login", "/api/health"];

const PUBLIC_PREFIXES = ["/api/auth", "/_next", "/favicon"];

/** Paths that bypass both auth and onboarding checks. */
const ONBOARDING_EXEMPT_PREFIXES = [
  "/onboarding",
  "/login",
  "/api/",
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isOnboardingExempt(pathname: string): boolean {
  return ONBOARDING_EXEMPT_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix)
  );
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

  // ── ONBOARDING GATE ──────────────────────────────────────────────────────
  // Authenticated users who haven't completed onboarding → /onboarding.
  // Skip the check for paths that are always exempt (onboarding itself,
  // login, /api/*, static assets already filtered above).
  if (!isOnboardingExempt(pathname)) {
    const completed = await isOnboardingCompleted();
    if (!completed) {
      return NextResponse.redirect(new URL("/onboarding", request.url));
    }
  } else if (pathname.startsWith("/onboarding")) {
    // If onboarding is already done, bounce back to dashboard.
    const completed = await isOnboardingCompleted();
    if (completed) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  return NextResponse.next();
}
