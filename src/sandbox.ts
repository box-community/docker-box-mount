import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { relative, sep } from "node:path";
import type { DemoConfig } from "./config.js";
import { PROJECT_ROOT, SANDBOX_NAME } from "./config.js";
import { BOX_KIT_REFERENCE, BOX_TEMPLATE } from "./box-kit.js";
import { registerSandboxSecrets, storeSandboxSecret } from "./secrets.js";
import { validateSandboxBoxAccess } from "./box-check.js";
export { BOX_KIT_REFERENCE, BOX_KIT_REPOSITORY } from "./box-kit.js";

const run = promisify(execFile);
export const SANDBOX_TIMEOUT_MS = 60 * 60 * 1000;
export const REMOTE_MOUNT_PATH = "/home/agent/workspace/box";
export type Sandbox = {
  sandboxId: string;
  commands: { run(command: string, options?: { timeoutMs?: number; cwd?: string }): Promise<{ stdout: string; stderr: string }> };
  files: { write(path: string, data: string | ArrayBuffer): Promise<void> };
  kill(): Promise<void>;
};
const sbx = (args: string[], timeout = 300_000) => run("sbx", args, { cwd: PROJECT_ROOT, timeout });
export const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
export async function createDemoSandbox(
  config: DemoConfig,
  _timeoutMs = SANDBOX_TIMEOUT_MS,
  {
    launch = sbx,
    connect = connectSandbox,
    store = storeSandboxSecret,
    checkBox = validateSandboxBoxAccess,
  }: {
    launch?: (args: string[]) => Promise<unknown>;
    connect?: (sandboxId: string) => Promise<Sandbox>;
    store?: typeof storeSandboxSecret;
    checkBox?: typeof validateSandboxBoxAccess;
  } = {},
): Promise<Sandbox> {
  await launch(["run", "--detached", "--name", SANDBOX_NAME, "--template", BOX_TEMPLATE, "shell", "--kit", BOX_KIT_REFERENCE]);
  // Register only after creation, matching the verified SBX scoped-secret flow.
  // Tokens go to the host secret store via stdin, never to guest command arguments.
  try {
    const sandbox = await connect(SANDBOX_NAME);
    await registerSandboxSecrets(config, (service, value) =>
      store(service, value, { sandboxId: sandbox.sandboxId }));
    await checkBox(sandbox, config.boxFolderId);
    return sandbox;
  } catch (error) {
    // Callers have not received the sandbox yet and cannot clean it up themselves.
    // A launch failure is deliberately outside this block: never delete an existing sandbox.
    await launch(["rm", "--force", SANDBOX_NAME]).catch(() => {
      console.warn(`Warning: could not remove incomplete sandbox ${SANDBOX_NAME}; inspect it with sbx ls.`);
    });
    throw error;
  }
}
export const connectSandbox = async (sandboxId: string): Promise<Sandbox> => ({
  sandboxId,
  commands: { run: async (command, options) => ({ stdout: await execSandbox({ sandboxId } as Sandbox, options?.cwd ? `cd ${shellQuote(options.cwd)} && ${command}` : command, options?.timeoutMs), stderr: "" }) },
  files: { write: async (path, data) => { const value = typeof data === "string" ? data : Buffer.from(data).toString("base64"); const command = typeof data === "string" ? `printf %s ${shellQuote(data)} > ${shellQuote(path)}` : `echo ${shellQuote(value)} | base64 -d > ${shellQuote(path)}`; await execSandbox({ sandboxId } as Sandbox, command); } },
  kill: async () => { await sbx(["rm", "--force", sandboxId]); },
});
export async function execSandbox(sandbox: Sandbox, command: string, timeout = 300_000): Promise<string> {
  const result = await sbx(["exec", sandbox.sandboxId, "--", "bash", "-lc", command], timeout);
  return result.stdout.trim();
}
export async function installBoxMount(sandbox: Sandbox, _archivePath: string): Promise<string> {
  return (await execSandbox(sandbox, "box-mount --version", 120_000)) || "Box Mount binary verified";
}
export const mountBox = (sandbox: Sandbox, folderId: string) => execSandbox(sandbox, `mkdir -p ${shellQuote(REMOTE_MOUNT_PATH)} && box-mount mount ${shellQuote(REMOTE_MOUNT_PATH)} ${shellQuote(folderId)}`).then(() => undefined);
export const unmountBox = (sandbox: Sandbox) => execSandbox(sandbox, `box-mount unmount ${shellQuote(REMOTE_MOUNT_PATH)}`).then(() => undefined);
export const boxMountStatus = (sandbox: Sandbox) => execSandbox(sandbox, "box-mount status", 30_000);
export function remoteFixturePath(fixtureRoot: string, localPath: string): string {
  return `${REMOTE_MOUNT_PATH}/${relative(fixtureRoot, localPath).split(sep).join("/")}`;
}
