import { shellQuote, type Sandbox } from "./sandbox.js";

export async function validateOpenAi(sandbox: Sandbox, model: string): Promise<void> {
  await sandbox.files.write(
    "/tmp/check-openai.mjs",
    [
      "const model = process.argv[2];",
      'if (!model) throw new Error("No OpenAI model was supplied to the check.");',
      'const response = await fetch("https://api.openai.com/v1/models", {',
      "  headers: {",
      '    authorization: "Bearer " + process.env.OPENAI_API_KEY,',
      "  },",
      "});",
      "if (!response.ok) {",
      '  throw new Error("OpenAI key check failed (" + response.status + "): " + (await response.text()));',
      "}",
      "const payload = await response.json();",
      "if (!payload.data?.some((entry) => entry.id === model)) {",
      '  throw new Error("OpenAI model is not available to this key: " + model);',
      "}",
    ].join("\n"),
  );
  await sandbox.commands.run(`node /tmp/check-openai.mjs ${shellQuote(model)}`, {
    timeoutMs: 30_000,
  });
  console.log(`✓ OpenAI key works and can access ${model}`);
}
