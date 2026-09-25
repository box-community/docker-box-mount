import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { test, type TestContext } from "node:test";
import { openAiRunner } from "../src/contract-agent.js";

const OUTPUT = "Reviewed/Acme-MSA-review.md";
const CONTRACT = "Incoming/discovered-agreement.docx";
const PLAYBOOK = "Playbook/discovered-playbook.md";
type Item = Record<string, any>;
type Request = { input: Item[]; model: string; tools: Item[]; [key: string]: any };
type Payload = { status: string; output: Item[] };
const tool = (name: string, args: unknown, id = "call") => ({
  type: "function_call", call_id: id, name, arguments: JSON.stringify(args),
});
const read = (filename: string) => tool("read_file", { path: filename });
const write = (content = "# Review\nSection 4: liability differs from the playbook.") =>
  tool("write_file", { path: OUTPUT, content });
const done = (): Item[] => [{ type: "message", role: "assistant", phase: "final_answer",
  content: [{ type: "output_text", text: "Review complete." }] }];
const completed = (output: Item[]): Payload => ({ status: "completed", output });
const lastResult = (request: Request) => JSON.parse(request.input.filter(item => item.type === "function_call_output").at(-1)!.output);

async function harness(t: TestContext) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "contract-agent-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const mount = path.join(root, "box");
  await fs.mkdir(path.join(mount, "Incoming"), { recursive: true });
  await fs.mkdir(path.join(mount, "Playbook"));
  await fs.writeFile(path.join(mount, CONTRACT), "DOCX fixture bytes");
  await fs.writeFile(path.join(mount, PLAYBOOK), "Approved criteria: flag uncapped liability.");
  const logs: string[] = [];
  const requests: Request[] = [];
  let docxReads = 0;
  let deadline: (() => void) | undefined;
  let deadlineCleared = false;
  const run = async (respond: (request: Request, index: number) => Payload | Promise<Payload>, httpError?: { status: number; message: string }) => {
    // Execute the exact guest script, substituting only the API, DOCX parser,
    // process, logging and timer. Filesystem operations use real temporary files.
    const execute = new Function("fs", "path", "mammoth", "fetch", "process", "console", "setTimeout", "clearTimeout",
      `return (async () => { ${openAiRunner.replace(/^import .*;\n/gm, "")} })();`);
    await execute(fs, path, {
      extractRawText: async ({ buffer }: { buffer: Buffer }) => {
        assert.equal(buffer.toString(), "DOCX fixture bytes");
        docxReads++;
        return { value: "Section 4: liability is unlimited." };
      },
    }, async (url: string, options: { body: string; signal: AbortSignal }) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.ok(options.signal instanceof AbortSignal);
      const request = JSON.parse(options.body) as Request;
      requests.push(request);
      return { ok: !httpError, status: httpError?.status, text: async () => httpError?.message,
        json: async () => respond(request, requests.length - 1) };
    }, {
      argv: ["node", "review.mjs", mount, path.join(mount, OUTPUT), "configured-model"],
      env: { OPENAI_API_KEY: "test-only" },
      exit: (code: number) => { throw new Error("guest exit " + code); },
    }, {
      log: (line: string) => logs.push(line), error: (line: string) => logs.push(line),
    }, (callback: () => void, ms: number) => {
      assert.equal(ms, 240_000);
      deadline = callback;
      return 1;
    }, (id: number) => { assert.equal(id, 1); deadlineCleared = true; });
  };
  const sequence = (actions: Item[][]) => run((_request, index) => {
    assert.ok(index < actions.length, "unexpected extra model request");
    return completed(actions[index]!);
  });
  return { root, mount, run, sequence, requests, logs, docxReads: () => docxReads,
    deadline: () => deadline!(), deadlineCleared: () => deadlineCleared };
}

