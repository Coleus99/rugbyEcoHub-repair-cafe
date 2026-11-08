import {onRequest} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import {initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import express from "express";

initializeApp();
const HUBSPOT_TOKEN = defineSecret("HUBSPOT_TOKEN");
const RESTARTERS_TOKEN = defineSecret("RESTARTERS_TOKEN");

const app = express();
app.use(express.json());

// Every /api route needs a valid Firebase ID token.
// Under the emulator, FIREBASE_AUTH_EMULATOR_HOST is set automatically,
// so verifyIdToken checks emulator tokens without extra code.
app.use(async (req, res, next) => {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({error: "Not signed in"});
    return;
  }
  try {
    await getAuth().verifyIdToken(token);
    next();
  } catch {
    res.status(401).json({error: "Invalid sign-in"});
  }
});

// Placeholder until the HubSpot module is written.
app.get("/api/tickets", (_req, res) => {
  res.json({tickets: []});
});

export const api = onRequest(
  {
    region: "europe-west2",
    secrets: [HUBSPOT_TOKEN, RESTARTERS_TOKEN],
    maxInstances: 2,
  },
  app,
);
