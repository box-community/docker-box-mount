import { getDemoConfig } from "./config.js";
import { registerSandboxSecrets } from "./secrets.js";

async function main(): Promise<void> {
  await registerSandboxSecrets(getDemoConfig());
  console.log("✓ Box and OpenAI credentials registered with sbx from your configuration.");
  console.log("Next: npm run doctor");
  console.log("After changing a token in .env, rerun npm run setup and recreate the sandbox.");
}

main().catch((error: unknown) => {
  console.error(`\nCredential setup failed:\n${(error as Error).message}`);
  process.exitCode = 1;
});
