import { access } from "node:fs/promises";
import { join } from "node:path";
import { BoxApiError } from "box-node-sdk";
import type { Sandbox } from "./sandbox.js";
import { validateBoxAccess } from "./box.js";
import { FIXTURES_PATH, getDemoConfig } from "./config.js";
import { validateOpenAi } from "./openai-check.js";
import {
  createDemoSandbox,
  installBoxMount,
} from "./sandbox.js";

async function main(): Promise<void> {
  const config = getDemoConfig();
  await access(
    join(FIXTURES_PATH, "Incoming", "Acme-MSA.docx"),
  );
  await access(
    join(
      FIXTURES_PATH,
      "Playbook",
      "approved-contract-playbook.md",
    ),
  );

  console.log("✓ Configuration and fixtures found");
  const box = await validateBoxAccess(
    config.boxAccessToken,
    config.boxFolderId,
  );
  console.log(`✓ Box token works for ${box.user}`);
  console.log(`✓ Box folder is accessible: ${box.folder}`);

  let sandbox: Sandbox | undefined;
  try {
    console.log("Creating a short-lived Docker Sandbox check...");
    sandbox = await createDemoSandbox(config, 5 * 60 * 1000);
    console.log("✓ Sandbox-scoped credentials registered; Box folder listing works through the proxy");
    await installBoxMount(
      sandbox,
      config.boxMountArchive,
    );
    console.log("✓ Docker Sandbox accepted the Box Mount Linux binary");
    await validateOpenAi(sandbox, config.openaiModel);
  } finally {
    await sandbox?.kill().catch(() => undefined);
  }

  console.log("\nSetup looks good. Next: npm run seed");
}

main().catch((error: unknown) => {
  if (
    error instanceof BoxApiError &&
    error.responseInfo.statusCode === 401
  ) {
    console.error(
      "\nDoctor failed:\nBox authentication failed. Your Developer Token " +
        "may have expired.\nGenerate a new token and update " +
        "BOX_ACCESS_TOKEN in .env, then run npm run setup and retry.",
    );
  } else {
    console.error(`\nDoctor failed:\n${(error as Error).message}`);
  }
  process.exitCode = 1;
});
