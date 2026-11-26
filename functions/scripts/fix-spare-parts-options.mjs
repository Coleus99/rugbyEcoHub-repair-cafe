// Makes sure the repair_spare_parts ticket property has its dropdown options.
// Creates the property if it's missing. If it exists, adds any missing
// options and keeps any extra ones already there, so no ticket loses a value.
//
// Dry run by default. Prints what it would change.
//   HUBSPOT_TOKEN=<live key> node scripts/fix-spare-parts-options.mjs
//   HUBSPOT_TOKEN=<live key> node scripts/fix-spare-parts-options.mjs --apply
//
// The key needs crm.schemas.tickets.write. Options match
// api/hubspot/create-ticket-properties.bru.

const TOKEN = process.env.HUBSPOT_TOKEN;
const APPLY = process.argv.includes("--apply");
const NAME = "repair_spare_parts";

if (!TOKEN) {
  console.error("Set HUBSPOT_TOKEN to the portal's service key.");
  process.exit(1);
}

const OPTIONS = [
  { label: "No spare parts required", value: "No" },
  { label: "Parts required from manufacturer", value: "Manufacturer" },
  { label: "Parts required from third party", value: "Third party" },
];

const DEFINITION = {
  name: NAME,
  label: "Repair Spare Parts",
  type: "enumeration",
  fieldType: "select",
  groupName: "repair_cafe_info",
  description: "Whether spare parts are needed.",
  formField: true,
};

const hubspot = async (method, path, body) => {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const data = res.status === 204 ? {} : await res.json();
  return { ok: res.ok, status: res.status, data };
};

const path = `/crm/properties/2026-09/tickets/${NAME}`;
const current = await hubspot("GET", path);

if (current.status === 404) {
  const body = { ...DEFINITION, options: OPTIONS.map((o, i) => ({ ...o, displayOrder: i })) };
  console.log(`${NAME} doesn't exist. Will create it with ${OPTIONS.length} options.`);
  if (APPLY) {
    const res = await hubspot("POST", "/crm/properties/2026-09/tickets", body);
    if (!res.ok) throw new Error(`Create failed: ${res.data.message}`);
    console.log("Created.");
  }
} else if (!current.ok) {
  throw new Error(`GET ${path}: ${current.data.message}`);
} else {
  const prop = current.data;
  console.log(`${NAME} exists: type ${prop.type}, field ${prop.fieldType}, ${prop.options.length} option(s).`);
  for (const o of prop.options) console.log(`  current: ${o.value} (${o.label})${o.hidden ? " [hidden]" : ""}`);

  if (prop.type !== "enumeration") {
    throw new Error(`${NAME} is a ${prop.type} property, not a dropdown. HubSpot can't change that safely. Fix it in the HubSpot UI.`);
  }

  // Wanted options first, in order, shown. Then any extras already there.
  const existing = new Map(prop.options.map((o) => [o.value, o]));
  const wanted = OPTIONS.map((o) => ({ ...existing.get(o.value), ...o, hidden: false }));
  const extras = prop.options.filter((o) => !OPTIONS.some((w) => w.value === o.value));
  const options = [...wanted, ...extras].map((o, i) => ({ ...o, displayOrder: i }));

  const missing = OPTIONS.filter((o) => {
    const e = existing.get(o.value);
    return !e || e.hidden || e.label !== o.label;
  });
  if (missing.length === 0) {
    console.log("All options already in place. Nothing to do.");
    process.exit(0);
  }
  for (const o of missing) console.log(`  will set: ${o.value} (${o.label})`);
  if (extras.length) console.log(`  keeping ${extras.length} extra option(s) already on the property.`);

  if (APPLY) {
    const res = await hubspot("PATCH", path, { fieldType: "select", options });
    if (!res.ok) throw new Error(`Update failed: ${res.data.message}`);
    console.log("Updated.");
  }
}

if (!APPLY) console.log("\nDry run. Add --apply to make the change.");
else console.log("The app caches dropdown options for up to 5 minutes, so reload after that.");
