import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { PROJECT_ROOT, SANDBOX_NAME, type DemoConfig } from "../src/config.js";
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
  const sandbox = await createDemoSandbox(config, undefined, async args => { calls.push(args); });
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
  await assert.rejects(createDemoSandbox(config, undefined, async () => {
    launches++;
    throw failure;
  }), error => error === failure);
  assert.equal(launches, 1);
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
