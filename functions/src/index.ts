import {onRequest} from "firebase-functions/v2/https";
import {defineSecret, defineString} from "firebase-functions/params";
import {initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
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
  verifyToken: (token) => getAuth().verifyIdToken(token),
});

export const api = onRequest(
  {
    region: "europe-west2",
    secrets: [HUBSPOT_TOKEN, RESTARTERS_TOKEN],
    maxInstances: 2,
  },
  app,
);
