import { test } from "node:test";
import assert from "node:assert/strict";
import { runCommand, testBastionConnection } from "./ssh.ts";

// Local-mode config: commands run on this host via execFile, host is ignored.
const localCfg = {
  sshMode: "local",
  bastionHost: "",
  bastionPort: 22,
  bastionUser: "",
  sshKeyPath: "",
} as const;

test("runCommand (local): echo returns stdout with code 0", async () => {
  const r = await runCommand(localCfg, "ignored-host", "echo", ["hello"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), "hello");
});

test("runCommand (local): non-zero exit is captured, not thrown", async () => {
  const r = await runCommand(localCfg, "ignored-host", "false", []);
  assert.notEqual(r.code, 0);
});

test("runCommand (local): args are passed literally (no shell interpolation)", async () => {
  // If a shell were involved, "$(id)" would be substituted; execFile passes it verbatim.
  const r = await runCommand(localCfg, "ignored-host", "printf", ["%s", "$(id)"]);
  assert.equal(r.stdout, "$(id)");
});

test("testBastionConnection (local): reports operational", async () => {
  const r = await testBastionConnection(localCfg);
  assert.equal(r.ok, true);
});
