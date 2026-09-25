import assert from "node:assert/strict";
import { test } from "node:test";
import { validateSandboxBoxAccess } from "../src/box-check.js";
import type { Sandbox } from "../src/sandbox.js";

function sandbox(run: Sandbox["commands"]["run"]): Sandbox {
  return {
    sandboxId: "box-test", commands: { run },
    files: { write: async () => { assert.fail("check must not write guest files"); } },
    kill: async () => { assert.fail("check must not destroy the sandbox"); },
  };
}

test("Box check lists the configured folder with only a placeholder credential and discards its body", async () => {
  let calls = 0;
  await validateSandboxBoxAccess(sandbox(async (command, options) => {
    calls++;
    assert.ok(command.includes("https://api.box.com/2.0/folders/420916600067/items?limit=1&fields=id"));
    assert.ok(command.includes("--header 'Authorization: Bearer proxy-managed'"));
    assert.ok(command.includes("--output /dev/null"));
    assert.ok(command.includes("--connect-timeout 10 --max-time 25"));
    assert.ok(!command.includes("--location"));
    assert.equal(options?.timeoutMs, 30_000);
    return { stdout: "Sandbox box-test started successfully\r\nBOX_FOLDER_HTTP_STATUS:200\r\n", stderr: "" };
  }), "420916600067");
  assert.equal(calls, 1);
});

for (const [status, message] of [
  ["401", /HTTP 401.*sandbox-scoped credential registration/],
  ["403", /HTTP 403.*permissions/],
  ["404", /HTTP 404.*permissions/],
  ["429", /HTTP 429/],
  ["500", /HTTP 500/],
  ["302", /HTTP 302/],
  ["000", /HTTP 000/],
] as const) {
  test(`Box check rejects HTTP ${status} without printing response content`, async () => {
    await assert.rejects(validateSandboxBoxAccess(sandbox(async () => ({
      stdout: `sensitive-response\nBOX_FOLDER_HTTP_STATUS:${status}\n`, stderr: "sensitive-stderr",
    })), "123"), (error: Error) => {
      assert.match(error.message, message);
      assert.ok(!error.message.includes("sensitive"));
      return true;
    });
  });
}

test("Box check does not treat unrelated numbers or missing status as success", async () => {
  for (const stdout of ["", "200", "BOX_FOLDER_HTTP_STATUS:200unexpected", "Started sandbox-200"]) {
    await assert.rejects(validateSandboxBoxAccess(sandbox(async () => ({ stdout, stderr: "" })), "123"), /no valid HTTP status/);
  }
});

test("Box check reports transport failure without exposing raw subprocess output", async () => {
  await assert.rejects(validateSandboxBoxAccess(sandbox(async () => {
    throw Object.assign(new Error("sensitive-token"), { stdout: "sensitive-token", stderr: "sensitive-token" });
  }), "123"), (error: Error) => {
    assert.match(error.message, /could not complete.*proxy connectivity/);
    assert.ok(!error.message.includes("sensitive-token"));
    return true;
  });
});

test("Box check rejects malformed folder IDs before constructing a shell command", async () => {
  for (const folder of ["", "abc", "123'", "123\n", "../users/me", "123;echo bad"]) {
    await assert.rejects(validateSandboxBoxAccess(sandbox(async () => {
      assert.fail("must not run a command for an invalid folder ID");
    }), folder), /numeric Box folder ID/);
  }
});
