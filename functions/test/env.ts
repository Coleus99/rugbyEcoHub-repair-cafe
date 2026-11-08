// Settings for the tests that talk to the real HubSpot sandbox.
// HUBSPOT_TOKEN comes from functions/.secret.local, the same file the
// emulator uses. The pipeline id comes from the dev project's .env file.
try {
  process.loadEnvFile(".secret.local");
  process.loadEnvFile(".env.repair-cafe-dev");
} catch {
  // Missing files: the checks below explain what to set.
}

export const TOKEN = process.env.HUBSPOT_TOKEN ?? "";
export const PIPELINE_ID = process.env.HUBSPOT_PIPELINE_ID ?? "";
// A sandbox ticket the tests are allowed to edit. Override with
// TEST_TICKET_ID=... if it's deleted.
export const TEST_TICKET_ID = process.env.TEST_TICKET_ID ?? "448850507989";

if (!TOKEN || !PIPELINE_ID) {
  throw new Error(
    "Set HUBSPOT_TOKEN in functions/.secret.local and HUBSPOT_PIPELINE_ID " +
      "in functions/.env.repair-cafe-dev",
  );
}
