import { test } from "node:test"; import assert from "node:assert/strict";
const { canExecuteTool } = await import("./permissions.ts");
test("operator can run modify but not destroy", () => {
  assert.equal(canExecuteTool("operator", "operator"), true);
  assert.equal(canExecuteTool("operator", "admin"), false);
});
test("admin runs everything; viewer only read", () => {
  assert.equal(canExecuteTool("admin", "admin"), true);
  assert.equal(canExecuteTool("viewer", "operator"), false);
  assert.equal(canExecuteTool("viewer", "viewer"), true);
});
