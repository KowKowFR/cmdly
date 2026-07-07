/**
 * TDD tests for onboarding Zod schemas.
 * Run: npx tsx --test src/lib/validation/onboarding.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Schemas live in the same directory
import { onboardingSchemas } from "./onboarding.js";

// ─── Step 2 — Admin account ───────────────────────────────────────────────────

describe("Step 2 – admin account", () => {
  const schema = onboardingSchemas[2];

  it("rejects a weak password (too short)", () => {
    const result = schema.safeParse({ email: "admin@cmdly.dev", password: "short", name: "Admin" });
    assert.equal(result.success, false);
  });

  it("rejects a password without uppercase", () => {
    const result = schema.safeParse({ email: "admin@cmdly.dev", password: "weakpassword1!", name: "Admin" });
    assert.equal(result.success, false);
  });

  it("rejects a bad email", () => {
    const result = schema.safeParse({ email: "notanemail", password: "StrongPass123!", name: "Admin" });
    assert.equal(result.success, false);
  });

  it("rejects missing name", () => {
    const result = schema.safeParse({ email: "admin@cmdly.dev", password: "StrongPass123!", name: "" });
    assert.equal(result.success, false);
  });

  it("accepts valid email + strong password + name", () => {
    const result = schema.safeParse({ email: "admin@cmdly.dev", password: "StrongPass123!", name: "Admin" });
    assert.equal(result.success, true);
  });
});

// ─── Step 3 — Proxmox ─────────────────────────────────────────────────────────

describe("Step 3 – Proxmox", () => {
  const schema = onboardingSchemas[3];

  it("rejects missing host", () => {
    const result = schema.safeParse({
      proxmoxHost: "",
      proxmoxUser: "root@pam",
      proxmoxTokenId: "mytoken",
      proxmoxTokenSecret: "secret123",
      proxmoxNode: "pve",
    });
    assert.equal(result.success, false);
  });

  it("rejects missing token secret", () => {
    const result = schema.safeParse({
      proxmoxHost: "192.168.1.1",
      proxmoxUser: "root@pam",
      proxmoxTokenId: "mytoken",
      proxmoxTokenSecret: "",
      proxmoxNode: "pve",
    });
    assert.equal(result.success, false);
  });

  it("accepts a full valid object with default port", () => {
    const result = schema.safeParse({
      proxmoxHost: "192.168.1.1",
      proxmoxUser: "root@pam",
      proxmoxTokenId: "mytoken",
      proxmoxTokenSecret: "secret123",
      proxmoxNode: "pve",
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.proxmoxPort, 8006);
    }
  });

  it("accepts a full valid object with explicit port", () => {
    const result = schema.safeParse({
      proxmoxHost: "192.168.1.1",
      proxmoxPort: "9000",
      proxmoxUser: "root@pam",
      proxmoxTokenId: "mytoken",
      proxmoxTokenSecret: "secret123",
      proxmoxNode: "pve",
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.proxmoxPort, 9000);
    }
  });
});

// ─── Step 4 — Infra repo (discriminated union) ────────────────────────────────

describe("Step 4 – infra repo", () => {
  const schema = onboardingSchemas[4];

  it("rejects git type without URL", () => {
    const result = schema.safeParse({ infraRepoType: "git" });
    assert.equal(result.success, false);
  });

  it("rejects git type with invalid URL", () => {
    const result = schema.safeParse({ infraRepoType: "git", infraRepoGitUrl: "not-a-url", infraRepoGitBranch: "main" });
    assert.equal(result.success, false);
  });

  it("accepts local type with a path", () => {
    const result = schema.safeParse({ infraRepoType: "local", infraRepoPath: "/opt/infra" });
    assert.equal(result.success, true);
  });

  it("accepts git type with a valid URL", () => {
    const result = schema.safeParse({ infraRepoType: "git", infraRepoGitUrl: "https://github.com/org/infra.git", infraRepoGitBranch: "main" });
    assert.equal(result.success, true);
  });

  it("git type gets default branch 'main'", () => {
    const result = schema.safeParse({ infraRepoType: "git", infraRepoGitUrl: "https://github.com/org/infra.git" });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.infraRepoGitBranch, "main");
    }
  });
});

// ─── Step 7 — LLM ─────────────────────────────────────────────────────────────

describe("Step 7 – LLM provider", () => {
  const schema = onboardingSchemas[7];

  it("rejects openai without API key", () => {
    const result = schema.safeParse({ defaultLlmProvider: "openai", openaiApiKey: "" });
    assert.equal(result.success, false);
  });

  it("accepts openai with API key", () => {
    const result = schema.safeParse({ defaultLlmProvider: "openai", openaiApiKey: "sk-test123" });
    assert.equal(result.success, true);
  });

  it("accepts anthropic with API key", () => {
    const result = schema.safeParse({ defaultLlmProvider: "anthropic", anthropicApiKey: "sk-ant-test" });
    assert.equal(result.success, true);
  });

  it("accepts ollama with base URL and model", () => {
    const result = schema.safeParse({ defaultLlmProvider: "ollama", ollamaBaseUrl: "http://localhost:11434", ollamaModel: "llama3" });
    assert.equal(result.success, true);
  });
});

// ─── Passthrough steps ────────────────────────────────────────────────────────

describe("Passthrough steps (1, 11, 12)", () => {
  it("step 1 accepts any data", () => {
    const result = onboardingSchemas[1].safeParse({});
    assert.equal(result.success, true);
  });

  it("step 11 accepts any data", () => {
    const result = onboardingSchemas[11].safeParse({ anything: "goes" });
    assert.equal(result.success, true);
  });

  it("step 12 accepts any data", () => {
    const result = onboardingSchemas[12].safeParse({ anything: "goes" });
    assert.equal(result.success, true);
  });
});
