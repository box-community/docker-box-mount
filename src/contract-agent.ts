import type { Sandbox } from "./sandbox.js";
import type { DemoConfig } from "./config.js";
import {
  REMOTE_MOUNT_PATH,
  shellQuote,
} from "./sandbox.js";

export const REVIEW_OUTPUT_PATH =
  `${REMOTE_MOUNT_PATH}/Reviewed/Acme-MSA-review.md`;
const REMOTE_OPENAI_AGENT_PATH = "/home/agent/openai-review-agent";

const openAiRunner = String.raw`
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import mammoth from "mammoth";

const mountPath = process.argv[2];
const outputPath = process.argv[3];
const model = process.argv[4];
if (!model) throw new Error("No OpenAI model was supplied to the reviewer.");
const contractPath = mountPath + "/Incoming/Acme-MSA.docx";
const playbookPath =
  mountPath + "/Playbook/approved-contract-playbook.md";

const { value: contract } = await mammoth.extractRawText({
  path: contractPath,
});
const playbook = await readFile(playbookPath, "utf8");

const input = [
  "Act as a first-pass contract review assistant for a qualified enterprise legal team.",
  "Compare the agreement against the approved playbook.",
  "Follow the playbook's review standard and required output.",
  "Cite the agreement section for every finding and do not invent clauses.",
  "Return a complete review memo in Markdown only.",
  "",
  "APPROVED PLAYBOOK",
  "=================",
  playbook,
  "",
  "AGREEMENT",
  "=========",
  contract,
].join("\n");

const response = await fetch("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: {
    "authorization": "Bearer " + process.env.OPENAI_API_KEY,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model,
    input,
  }),
});

if (!response.ok) {
  throw new Error(
    "OpenAI request failed (" +
      response.status +
      "): " +
      (await response.text()),
  );
}

const payload = await response.json();
const review =
  payload.output_text ||
  (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("\n")
    .trim();

if (!review) {
  throw new Error("OpenAI returned no review text.");
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  review +
    "\n\n---\n_AI-generated with OpenAI inside Docker Sandbox. " +
    "Qualified legal review is required._\n",
  "utf8",
);

console.log(outputPath);
`;

async function runOpenAiAgent(sandbox: Sandbox, model: string): Promise<string> {
  await sandbox.commands.run(
    `mkdir -p ${shellQuote(REMOTE_OPENAI_AGENT_PATH)}`,
    { timeoutMs: 30_000 },
  );
  await sandbox.files.write(
    `${REMOTE_OPENAI_AGENT_PATH}/review.mjs`,
    openAiRunner,
  );
  await sandbox.files.write(
    `${REMOTE_OPENAI_AGENT_PATH}/package.json`,
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { mammoth: "1.12.1" },
    }),
  );
  await sandbox.commands.run("npm install --silent", {
    cwd: REMOTE_OPENAI_AGENT_PATH,
    timeoutMs: 180_000,
  });
  const result = await sandbox.commands.run(
    [
      "node review.mjs",
      shellQuote(REMOTE_MOUNT_PATH),
      shellQuote(REVIEW_OUTPUT_PATH),
      shellQuote(model),
    ].join(" "),
    {
      cwd: REMOTE_OPENAI_AGENT_PATH,
      timeoutMs: 300_000,
    },
  );
  return result.stdout.trim();
}

export async function runContractAgent(
  sandbox: Sandbox,
  config: DemoConfig,
): Promise<string> {
  return runOpenAiAgent(sandbox, config.openaiModel);
}