test("agent discovers sources, observes results, writes and verifies; history and model survive every turn", async t => {
  const h = await harness(t);
  const reasoning = { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "opaque" };
  const phase = { type: "message", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "Inspecting files." }] };
  await h.run((request, index) => {
    assert.equal(request.model, "configured-model");
    assert.equal(request.parallel_tool_calls, false);
    assert.equal(request.store, false);
    assert.deepEqual(request.include, ["reasoning.encrypted_content"]);
    assert.deepEqual(request.tools.map(tool => tool.name), ["list_files", "read_file", "write_file"]);
    assert.ok(request.tools.every(tool => tool.strict && !tool.parameters.additionalProperties));
    if (index === 0) {
      assert.equal(request.input.length, 1);
      assert.ok(!JSON.stringify(request.input).includes("Approved criteria"));
      assert.equal(h.docxReads(), 0);
      return completed([reasoning, phase, tool("list_files", { path: "Incoming" }, "discover-contract")]);
    }
    assert.deepEqual(request.input[1], reasoning);
    assert.deepEqual(request.input[2], phase);
    if (index === 1) {
      assert.deepEqual(lastResult(request).entries, [path.basename(CONTRACT)]);
      assert.equal(request.input.at(-1)!.call_id, "discover-contract");
      return completed([tool("list_files", { path: "Playbook" })]);
    }
    if (index === 2) {
      assert.deepEqual(lastResult(request).entries, [path.basename(PLAYBOOK)]);
      return completed([read(PLAYBOOK)]);
    }
    if (index === 3) {
      assert.match(lastResult(request).text, /Approved criteria/);
      return completed([read(CONTRACT)]);
    }
    if (index === 4) {
      assert.match(lastResult(request).text, /Section 4/);
      return completed([write()]);
    }
    if (index === 5) {
      assert.equal(lastResult(request).path, OUTPUT);
      return completed([read(OUTPUT)]);
    }
    assert.equal(index, 6);
    assert.match(lastResult(request).text, /Qualified legal review is required/);
    return completed(done());
  });
  assert.equal(h.docxReads(), 1);
  assert.ok(h.logs.some(line => line.includes("write_file")));
  assert.ok(h.logs.some(line => line.includes("saved and verified")));
  assert.ok(!h.logs.some(line => line.includes("liability")));
  assert.equal(h.deadlineCleared(), true);
});

test("missing files and malformed or unknown tools return errors the agent can recover from", async t => {
  const h = await harness(t);
  const actions = [
    [read("Incoming/missing.docx")],
    [{ type: "function_call", call_id: "bad-json", name: "read_file", arguments: "{" }],
    [tool("read_file", { path: PLAYBOOK, extra: true })],
    [tool("shell", { path: "env" })],
    [read(CONTRACT)], [read(PLAYBOOK)], [write()], [read(OUTPUT)], done(),
  ];
  await h.run((request, index) => {
    if (index >= 1 && index <= 4) assert.equal(lastResult(request).ok, false);
    if (index === 1) assert.equal(lastResult(request).error, "ENOENT");
    return completed(actions[index]!);
  });
});

test("tool permissions reject traversal, absolute paths, sibling directories, symlinks and hard links", async t => {
  const h = await harness(t);
  const secret = path.join(h.root, "secret.md");
  await fs.writeFile(secret, "do not expose");
  await fs.symlink(secret, path.join(h.mount, "Incoming/link.md"));
  await fs.symlink(h.root, path.join(h.mount, "Playbook/linked-dir"));
  await fs.link(secret, path.join(h.mount, "Incoming/hardlink.md"));
  const denied = [
    read("../secret.md"), read(secret), read("Incoming/../Playbook/discovered-playbook.md"),
    read("Incoming-other/secret.md"), read("Incoming\\secret.md"), read("Incoming/link.md"),
    read("Playbook/linked-dir/secret.md"), read("Incoming/hardlink.md"), read("Incoming/.env"),
    tool("list_files", { path: "../" }), tool("list_files", { path: "Playbook/linked-dir" }),
    tool("write_file", { path: PLAYBOOK, content: "overwrite" }),
    tool("write_file", { path: "Reviewed/other.md", content: "extra" }),
  ];
  await h.run((request, index) => {
    if (index > 2 && index <= denied.length + 2) {
      assert.equal(lastResult(request).ok, false);
      assert.ok(!JSON.stringify(request.input).includes("do not expose"));
    }
    const actions = [[read(CONTRACT)], [read(PLAYBOOK)], ...denied.map(item => [item]), [write()], [read(OUTPUT)], done()];
    return completed(actions[index]!);
  });
  assert.equal(await fs.readFile(secret, "utf8"), "do not expose");
  assert.match(await fs.readFile(path.join(h.mount, PLAYBOOK), "utf8"), /Approved criteria/);
});

for (const target of ["directory symlink", "file symlink", "hard link"]) {
  test("writing rejects an output " + target + " without changing its target", async t => {
    const h = await harness(t);
    const outside = path.join(h.root, "outside");
    await fs.mkdir(outside);
    const secret = path.join(outside, path.basename(OUTPUT));
    await fs.writeFile(secret, "preserve this");
    if (target === "directory symlink") await fs.symlink(outside, path.join(h.mount, "Reviewed"));
    else {
      await fs.mkdir(path.join(h.mount, "Reviewed"));
      if (target === "file symlink") await fs.symlink(secret, path.join(h.mount, OUTPUT));
      else await fs.link(secret, path.join(h.mount, OUTPUT));
    }
    await assert.rejects(h.sequence([[read(CONTRACT)], [read(PLAYBOOK)], [write()], done()]), /without writing and reading back/);
    assert.equal(lastResult(h.requests.at(-1)!).ok, false);
    assert.equal(await fs.readFile(secret, "utf8"), "preserve this");
  });
}

