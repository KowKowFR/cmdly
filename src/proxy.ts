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

  // ── FIRST-RUN ONBOARDING BOOTSTRAP ─────────────────────────────────────────
  // The onboarding wizard (and its API) MUST be reachable without a session:
  // this is where the very first admin account is created. Requiring a session
  // here would make first-run impossible (chicken-and-egg). The API route
  // enforces its own bootstrap rules (step 2 allowed only when no admin exists;
  // every step 403s once onboarding is complete), so leaving it open is safe.
  // Once onboarding IS complete, lock the wizard page (bounce to "/") but let
  // the API through so it can answer with its own 403.
  if (pathname.startsWith("/onboarding") || pathname.startsWith("/api/onboarding")) {
    const completed = await isOnboardingCompleted();
    if (!completed) return NextResponse.next();
    if (pathname.startsWith("/api/")) return NextResponse.next();
    return NextResponse.redirect(new URL("/", request.url));
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
  // Skip the check for paths that are always exempt (login, /api/*, static
  // assets already filtered above; onboarding itself handled earlier).
  if (!isOnboardingExempt(pathname)) {
    const completed = await isOnboardingCompleted();
    if (!completed) {
      return NextResponse.redirect(new URL("/onboarding", request.url));
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  return NextResponse.next();
}
