import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { relative, sep } from "node:path";
import type { DemoConfig } from "./config.js";
import { PROJECT_ROOT, SANDBOX_NAME } from "./config.js";

const run = promisify(execFile);
export const BOX_KIT_REPOSITORY = "https://github.com/ajeetraina/sbx-kits-box.git";
export const BOX_KIT_REVISION = "897deef77ee6c7dedea81c600f5fbc3753eff550";
export const BOX_KIT_REFERENCE = `git+${BOX_KIT_REPOSITORY}#ref=${BOX_KIT_REVISION}`;
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
  _config: DemoConfig,
  _timeoutMs = SANDBOX_TIMEOUT_MS,
  launch: (args: string[]) => Promise<unknown> = sbx,
): Promise<Sandbox> {
  await launch(["run", "--detached", "--name", SANDBOX_NAME, "--template", "sbx-box:local", "shell", "--kit", BOX_KIT_REFERENCE]);
  return connectSandbox(SANDBOX_NAME);
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