test("an old review or a text-only final response cannot satisfy completion", async t => {
  const h = await harness(t);
  await fs.mkdir(path.join(h.mount, "Reviewed"));
  await fs.writeFile(path.join(h.mount, OUTPUT), "old review");
  await assert.rejects(h.sequence([[read(OUTPUT)], done()]), /without writing and reading back/);
  assert.equal(await fs.readFile(path.join(h.mount, OUTPUT), "utf8"), "old review");
  assert.equal(h.deadlineCleared(), true);
});

test("writing requires source reads, and every revision requires a new read-back", async t => {
  const h = await harness(t);
  await assert.rejects(h.sequence([[write()], [read(CONTRACT)], [read(PLAYBOOK)], [write()], [read(OUTPUT)], [write("Revised findings")], done()]), /without writing and reading back/);
  assert.match(lastResult(h.requests[1]!).error, /Read the contract/);
});

test("a completed run can revise a report and verify the latest version", async t => {
  const h = await harness(t);
  await h.sequence([[read(PLAYBOOK)], [read(CONTRACT)], [write()], [read(OUTPUT)], [write("Revised findings")], [read(OUTPUT)], done()]);
  assert.match(await fs.readFile(path.join(h.mount, OUTPUT), "utf8"), /^Revised findings/);
});

test("completion rechecks the file after the model has observed it", async t => {
  const h = await harness(t);
  await assert.rejects(h.run(async (_request, index) => {
    const actions = [[read(CONTRACT)], [read(PLAYBOOK)], [write()], [read(OUTPUT)]];
    if (index < actions.length) return completed(actions[index]!);
    await fs.writeFile(path.join(h.mount, OUTPUT), "changed externally");
    return completed(done());
  }), /changed after verification/);
});

test("empty and oversized documents and review writes are rejected", async t => {
  const h = await harness(t);
  await fs.writeFile(path.join(h.mount, "Playbook/huge.md"), Buffer.alloc(2 * 1024 * 1024 + 1, "x"));
  await fs.writeFile(path.join(h.mount, "Playbook/long.md"), "x".repeat(128 * 1024 + 1));
  await fs.writeFile(path.join(h.mount, "Playbook/empty.md"), "");
  await h.sequence([[read("Playbook/huge.md")], [read("Playbook/long.md")], [read("Playbook/empty.md")],
    [read(CONTRACT)], [read(PLAYBOOK)], [write(" ")], [write("x".repeat(128 * 1024))], [write()], [read(OUTPUT)], done()]);
  for (const index of [1, 2, 3, 6, 7]) assert.equal(lastResult(h.requests[index]!).ok, false);
});

test("repeated actions hit the turn limit", async t => {
  const h = await harness(t);
  await assert.rejects(h.run(() => completed([tool("list_files", { path: "." })])), /turn limit/);
  assert.equal(h.requests.length, 20);
  assert.equal(h.deadlineCleared(), true);
});

test("multiple calls in a response cannot bypass the tool-call limit", async t => {
  const h = await harness(t);
  await assert.rejects(h.run(() => completed(Array.from({ length: 31 }, (_, i) => tool("list_files", { path: "." }, "call" + i)))), /tool-call limit/);
  assert.equal(h.logs.length, 30);
});

test("incomplete API responses fail without writing or executing partial tool calls", async t => {
  const h = await harness(t);
  await assert.rejects(h.run(() => ({ status: "incomplete", output: [write()] })), /did not complete/);
  await assert.rejects(fs.stat(path.join(h.mount, OUTPUT)), { code: "ENOENT" });
});

test("API failures propagate without a substitute report", async t => {
  const h = await harness(t);
  await assert.rejects(h.run(() => completed([]), { status: 401, message: "invalid key" }), /OpenAI request failed \(401\): invalid key/);
  assert.equal(h.requests.length, 1);
  await assert.rejects(fs.stat(path.join(h.mount, OUTPUT)), { code: "ENOENT" });
});

test("the guest deadline terminates the process and is cleaned up on failure", async t => {
  const h = await harness(t);
  await assert.rejects(h.run(() => {
    h.deadline();
    return completed([]);
  }), /guest exit 1/);
  assert.ok(h.logs.some(line => line.includes("four-minute runtime limit")));
  assert.equal(h.deadlineCleared(), true);
});
