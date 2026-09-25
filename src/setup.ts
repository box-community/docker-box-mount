import { getDemoConfig } from "./config.js";
import { registerSandboxSecrets } from "./secrets.js";

async function main(): Promise<void> {
  await registerSandboxSecrets(getDemoConfig());
  console.log("✓ Global Box and OpenAI credentials stored with sbx from your configuration.");
  console.log("Each new demo sandbox also registers its own scoped credentials from .env before use.");
  console.log("Storage is not an authentication check. Next: npm run doctor");
}

main().catch((error: unknown) => {
  console.error(`\nCredential setup failed:\n${(error as Error).message}`);
  process.exitCode = 1;
});
