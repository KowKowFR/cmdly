import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { saveConfig } from "@/lib/config";
import { onboardingSchemas } from "@/lib/validation/onboarding";
import { auth } from "@/lib/auth/config";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { step: number; data: unknown };
    const { step, data } = body;

    if (typeof step !== "number" || step < 1 || step > 12) {
      return NextResponse.json({ ok: false, errors: ["Étape invalide"] }, { status: 400 });
    }

    // ── Auth guard ─────────────────────────────────────────────────────────────
    // Step 2 creates the first admin — allow if no admin exists yet.
    // All other steps require a valid session.
    let sessionOk = false;

    const session = await auth.api.getSession({ headers: request.headers });

    if (session) {
      sessionOk = true;
    } else if (step === 2) {
      // Bootstrap: allow if no admin exists yet
      const admins = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "admin"))
        .limit(1);
      sessionOk = admins.length === 0;
    }

    if (!sessionOk) {
      return NextResponse.json({ ok: false, errors: ["Non autorisé"] }, { status: 401 });
    }

    // ── Validate per-step schema ───────────────────────────────────────────────
    const schema = onboardingSchemas[step];
    if (!schema) {
      return NextResponse.json({ ok: false, errors: ["Schéma introuvable pour cette étape"] }, { status: 400 });
    }

    const result = schema.safeParse(data);
    if (!result.success) {
      const errors = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      return NextResponse.json({ ok: false, errors }, { status: 400 });
    }

    // ── Step-specific side-effects ─────────────────────────────────────────────

    if (step === 2) {
      // Step 2: set the admin role on the user that was just created via authClient.signUp
      const { email } = result.data as { email: string; password: string; name: string };
      const userRows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (userRows.length > 0) {
        await db
          .update(users)
          .set({ role: "admin" })
          .where(eq(users.id, userRows[0]!.id));
        logger.info("Admin role assigned", { email });
      } else {
        logger.warn("Step 2: user not found to promote to admin", { email });
      }
      // No infra config to save for step 2 (email/password/name are user data only)
      return NextResponse.json({ ok: true });
    }

    if (step === 12) {
      // Mark onboarding as complete
      await saveConfig({ onboardingCompleted: true });
      logger.info("Onboarding completed");
      return NextResponse.json({ ok: true });
    }

    // Steps 3-11: save config (secrets are encrypted inside saveConfig)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const configData = result.data as any;

    // Omit non-config fields that Zod may have added (none expected)
    await saveConfig(configData);
    logger.info("Onboarding step saved", { step });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("Onboarding POST error", { err: String(err) });
    return NextResponse.json({ ok: false, errors: ["Erreur interne"] }, { status: 500 });
  }
}
