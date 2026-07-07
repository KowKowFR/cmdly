// ─── env must be set before any imports that touch the DB ────────────────────
process.env.DATABASE_URL ||= "postgresql://cmdly:cmdly@localhost:5432/cmdly";
process.env.BETTER_AUTH_SECRET ||= "dev-secret-please-change-0000000000000000";

import { test } from "node:test";
import assert from "node:assert/strict";

// Dynamic import so env vars are set first
const { parseAuditFilters, buildAuditWhere } = await import(
  "@/lib/audit-query"
);

// ─── parseAuditFilters ────────────────────────────────────────────────────────

test("parseAuditFilters: drops invalid result value", () => {
  const filters = parseAuditFilters({ result: "invalid_value" });
  assert.equal(filters.result, undefined, "invalid result should be dropped");
});

test("parseAuditFilters: drops unparseable date for 'from'", () => {
  const filters = parseAuditFilters({ from: "not-a-date" });
  assert.equal(filters.from, undefined, "unparseable from date should be dropped");
});

test("parseAuditFilters: drops unparseable date for 'to'", () => {
  const filters = parseAuditFilters({ to: "99/99/9999" });
  assert.equal(filters.to, undefined, "unparseable to date should be dropped");
});

test("parseAuditFilters: keeps valid result 'error'", () => {
  const filters = parseAuditFilters({ result: "error" });
  assert.equal(filters.result, "error");
});

test("parseAuditFilters: keeps valid result 'success'", () => {
  const filters = parseAuditFilters({ result: "success" });
  assert.equal(filters.result, "success");
});

test("parseAuditFilters: keeps valid result 'denied'", () => {
  const filters = parseAuditFilters({ result: "denied" });
  assert.equal(filters.result, "denied");
});

test("parseAuditFilters: keeps valid ISO from date", () => {
  const filters = parseAuditFilters({ from: "2024-01-15T00:00:00Z" });
  assert.equal(filters.from, "2024-01-15T00:00:00Z");
});

test("parseAuditFilters: keeps valid ISO to date", () => {
  const filters = parseAuditFilters({ to: "2024-12-31" });
  assert.equal(filters.to, "2024-12-31");
});

test("parseAuditFilters: keeps userId and toolName", () => {
  const filters = parseAuditFilters({ userId: "abc", toolName: "create_vm" });
  assert.equal(filters.userId, "abc");
  assert.equal(filters.toolName, "create_vm");
});

test("parseAuditFilters: drops result but keeps valid date when result is invalid", () => {
  const filters = parseAuditFilters({
    result: "INVALID",
    from: "2024-01-01",
  });
  assert.equal(filters.result, undefined);
  assert.equal(filters.from, "2024-01-01");
});

test("parseAuditFilters: returns empty object for empty input", () => {
  const filters = parseAuditFilters({});
  assert.deepEqual(filters, {});
});

// ─── buildAuditWhere ─────────────────────────────────────────────────────────

test("buildAuditWhere: returns undefined for empty filters", () => {
  const where = buildAuditWhere({});
  assert.equal(where, undefined, "empty filters should yield no where clause");
});

test("buildAuditWhere: returns defined SQL for result filter", () => {
  const where = buildAuditWhere({ result: "error" });
  assert.ok(where !== undefined, "result filter should produce a SQL clause");
});

test("buildAuditWhere: returns defined SQL for userId filter", () => {
  const where = buildAuditWhere({ userId: "user-abc" });
  assert.ok(where !== undefined);
});

test("buildAuditWhere: returns defined SQL for toolName filter", () => {
  const where = buildAuditWhere({ toolName: "create_vm" });
  assert.ok(where !== undefined);
});

test("buildAuditWhere: returns defined SQL for date range filter", () => {
  const where = buildAuditWhere({ from: "2024-01-01", to: "2024-12-31" });
  assert.ok(where !== undefined);
});

test("buildAuditWhere: returns defined SQL for combined filters", () => {
  const where = buildAuditWhere({
    result: "success",
    userId: "user-123",
    toolName: "list_vms",
    from: "2024-01-01",
    to: "2024-06-30",
  });
  assert.ok(where !== undefined, "combined filters should produce a SQL clause");
});
