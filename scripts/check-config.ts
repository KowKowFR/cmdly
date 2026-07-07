/**
 * scripts/check-config.ts — pre-flight configuration checker.
 *
 * Validates:
 *   1. Required environment variables are present.
 *   2. The database is reachable (SELECT 1).
 *   3. Whether onboarding has been completed.
 *
 * Usage:
 *   npx tsx scripts/check-config.ts
 *
 * Exits 0 if everything is OK, non-zero otherwise.
 * Loads .env from the project root automatically.
 */

import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

// Load .env from project root (no override so real env vars take precedence)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env"), override: false });

import { Pool } from "pg";

// ─── Colours ──────────────────────────────────────────────────────────────────
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED    = "\x1b[31m";
const RESET  = "\x1b[0m";

function ok(msg: string)   { console.log(`${GREEN}  ✓${RESET} ${msg}`); }
function warn(msg: string) { console.log(`${YELLOW}  ⚠${RESET} ${msg}`); }
function fail(msg: string) { console.error(`${RED}  ✗${RESET} ${msg}`); }

// ─── Required env vars ────────────────────────────────────────────────────────

const REQUIRED_VARS = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
] as const;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nCMDLY — Configuration Check");
  console.log("════════════════════════════\n");

  let hasErrors = false;

  // 1. Required env vars
  console.log("Environment variables:");
  for (const varName of REQUIRED_VARS) {
    const value = process.env[varName];
    if (!value) {
      fail(
        `${varName} is missing. / ${varName} est manquant.\n` +
        `       → Set it in your .env file or environment.`
      );
      hasErrors = true;
    } else {
      // Redact secrets for display
      const display =
        varName === "DATABASE_URL"
          ? value.replace(/:([^:@]+)@/, ":***@")
          : varName === "BETTER_AUTH_URL"
          ? value
          : "*** (set)";
      ok(`${varName} = ${display}`);
    }
  }

  if (hasErrors) {
    console.log();
    console.error(
      `${RED}Pre-flight failed.${RESET} Fix the above issues and retry.\n` +
      `Échec de la vérification. Corrigez les erreurs ci-dessus et réessayez.`
    );
    process.exit(1);
  }

  // 2. Database connectivity
  console.log("\nDatabase:");
  const pool = new Pool({ connectionString: process.env["DATABASE_URL"]! });

  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      ok("Database reachable — connexion à la base de données OK.");
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    fail(
      `Cannot connect to database: ${message}\n` +
      `       → Impossible de se connecter à la base de données.`
    );
    await pool.end();
    process.exit(1);
  }

  // 3. Onboarding status (query infrastructure_config directly)
  console.log("\nOnboarding:");
  try {
    const result = await pool.query<{ onboarding_completed: boolean }>(
      "SELECT onboarding_completed FROM infrastructure_config WHERE id = 1 LIMIT 1"
    );
    if (result.rows.length === 0) {
      warn(
        "No config row found — onboarding has NOT been started yet.\n" +
        "       → La configuration n'a pas encore été démarrée."
      );
    } else {
      const completed = result.rows[0]?.onboarding_completed ?? false;
      if (completed) {
        ok("Onboarding completed. / Configuration complète.");
      } else {
        warn(
          "Onboarding is NOT yet completed. Open the app to finish setup.\n" +
          "       → La configuration n'est pas encore terminée. Ouvrez l'application."
        );
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`Could not check onboarding status: ${message}`);
  }

  // 4. Admin user exists?
  console.log("\nAdmin account:");
  try {
    const result = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM users WHERE role = 'admin'"
    );
    const count = parseInt(result.rows[0]?.count ?? "0", 10);
    if (count === 0) {
      warn(
        "No admin user found. Run: npx tsx scripts/seed.ts\n" +
        "       → Aucun administrateur trouvé."
      );
    } else {
      ok(`${count} admin user(s) found. / ${count} administrateur(s) trouvé(s).`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`Could not check admin users: ${message}`);
  }

  await pool.end();

  console.log(`\n${GREEN}All required checks passed.${RESET} CMDLY is properly configured.\n`);
  console.log(`Toutes les vérifications requises sont réussies. CMDLY est correctement configuré.\n`);
}

main().catch((err: unknown) => {
  console.error("[check-config] Fatal error:", err);
  process.exit(1);
});
