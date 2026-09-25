import { installBoxKit } from "../src/install-kit.js";
import { BOX_TEMPLATE } from "../src/box-kit.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1) throw new Error("Usage: npm run kit:install -- /path/to/linux/box-mount");
  await installBoxKit(args[0]!);
  console.log(`✓ Installed ${BOX_TEMPLATE} from the upstream Box kit. Nothing was published.`);
  console.log("Next: npm run setup, then npm run doctor.");
}

main().catch((error: unknown) => {
  console.error(`\nBox kit installation failed:\n${(error as Error).message}`);
  process.exitCode = 1;
});
