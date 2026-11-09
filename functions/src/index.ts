import {onRequest} from "firebase-functions/v2/https";
import {defineSecret, defineString} from "firebase-functions/params";
import {initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {EMULATOR_TEST_EMAIL, isAllowed, parseEmails} from "./access";
import {createApp} from "./app";
import {createHubSpot} from "./hubspot";
import {createRestarters} from "./restarters";
import {parseStageStatus} from "./sync";

initializeApp();
const HUBSPOT_TOKEN = defineSecret("HUBSPOT_TOKEN");
const RESTARTERS_TOKEN = defineSecret("RESTARTERS_TOKEN");

// Non-secret config, set per project in functions/.env.<project id>.
const HUBSPOT_PIPELINE_ID = defineString("HUBSPOT_PIPELINE_ID");
const RESTARTERS_GROUP_ID = defineString("RESTARTERS_GROUP_ID", {
  default: "116",
});
// Which pipeline stages sync, as "stageId=Restarters status,...".
const RESTARTERS_STAGE_STATUS = defineString("RESTARTERS_STAGE_STATUS");
// Firebase accounts that may use the app, comma-separated.
const ALLOWED_EMAILS = defineString("ALLOWED_EMAILS", {
  default: "repaircaferugby@gmail.com",
});
// Dev only. Leave blank in prod so items go on the day's real event.
const RESTARTERS_EVENT_ID = defineString("RESTARTERS_EVENT_ID", {
  default: "",
});

// Under the emulator, FIREBASE_AUTH_EMULATOR_HOST is set automatically,
// so verifyIdToken checks emulator tokens without extra code.
const app = createApp({
  hubspot: () => createHubSpot(HUBSPOT_TOKEN.value()),
  pipelineId: () => HUBSPOT_PIPELINE_ID.value(),
  restarters: () => createRestarters(RESTARTERS_TOKEN.value()),
  syncConfig: () => ({
    groupId: RESTARTERS_GROUP_ID.value(),
    stageStatus: parseStageStatus(RESTARTERS_STAGE_STATUS.value()),
    eventIdOverride: RESTARTERS_EVENT_ID.value(),
  }),
  verifyToken: async (token) => {
    const decoded = await getAuth().verifyIdToken(token);
    const allowed = parseEmails(ALLOWED_EMAILS.value());
    if (process.env.FUNCTIONS_EMULATOR === "true") {
      allowed.push(EMULATOR_TEST_EMAIL);
    }
    if (!isAllowed(allowed, decoded.email)) {
      throw new Error(`Account not allowed: ${decoded.email ?? decoded.uid}`);
    }
    return decoded;
  },
});

export const api = onRequest(
  {
    region: "europe-west2",
    secrets: [HUBSPOT_TOKEN, RESTARTERS_TOKEN],
    maxInstances: 2,
  },
  app,
);
