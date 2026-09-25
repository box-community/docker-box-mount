import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { PROJECT_ROOT, SANDBOX_NAME, type DemoConfig } from "../src/config.js";
import { validateSandboxBoxAccess } from "../src/box-check.js";
import {
  BOX_KIT_REFERENCE,
  BOX_KIT_REPOSITORY,
  createDemoSandbox,
} from "../src/sandbox.js";

const config: DemoConfig = {
  boxAccessToken: "test-box-token", boxFolderId: "123", boxReviewerUserId: "",
  openaiApiKey: "test-openai-key", openaiModel: "configured-model", boxMountArchive: "",
};

test("sandbox creation uses the upstream default branch and existing local template", async () => {
  const calls: string[][] = [];
  const stages: string[] = [];
  const sandbox = await createDemoSandbox(config, undefined, {
    launch: async args => { calls.push(args); stages.push("create"); },
    store: async (service, value, options) => {
      assert.equal(options?.sandboxId, SANDBOX_NAME);
      assert.equal(value, service === "box" ? config.boxAccessToken : config.openaiApiKey);
      stages.push(`store:${service}`);
    },
    checkBox: async (created, folder) => {
      assert.equal(created.sandboxId, SANDBOX_NAME);
      assert.equal(folder, config.boxFolderId);
      stages.push("check:box");
    },
  });
  assert.deepEqual(stages, ["create", "store:box", "store:openai", "check:box"]);
  assert.equal(sandbox.sandboxId, SANDBOX_NAME);
  assert.equal(BOX_KIT_REPOSITORY, "https://github.com/ajeetraina/sbx-kits-box.git");
  assert.equal(BOX_KIT_REFERENCE, `git+${BOX_KIT_REPOSITORY}`);
  assert.deepEqual(calls, [[
    "run", "--detached", "--name", SANDBOX_NAME,
    "--template", "sbx-box:local", "shell", "--kit", BOX_KIT_REFERENCE,
  ]]);
});

test("upstream resolution failures propagate without falling back to a local kit", async () => {
  let launches = 0;
  const failure = new Error("kit source is not allowed");
  await assert.rejects(createDemoSandbox(config, undefined, {
    launch: async () => { launches++; throw failure; },
    store: async () => { assert.fail("must not register secrets after a failed launch"); },
    checkBox: async () => { assert.fail("must not check Box after a failed launch"); },
  }), error => error === failure);
  assert.equal(launches, 1);
});

for (const stage of ["box", "openai", "check"] as const) {
  test(`sandbox creation cleans up and stops on ${stage} failure`, async () => {
    const commands: string[][] = [];
    const stores: string[] = [];
    let checks = 0;
    const failure = new Error(`failed at ${stage}`);
    await assert.rejects(createDemoSandbox(config, undefined, {
      launch: async args => { commands.push(args); },
      store: async service => {
        stores.push(service);
        if (service === stage) throw failure;
      },
      checkBox: async () => { checks++; throw failure; },
    }), error => error === failure);
    assert.equal(commands.length, 2);
    assert.deepEqual(commands[1], ["rm", "--force", SANDBOX_NAME]);
    assert.deepEqual(stores, stage === "box" ? ["box"] : ["box", "openai"]);
    assert.equal(checks, stage === "check" ? 1 : 0);
  });
}

test("missing credentials never cause partial secret registration or a Box request", async () => {
  const commands: string[][] = [];
  await assert.rejects(createDemoSandbox({ ...config, openaiApiKey: "" }, undefined, {
    launch: async args => { commands.push(args); },
    store: async () => { assert.fail("must validate both tokens before storing either"); },
    checkBox: async () => { assert.fail("must not check with missing credentials"); },
  }), /OPENAI_API_KEY/);
  assert.deepEqual(commands.at(-1), ["rm", "--force", SANDBOX_NAME]);
});

test("every newly created sandbox refreshes credentials from the supplied configuration", async () => {
  const stored: string[] = [];
  const options = {
    launch: async () => {},
    store: async (_service: string, value: string) => { stored.push(value); },
    checkBox: async () => {},
  };
  await createDemoSandbox(config, undefined, options);
  await createDemoSandbox({ ...config, boxAccessToken: "new-box", openaiApiKey: "new-openai" }, undefined, options);
  assert.deepEqual(stored, [config.boxAccessToken, config.openaiApiKey, "new-box", "new-openai"]);
});

test("regression: Box verification succeeds only after the new sandbox receives its own secret", async () => {
  const scoped = new Map<string, string>();
  let checks = 0;
  let mounts = 0;
  const guest = {
    sandboxId: SANDBOX_NAME,
    commands: { run: async (command: string) => {
      if (command.includes("box-mount mount")) mounts++;
      checks++;
      const code = scoped.get("box") === config.boxAccessToken ? "200" : "401";
      return { stdout: `BOX_FOLDER_HTTP_STATUS:${code}`, stderr: "" };
    } },
    files: { write: async () => { assert.fail("credentials must not be written into guest files"); } },
    kill: async () => {},
  };
  await assert.rejects(validateSandboxBoxAccess(guest, config.boxFolderId), /HTTP 401/);
  const sandbox = await createDemoSandbox(config, undefined, {
    launch: async () => {}, connect: async () => guest,
    store: async (service, value, options) => {
      assert.equal(options?.sandboxId, SANDBOX_NAME);
      scoped.set(service, value);
    },
    // Use the real Box check, not a successful-check stub.
  });
  assert.equal(sandbox, guest);
  assert.equal(checks, 2);
  assert.equal(mounts, 0);
  assert.deepEqual([...scoped.keys()], ["box", "openai"]);
});

test("cleanup failure preserves the original verification error and warns about the remaining sandbox", async t => {
  const warning = t.mock.method(console, "warn", () => {});
  const failure = new Error("Box access check failed (HTTP 401)");
  await assert.rejects(createDemoSandbox(config, undefined, {
    launch: async args => { if (args[0] === "rm") throw new Error("cleanup failed"); },
    store: async () => {}, checkBox: async () => { throw failure; },
  }), error => error === failure);
  assert.equal(warning.mock.callCount(), 1);
  assert.match(warning.mock.calls[0]!.arguments[0] as string, /incomplete sandbox box-contract-review/);
});

test("the README uses the one-command installer without a manual checkout", async () => {
  const readme = await readFile(join(PROJECT_ROOT, "README.md"), "utf8");
  const manifest = JSON.parse(await readFile(join(PROJECT_ROOT, "package.json"), "utf8"));
  assert.equal(manifest.scripts["kit:install"], "tsx scripts/install-kit.ts");
  assert.ok(readme.includes("npm run kit:install -- /path/to/box-mount"));
  assert.ok(!readme.includes("../sbx-kits-box"));
  assert.ok(!readme.includes("./kit/scripts/"));
  assert.ok(!readme.includes("](kit/"));
});
