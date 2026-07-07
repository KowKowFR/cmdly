import { logger } from "@/lib/logger";
import type { InfrastructureConfig } from "@/lib/config";

// ─── RFC 4515 filter-value escaping ──────────────────────────────────────────

/**
 * Escape a string for safe embedding in an LDAP filter value per RFC 4515.
 * Characters escaped: NUL, '(', ')', '*', '\'.
 */
export function escapeLdapFilter(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    const code = value.charCodeAt(i);
    if (code === 0x00) {
      out += "\\00";
    } else if (c === "\\") {
      out += "\\5c";
    } else if (c === "(") {
      out += "\\28";
    } else if (c === ")") {
      out += "\\29";
    } else if (c === "*") {
      out += "\\2a";
    } else {
      out += c;
    }
  }
  return out;
}

// ─── Narrow LdapClientLike interface (allows fake injection in tests) ─────────

export interface LdapSearchOptions {
  filter: string;
  scope: string;
  attributes: string[];
}

export interface LdapEntry {
  dn: string;
  [attr: string]: string | string[] | undefined;
}

export interface LdapClientLike {
  bind(dn: string, password?: string): Promise<void>;
  search(
    baseDN: string,
    options: LdapSearchOptions,
  ): Promise<{ searchEntries: LdapEntry[] }>;
  unbind(): Promise<void>;
}

// ─── Public result type ───────────────────────────────────────────────────────

export interface LdapResult {
  ok: boolean;
  dn?: string;
  error?: string;
}

// ─── Default client factory (uses ldapts) ────────────────────────────────────

function defaultCreateClient(url: string): LdapClientLike {
  // Dynamic import so unit tests that inject a fake never load ldapts
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client } = require("ldapts") as typeof import("ldapts");
  return new Client({ url }) as unknown as LdapClientLike;
}

// ─── Core LDAP bind flow ──────────────────────────────────────────────────────

/**
 * Authenticate a user against an LDAP directory.
 *
 * Flow:
 *  1. Connect using the provided config URL.
 *  2. Bind as the service account (ldapBindDn / ldapBindPassword).
 *  3. Search for the user entry by uid or mail (escaped for injection safety).
 *  4. Attempt a second bind as the found user DN with the supplied password.
 *
 * Never throws — all failures are returned as { ok: false, error }.
 */
export async function ldapBind(
  cfg: Pick<
    InfrastructureConfig,
    "ldapUrl" | "ldapBindDn" | "ldapBindPassword" | "ldapBaseDn"
  >,
  username: string,
  password: string,
  deps?: { createClient?: (url: string) => LdapClientLike },
): Promise<LdapResult> {
  const createClient = deps?.createClient ?? defaultCreateClient;
  const client = createClient(cfg.ldapUrl);

  try {
    // Step 1 — service account bind
    await client.bind(cfg.ldapBindDn, cfg.ldapBindPassword);

    // Step 2 — search for the user (escape to prevent filter injection)
    const safeUsername = escapeLdapFilter(username);
    const filter = `(|(uid=${safeUsername})(mail=${safeUsername}))`;

    const { searchEntries } = await client.search(cfg.ldapBaseDn, {
      filter,
      scope: "sub",
      attributes: ["dn", "uid", "mail"],
    });

    if (searchEntries.length === 0) {
      logger.warn("LDAP user not found", { username });
      return { ok: false, error: "User not found in directory" };
    }

    const userDn = searchEntries[0]!.dn;

    // Step 3 — user bind (validates the supplied password)
    try {
      await client.bind(userDn, password);
    } catch (err) {
      logger.warn("LDAP user bind failed", { dn: userDn });
      return { ok: false, error: "Invalid credentials" };
    }

    logger.info("LDAP authentication successful", { dn: userDn });
    return { ok: true, dn: userDn };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("LDAP bind error", { error: msg });
    return { ok: false, error: msg };
  } finally {
    try {
      await client.unbind();
    } catch {
      // ignore unbind errors
    }
  }
}
