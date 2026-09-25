import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { validateOpenAi } from "../src/openai-check.js";
import { runContractAgent } from "../src/contract-agent.js";
import type { DemoConfig } from "../src/config.js";
import type { Sandbox } from "../src/sandbox.js";

// Interpret the actual shell-quoted arguments without executing Node or an API call.
function nodeArgs(command: string): string[] {
  return execFileSync("bash", ["-c", 'node() { printf "%s\\0" "$@"; }; ' + command], {
    encoding: "utf8",
  }).split("\0").slice(0, -1);
}

function checkSandbox(availableModels: string[]): Sandbox {
  let script = "";
  return {
    sandboxId: "test",
    files: { write: async (_path, data) => { script = String(data); } },
    commands: {
      run: async (command) => {
        const args = nodeArgs(command);
        const execute = new Function("fetch", "process", `return (async () => { ${script} })();`);
        await execute(
          async () => ({ ok: true, json: async () => ({ data: availableModels.map(id => ({ id })) }) }),
          // Deliberately no OPENAI_MODEL in the sandbox environment.
          { argv: ["node", ...args], env: { OPENAI_API_KEY: "proxy-managed" } },
        );
        return { stdout: "", stderr: "" };
      },
    },
    kill: async () => {},
  };
}

test("doctor checks the supplied model without a sandbox OPENAI_MODEL variable", async () => {
  await validateOpenAi(checkSandbox(["configured-model"]), "configured-model");
});

test("doctor reports the configured model when it is unavailable", async () => {
  await assert.rejects(
    validateOpenAi(checkSandbox(["another-model"]), "configured-model"),
    /OpenAI model is not available to this key: configured-model/,
  );
});

test("review runner passes the configured model as a single quoted argument", async () => {
  const model = "configured-model'with-quote";
  let reviewArgs: string[] = [];
  const sandbox: Sandbox = {
    sandboxId: "test",
    files: { write: async () => {} },
    commands: {
      run: async (command) => {
        if (command.startsWith("node ")) {
          reviewArgs = nodeArgs(command);
        }
        return { stdout: "review.md", stderr: "" };
      },
    },
    kill: async () => {},
  };
  const config: DemoConfig = {
    boxAccessToken: "", boxFolderId: "123", boxReviewerUserId: "",
    openaiApiKey: "test-only", openaiModel: model, boxMountArchive: "",
  };
  await runContractAgent(sandbox, config);
  assert.equal(reviewArgs.length, 4);
  assert.equal(reviewArgs[3], model);
});
