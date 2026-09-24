import assert from "node:assert/strict";
import { test } from "node:test";
import { getDemoConfig } from "../src/config.js";
import { runContractAgent } from "../src/contract-agent.js";
import type { Sandbox } from "../src/sandbox.js";

test("configuration requires an OpenAI key and preserves the selected model", () => {
  const keys = ["BOX_ACCESS_TOKEN", "BOX_FOLDER_ID", "OPENAI_API_KEY", "OPENAI_MODEL"];
  const original = new Map(keys.map(key => [key, process.env[key]]));
  try {
    process.env.BOX_ACCESS_TOKEN = "test-box-token";
    process.env.BOX_FOLDER_ID = "123";
    for (const value of [undefined, "", " \t "]) {
      if (value === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = value;
      assert.throws(() => getDemoConfig(), /Missing OPENAI_API_KEY/);
    }

    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_MODEL = "configured-model";
    const config = getDemoConfig();
    assert.equal(config.openaiApiKey, "test-openai-key");
    assert.equal(config.openaiModel, "configured-model");
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("a sandboxed reviewer failure is propagated without producing a substitute memo", async () => {
  const failure = new Error("OpenAI request failed (401)");
  const writtenFiles: string[] = [];
  const sandbox: Sandbox = {
    sandboxId: "test",
    files: { write: async path => { writtenFiles.push(path); } },
    commands: {
      run: async command => {
        if (command.startsWith("node review.mjs")) throw failure;
        return { stdout: "", stderr: "" };
      },
    },
    kill: async () => {},
  };
  await assert.rejects(runContractAgent(sandbox, {
    boxAccessToken: "test-box-token", boxFolderId: "123", boxReviewerUserId: "",
    openaiApiKey: "test-openai-key", openaiModel: "configured-model", boxMountArchive: "",
  }), error => error === failure);
  assert.ok(!writtenFiles.some(path => path.endsWith("Acme-MSA-review.md")));
});
