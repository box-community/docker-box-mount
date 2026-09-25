import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { PROJECT_ROOT, SANDBOX_NAME, type DemoConfig } from "../src/config.js";
import {
  BOX_KIT_REFERENCE,
  BOX_KIT_REPOSITORY,
  BOX_KIT_REVISION,
  createDemoSandbox,
} from "../src/sandbox.js";

const config: DemoConfig = {
  boxAccessToken: "test-box-token", boxFolderId: "123", boxReviewerUserId: "",
  openaiApiKey: "test-openai-key", openaiModel: "configured-model", boxMountArchive: "",
};

test("sandbox creation uses the pinned upstream Git kit and existing local template", async () => {
  const calls: string[][] = [];
  const sandbox = await createDemoSandbox(config, undefined, async args => { calls.push(args); });
  assert.equal(sandbox.sandboxId, SANDBOX_NAME);
  assert.equal(BOX_KIT_REPOSITORY, "https://github.com/ajeetraina/sbx-kits-box.git");
  assert.match(BOX_KIT_REVISION, /^[0-9a-f]{40}$/);
  assert.equal(BOX_KIT_REFERENCE, `git+${BOX_KIT_REPOSITORY}#ref=${BOX_KIT_REVISION}`);
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

test("the documented template checkout stays aligned with the runtime kit revision", async () => {
  const readme = await readFile(join(PROJECT_ROOT, "README.md"), "utf8");
  assert.ok(readme.includes(`git clone ${BOX_KIT_REPOSITORY} ../sbx-kits-box`));
  assert.ok(readme.includes(`git -C ../sbx-kits-box checkout --detach ${BOX_KIT_REVISION}`));
  assert.ok(readme.includes("(cd ../sbx-kits-box && ./scripts/build-and-load.sh)"));
  assert.ok(!readme.includes("./kit/scripts/"));
  assert.ok(!readme.includes("](kit/"));
});
