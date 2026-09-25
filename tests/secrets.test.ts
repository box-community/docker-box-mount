import assert from "node:assert/strict";
import { spawn, type SpawnOptions } from "node:child_process";
import { test } from "node:test";
import { PROJECT_ROOT } from "../src/config.js";
import { registerSandboxSecrets, storeSandboxSecret } from "../src/secrets.js";

const config = { boxAccessToken: "box-test-token", openaiApiKey: "openai-test-key" };

test("setup registers both trimmed configuration values in order", async () => {
  const calls: [string, string][] = [];
  await registerSandboxSecrets({ boxAccessToken: " box-test-token ", openaiApiKey: "openai-test-key\n" }, async (service, value) => {
    calls.push([service, value]);
  });
  assert.deepEqual(calls, [["box", config.boxAccessToken], ["openai", config.openaiApiKey]]);
});

test("setup validates both tokens before modifying any stored secret", async () => {
  for (const key of ["boxAccessToken", "openaiApiKey"] as const) {
    for (const value of ["", "  ", "first\nsecond", "first\rsecond", "first\0second"]) {
      let called = false;
      await assert.rejects(registerSandboxSecrets({ ...config, [key]: value }, async () => { called = true; }), /nonempty, single-line token/);
      assert.equal(called, false);
    }
  }
});

test("registration stops on failure and can be rerun after a partial setup", async () => {
  const calls: string[] = [];
  await assert.rejects(registerSandboxSecrets(config, async service => {
    calls.push(service);
    throw new Error("registration failed");
  }), /registration failed/);
  assert.deepEqual(calls, ["box"]);

  const stored = new Map<string, string>();
  await assert.rejects(registerSandboxSecrets(config, async (service, value) => {
    if (service === "openai") throw new Error("registration failed");
    stored.set(service, value);
  }), /registration failed/);
  assert.equal(stored.size, 1);
  await registerSandboxSecrets(config, async (service, value) => { stored.set(service, value); });
  assert.deepEqual([...stored], [["box", config.boxAccessToken], ["openai", config.openaiApiKey]]);
});

// Substitute a real Node child for sbx: exercise pipe I/O and process handling
// without ever changing the developer's Docker credential store.
function fakeSbx(script: string, inspect?: (command: string, args: readonly string[], options: SpawnOptions) => void): typeof spawn {
  return ((command: string, args: readonly string[], options: SpawnOptions) => {
    inspect?.(command, args, options);
    return spawn(process.execPath, ["-e", script], options);
  }) as typeof spawn;
}

test("secrets travel only through stdin; arguments, environment and logs do not carry them", async () => {
  for (const [service, value] of [["box", config.boxAccessToken], ["openai", config.openaiApiKey]] as const) {
    await storeSandboxSecret(service, value, {
      spawnProcess: fakeSbx(`
        let input = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => { input += chunk; });
        process.stdin.on('end', () => {
          process.stdout.write(input);
          process.stderr.write(input);
          process.exitCode = input === ${JSON.stringify(value + "\n")} ? 0 : 1;
        });
      `, (command, args, options) => {
        assert.equal(command, "sbx");
        assert.deepEqual(args, ["secret", "set", service]);
        assert.equal(options.shell, false);
        assert.equal(options.cwd, PROJECT_ROOT);
        assert.deepEqual(options.stdio, ["pipe", "ignore", "ignore"]);
        assert.ok(!Object.hasOwn(options.env!, "BOX_ACCESS_TOKEN"));
        assert.ok(!Object.hasOwn(options.env!, "OPENAI_API_KEY"));
      }),
    });
  }
});

test("CLI failure output is suppressed and errors do not expose the secret", async () => {
  await assert.rejects(storeSandboxSecret("box", config.boxAccessToken, {
    spawnProcess: fakeSbx(`
      process.stdin.resume();
      process.stdin.on('end', () => {
        process.stderr.write(${JSON.stringify(config.boxAccessToken)});
        process.stdout.write(${JSON.stringify(config.boxAccessToken)});
        process.exitCode = 7;
      });
    `),
  }), (error: Error) => {
    assert.match(error.message, /box secret.*status 7/);
    assert.match(error.message, /npm run setup/);
    assert.ok(!error.message.includes(config.boxAccessToken));
    return true;
  });
});

test("a missing sbx executable produces a safe actionable error", async () => {
  const spawnProcess = ((_command: string, _args: readonly string[], options: SpawnOptions) =>
    spawn("/nonexistent-sbx-test-executable", [], options)) as typeof spawn;
  await assert.rejects(storeSandboxSecret("box", config.boxAccessToken, { spawnProcess }), /Could not register the box secret/);
});

test("synchronous launch errors cannot leak their diagnostic contents", async () => {
  const spawnProcess = (() => { throw new Error(config.openaiApiKey); }) as typeof spawn;
  await assert.rejects(storeSandboxSecret("openai", config.openaiApiKey, { spawnProcess }), (error: Error) => {
    assert.match(error.message, /unable to start sbx/);
    assert.ok(!error.message.includes(config.openaiApiKey));
    return true;
  });
});

test("a stalled credential command is terminated with an explicit timeout", async () => {
  await assert.rejects(storeSandboxSecret("openai", config.openaiApiKey, {
    spawnProcess: fakeSbx("process.stdin.resume(); setInterval(() => {}, 1000);"),
    timeoutMs: 100,
  }), /openai secret: command timed out/);
});
