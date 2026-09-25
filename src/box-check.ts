import type { Sandbox } from "./sandbox.js";

// Exercise the same folder-listing endpoint that Box Mount uses at bootstrap.
// Only the status is returned: no token, folder contents, or response body is logged.
export async function validateSandboxBoxAccess(sandbox: Sandbox, folderId: string): Promise<void> {
  if (!/^\d+$/.test(folderId)) throw new Error("BOX_FOLDER_ID must be a numeric Box folder ID.");
  const url = `https://api.box.com/2.0/folders/${folderId}/items?limit=1&fields=id`;
  let stdout: string;
  try {
    ({ stdout } = await sandbox.commands.run(
      "curl --silent --show-error --connect-timeout 10 --max-time 25 " +
      "--output /dev/null --write-out '\\nBOX_FOLDER_HTTP_STATUS:%{http_code}\\n' " +
      "--header 'Authorization: Bearer proxy-managed' " + `'${url}'`,
      { timeoutMs: 30_000 },
    ));
  } catch {
    throw new Error(
      "Box access check inside the sandbox could not complete. " +
      "Check curl availability, SBX proxy connectivity, and network policy for api.box.com.",
    );
  }
  const status = stdout.match(/^BOX_FOLDER_HTTP_STATUS:(\d{3})\r?$/m)?.[1];
  if (status === "200") return;
  if (status === "401") {
    throw new Error(
      "Box access check inside the sandbox failed (HTTP 401) after sandbox-scoped credential registration. " +
      "Check the Box token in .env and the kit's proxy credential binding/injection; " +
      "a working host token alone does not verify the sandbox credential path.",
    );
  }
  if (status === "403" || status === "404") {
    throw new Error(
      `Box folder access inside the sandbox failed (HTTP ${status}). ` +
      "Check BOX_FOLDER_ID, the token identity's folder permissions, and SBX network policy.",
    );
  }
  throw new Error(
    `Box access check inside the sandbox failed (${status ? `HTTP ${status}` : "no valid HTTP status"}). ` +
    "Check Box availability and SBX proxy/network connectivity, then retry.",
  );
}
