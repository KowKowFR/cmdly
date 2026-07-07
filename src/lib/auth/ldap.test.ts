import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ldapBind,
  escapeLdapFilter,
  type LdapClientLike,
  type LdapEntry,
  type LdapSearchOptions,
} from "./ldap.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BASE_CFG = {
  ldapUrl: "ldap://localhost:389",
  ldapBindDn: "cn=admin,dc=example,dc=com",
  ldapBindPassword: "adminpassword",
  ldapBaseDn: "dc=example,dc=com",
};

const USER_DN = "uid=alice,ou=people,dc=example,dc=com";

/**
 * Build a fake LDAP client. By default all binds succeed and the user search
 * returns one entry for USER_DN. Overrides can be injected per-test.
 */
function makeFakeClient(opts?: {
  serviceBindError?: Error;
  userBindError?: Error;
  searchEntries?: LdapEntry[];
  captureSearchFilter?: (f: string) => void;
}): { client: LdapClientLike; binds: string[] } {
  const binds: string[] = [];

  const client: LdapClientLike = {
    async bind(dn: string, password?: string): Promise<void> {
      binds.push(dn);

      // First bind = service account
      if (binds.length === 1 && opts?.serviceBindError) {
        throw opts.serviceBindError;
      }
      // Second bind = user DN
      if (binds.length === 2 && opts?.userBindError) {
        throw opts.userBindError;
      }
    },

    async search(
      _baseDN: string,
      options: LdapSearchOptions,
    ): Promise<{ searchEntries: LdapEntry[] }> {
      opts?.captureSearchFilter?.(options.filter);

      const entries: LdapEntry[] =
        opts?.searchEntries !== undefined
          ? opts.searchEntries
          : [{ dn: USER_DN }];

      return { searchEntries: entries };
    },

    async unbind(): Promise<void> {
      // no-op
    },
  };

  return { client, binds };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ldapBind", () => {
  test("(a) correct service bind + user found + correct password → { ok: true, dn }", async () => {
    const { client } = makeFakeClient();

    const result = await ldapBind(BASE_CFG, "alice", "correctpassword", {
      createClient: () => client,
    });

    assert.equal(result.ok, true);
    assert.equal(result.dn, USER_DN);
    assert.equal(result.error, undefined);
  });

  test("(b) wrong user password (second bind throws) → { ok: false }", async () => {
    const { client } = makeFakeClient({
      userBindError: new Error("invalidCredentials"),
    });

    const result = await ldapBind(BASE_CFG, "alice", "wrongpassword", {
      createClient: () => client,
    });

    assert.equal(result.ok, false);
    assert.ok(result.error !== undefined);
  });

  test("(c) user not found in search → { ok: false }", async () => {
    const { client } = makeFakeClient({ searchEntries: [] });

    const result = await ldapBind(BASE_CFG, "unknown", "anypassword", {
      createClient: () => client,
    });

    assert.equal(result.ok, false);
    assert.ok(result.error !== undefined);
  });

  test("(d) LDAP-injection in username is escaped in the search filter", async () => {
    let capturedFilter = "";

    const { client } = makeFakeClient({
      captureSearchFilter: (f) => {
        capturedFilter = f;
      },
    });

    const maliciousUsername = "*)(uid=*)";
    await ldapBind(BASE_CFG, maliciousUsername, "pass", {
      createClient: () => client,
    });

    // The raw injection string must NOT appear in the filter
    assert.ok(
      !capturedFilter.includes("*)(uid=*)"),
      `Filter should not contain raw injection string: ${capturedFilter}`,
    );

    // The escaped form must be present
    // '*' → '\\2a', '(' → '\\28', ')' → '\\29'
    assert.ok(
      capturedFilter.includes("\\2a"),
      `Filter should contain \\2a (escaped *): ${capturedFilter}`,
    );
    assert.ok(
      capturedFilter.includes("\\28"),
      `Filter should contain \\28 (escaped (): ${capturedFilter}`,
    );
    assert.ok(
      capturedFilter.includes("\\29"),
      `Filter should contain \\29 (escaped )): ${capturedFilter}`,
    );
  });
});

describe("escapeLdapFilter", () => {
  test("escapes special characters per RFC 4515", () => {
    assert.equal(escapeLdapFilter("*"), "\\2a");
    assert.equal(escapeLdapFilter("("), "\\28");
    assert.equal(escapeLdapFilter(")"), "\\29");
    assert.equal(escapeLdapFilter("\\"), "\\5c");
    assert.equal(escapeLdapFilter("\x00"), "\\00");
  });

  test("leaves normal characters unchanged", () => {
    assert.equal(escapeLdapFilter("alice123"), "alice123");
    assert.equal(escapeLdapFilter("alice@example.com"), "alice@example.com");
  });

  test("escapes a full injection payload", () => {
    const escaped = escapeLdapFilter("*)(uid=*)");
    assert.equal(escaped, "\\2a\\29\\28uid=\\2a\\29");
  });
});
