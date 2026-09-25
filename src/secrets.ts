import { spawn } from "node:child_process";
import { PROJECT_ROOT, type DemoConfig } from "./config.js";

type Service = "box" | "openai";
type SecretConfig = Pick<DemoConfig, "boxAccessToken" | "openaiApiKey">;

export function storeSandboxSecret(
  service: Service,
  value: string,
  { spawnProcess = spawn, timeoutMs = 30_000 } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    // dotenv populates process.env. Only stdin should carry these values to sbx.
    const env = { ...process.env };
    delete env.BOX_ACCESS_TOKEN;
    delete env.OPENAI_API_KEY;
    const failure = (detail: string) => new Error(
      `Could not register the ${service} secret: ${detail}. ` +
      "Check that sbx is installed and logged in, then rerun npm run setup.",
    );
    let child;
    try {
      child = spawnProcess("sbx", ["secret", "set", service], {
        cwd: PROJECT_ROOT,
        env,
        shell: false,
        // Never forward CLI output: even failure diagnostics might contain a token.
        stdio: ["pipe", "ignore", "ignore"],
      });
    } catch {
      reject(failure("unable to start sbx"));
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(failure("command timed out"));
    }, timeoutMs);
    timer.unref();
    let settled = false;
    function finish(error?: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    }
    child.once("error", () => finish(failure("unable to run sbx")));
    child.once("close", (code, signal) => finish(code === 0 ? undefined : failure(
      signal ? "command was terminated" : `command exited with status ${code}`,
    )));
    if (!child.stdin) {
      child.kill("SIGKILL");
      finish(failure("stdin is unavailable"));
      return;
    }
    child.stdin.once("error", () => {
      child.kill("SIGKILL");
      finish(failure("could not send the secret through stdin"));
    });
    child.stdin.end(value + "\n");
  });
}

export async function registerSandboxSecrets(
  config: SecretConfig,
  store: (service: Service, value: string) => Promise<void> = storeSandboxSecret,
): Promise<void> {
  const entries: [Service, string, string][] = [
    ["box", config.boxAccessToken.trim(), "BOX_ACCESS_TOKEN"],
    ["openai", config.openaiApiKey.trim(), "OPENAI_API_KEY"],
  ];
  // Validate both before changing either stored secret.
  for (const [, value, name] of entries) {
    if (!value || /[\r\n\0]/.test(value)) {
      throw new Error(`${name} must be a nonempty, single-line token in .env.`);
    }
  }
  for (const [service, value] of entries) await store(service, value);
}
