import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BOX_KIT_REPOSITORY, BOX_TEMPLATE } from "../src/box-kit.js";
import { installBoxKit, runInstallCommand } from "../src/install-kit.js";

test("installer command runner preserves literal arguments without a shell", async () => {
  const literal = "path with spaces; $(not-a-command)";
  await runInstallCommand(process.execPath, [
    "-e", "process.exit(process.argv[1] === process.env.EXPECTED_ARG ? 0 : 2)", literal,
  ], { env: { EXPECTED_ARG: literal } });
});

test("installer command runner reports failed and missing commands", async () => {
  await assert.rejects(runInstallCommand(process.execPath, ["-e", "process.exit(7)"]), /exit 7/);
  await assert.rejects(runInstallCommand("/nonexistent-box-kit-test-command", []), /Cannot run/);
});

async function fixture(machine = 62) {
  const root = await mkdtemp(join(tmpdir(), "box-kit-test-"));
  const source = join(root, "binary with spaces");
  const header = Buffer.alloc(64);
  header.write("\x7fELF", "binary");
  header[4] = 2;
  header[5] = 1;
  header.writeUInt16LE(machine, 18);
  await writeFile(source, header, { mode: 0o600 });
  return { root, source, header };
}

for (const [arch, machine, folder] of [["x64", 62, "linux"], ["arm64", 183, "linux-arm64"]] as const) {
  test(`installer uses the upstream default branch and cleans private temporary files on ${arch}`, async () => {
    const { root, source, header } = await fixture(machine);
    const calls: string[][] = [];
    let checkout = "";
    try {
      await installBoxKit(source, { arch, tempRoot: root, run: async (command, args, options) => {
        calls.push([command, ...args]);
        if (args[0] === "clone") {
          assert.deepEqual(args.slice(0, -1), ["clone", "--depth", "1", "--", BOX_KIT_REPOSITORY]);
          checkout = args.at(-1)!;
          await mkdir(checkout);
          assert.equal((await stat(join(checkout, ".."))).mode & 0o777, 0o700);
        }
        if (command === "bash") {
          assert.deepEqual(args, ["scripts/build-and-load.sh"]);
          assert.equal(options?.cwd, checkout);
          assert.equal(options?.env?.IMAGE, BOX_TEMPLATE);
          assert.equal(options?.env?.BIN, `box-mount/${folder}/box-mount`);
          assert.equal(options?.env?.TAR, join(checkout, "..", "template.tar"));
          assert.equal(options?.env?.BASE, "docker/sandbox-templates:shell-docker");
          assert.ok(!Object.hasOwn(options!.env!, "BOX_ACCESS_TOKEN"));
          assert.ok(!Object.hasOwn(options!.env!, "OPENAI_API_KEY"));
          assert.deepEqual(await readFile(join(checkout, options!.env!.BIN!)), header);
          await writeFile(options!.env!.TAR!, "private image");
        }
      } });
      assert.deepEqual(calls.slice(0, 4), [
        ["git", "--version"], ["file", "--version"],
        ["docker", "info", "--format", "{{.ServerVersion}}"], ["sbx", "template", "ls"],
      ]);
      assert.equal(calls.length, 6);
      await assert.rejects(access(checkout));
      assert.deepEqual(await readdir(root), ["binary with spaces"]);
      assert.deepEqual(await readFile(source), header);
      assert.equal((await stat(source)).mode & 0o777, 0o600);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("installer rejects missing, non-Linux and wrong-architecture binaries before running commands", async () => {
  const { root, source } = await fixture();
  const run = async () => { assert.fail("No external command should run"); };
  try {
    await assert.rejects(installBoxKit("", { run }), /Usage:/);
    await assert.rejects(installBoxKit(join(root, "missing"), { run }), /ENOENT/);
    await assert.rejects(installBoxKit(root, { run, arch: "x64" }), /extracted Linux/);
    await assert.rejects(installBoxKit(source, { run, arch: "arm64" }), /does not match/);
    await assert.rejects(installBoxKit(source, { run, arch: "ia32" }), /Unsupported/);
    await writeFile(source, "not an ELF executable");
    await assert.rejects(installBoxKit(source, { run, arch: "x64" }), /extracted 64-bit Linux/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const stage of ["info", "clone", "scripts/build-and-load.sh"]) {
  test(`installer preserves the original and cleans up after ${stage} failure; retry works`, async () => {
    const { root, source, header } = await fixture();
    try {
      for (const fail of [true, false]) {
        let failed = false;
        const install = installBoxKit(source, { arch: "x64", tempRoot: root, run: async (_command, args) => {
          if (args[0] === "clone") await mkdir(args.at(-1)!);
          if (fail && args[0] === stage) { failed = true; throw new Error("simulated failure"); }
          assert.ok(!failed, "must stop after the first failure");
        } });
        if (fail) await assert.rejects(install, /simulated failure/);
        else await install;
        assert.deepEqual(await readdir(root), ["binary with spaces"]);
        assert.deepEqual(await readFile(source), header);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
