import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { BOX_KIT_REPOSITORY, BOX_TEMPLATE } from "./box-kit.js";

type CommandOptions = { cwd?: string; env?: NodeJS.ProcessEnv };
type RunCommand = (command: string, args: string[], options?: CommandOptions) => Promise<void>;

export const runInstallCommand: RunCommand = (command, args, options = {}) => new Promise((done, reject) => {
  const child = spawn(command, args, { ...options, shell: false, stdio: "inherit" });
  child.once("error", (error) => reject(new Error(`Cannot run ${command}: ${error.message}`)));
  child.once("close", (code, signal) => code === 0 ? done() : reject(new Error(
    `${command} ${args[0] ?? ""} failed (${signal ?? `exit ${code}`}). See the output above, fix the issue, and rerun npm run kit:install.`,
  )));
});

export async function installBoxKit(
  binaryPath: string,
  { run = runInstallCommand, arch = process.arch, tempRoot = tmpdir() } = {},
): Promise<void> {
  if (!binaryPath) throw new Error("Usage: npm run kit:install -- /path/to/linux/box-mount");
  if (arch !== "x64" && arch !== "arm64") throw new Error(`Unsupported host architecture: ${arch}`);
  const source = resolve(binaryPath);
  const binary = await open(source, "r");
  try {
    const header = Buffer.alloc(64);
    const info = await binary.stat();
    if (!info.isFile()) throw new Error("Supply the extracted Linux Box Mount executable, not a directory or archive.");
    const { bytesRead } = await binary.read(header, 0, header.length, 0);
    if (bytesRead < 64 || header.toString("hex", 0, 4) !== "7f454c46" || header[4] !== 2 || header[5] !== 1) {
      throw new Error("Supply the extracted 64-bit Linux Box Mount executable, not a macOS binary or archive.");
    }
    if (header.readUInt16LE(18) !== (arch === "x64" ? 62 : 183)) {
      throw new Error(`Box Mount binary does not match this ${arch} host. Obtain the matching Linux build from Box.`);
    }
  } finally {
    await binary.close();
  }

  // Fail before fetching or copying private files when required tools are unavailable.
  await run("git", ["--version"]);
  await run("file", ["--version"]);
  await run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  await run("sbx", ["template", "ls"]);

  const work = await mkdtemp(join(tempRoot, "box-kit-install-"));
  try {
    const checkout = join(work, "upstream");
    await run("git", ["clone", "--depth", "1", "--", BOX_KIT_REPOSITORY, checkout]);
    const relativeBinary = `box-mount/${arch === "arm64" ? "linux-arm64" : "linux"}/box-mount`;
    const destination = join(checkout, relativeBinary);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    await chmod(destination, 0o700);

    // Set the upstream script's inputs; inherited overrides must not change the
    // image name, pick a different binary, or write its archive outside this temp dir.
    const env: NodeJS.ProcessEnv = {
      ...process.env, IMAGE: BOX_TEMPLATE, BIN: relativeBinary,
      BASE: "docker/sandbox-templates:shell-docker", TAR: join(work, "template.tar"),
    };
    delete env.BOX_ACCESS_TOKEN;
    delete env.OPENAI_API_KEY;
    await run("bash", ["scripts/build-and-load.sh"], { cwd: checkout, env });
  } finally {
    // Only remove the unique directory created by this invocation, never the input binary.
    await rm(work, { recursive: true, force: true });
  }
}
