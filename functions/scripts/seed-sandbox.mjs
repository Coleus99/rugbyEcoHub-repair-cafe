// Creates example repair bookings in the HubSpot SANDBOX by submitting the
// real booking form, then moves some along the pipeline with repair details.
// Safe to re-run: bookings whose item name and brand already exist are skipped.
//
// Run from functions/: npm run seed:sandbox
// People are made up and use @example.com addresses, which never receive mail.
// Each submission still sends the form's notification email to the backup inbox.

process.loadEnvFile(".secret.local");
process.loadEnvFile(".env.repair-cafe-dev");

const PORTAL = "149627376"; // sandbox
const FORM = "5125e5ec-13e4-45ce-b215-9cfe26a3894b"; // Repair Booking Form 2026
const TOKEN = process.env.HUBSPOT_TOKEN;
const PIPELINE = process.env.HUBSPOT_PIPELINE_ID;

// Stage ids in the sandbox pipeline.
const NEW = "1";
const IN_PROGRESS = "2";
const NEEDS_FOLLOW_UP = "6385083617";

const bookings = [
  { first: "Margaret", item: "Kettle", issue: "Switch won't stay down", category: "39", brand: "Russell Hobbs", year: 2015, date: "2026-11-21" },
  { first: "Priya", item: "Desk lamp", issue: "Flickers when moved", category: "40", brand: "Ikea", model: "Tertial", date: "2026-11-21" },
  { first: "Tom", item: "Laptop", issue: "Won't charge", category: "16", brand: "Dell", model: "Latitude E7450", year: 2016, date: "2026-11-21",
    then: { hs_pipeline_stage: IN_PROGRESS, repair_item_type: "Laptop", repair_problem_and_fix: "Charging port loose. Checking the board." } },
  { first: "Aisha", item: "Vacuum cleaner", issue: "Lost suction", category: "45", brand: "Dyson", model: "DC24", year: 2010, date: "2026-11-21",
    then: { hs_pipeline_stage: IN_PROGRESS, repair_item_type: "Vacuum", repair_item_weight_kg: "5.4" } },
  { first: "Gareth", item: "Roberts radio", issue: "No sound from speaker", category: "32", brand: "Roberts", model: "Revival", year: 2008, date: "2026-11-21",
    then: { hs_pipeline_stage: NEEDS_FOLLOW_UP, repair_item_type: "Portable radio", repair_problem_and_fix: "Speaker cone torn. Replacement ordered.",
      repair_spare_parts: "Third party", repair_next_steps: "More time needed" } },
  { first: "Helen", item: "Hair dryer", issue: "Cuts out after a minute", category: "38", brand: "Babyliss", date: "2026-11-21" },
  { first: "Sam", item: "Bike", issue: "Gears slipping", category: "48", brand: "Raleigh", date: "2026-12-05" },
  { first: "Leo", item: "Remote control car", issue: "Doesn't move, lights work", category: "44", date: "2026-12-05" },
  { first: "Joan", item: "Sewing machine", issue: "Needle keeps jamming", category: "8", brand: "Singer", model: "Tradition 2250", year: 2012, date: "2026-12-05",
    then: { hs_pipeline_stage: IN_PROGRESS, repair_item_type: "Sewing machine" } },
  { first: "Ravi", item: "Headphones", issue: "Left ear silent", category: "24", brand: "Sony", model: "WH-1000XM3", year: 2019, date: "2026-12-05" },
];

const hubspot = async (method, path, body) => {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${data.message}`);
  return data;
};

const findTicket = async ({ item, brand }) => {
  const filters = [
    { propertyName: "hs_pipeline", operator: "EQ", value: PIPELINE },
    { propertyName: "subject", operator: "EQ", value: item },
    brand
      ? { propertyName: "repair_item_brand", operator: "EQ", value: brand }
      : { propertyName: "repair_item_brand", operator: "NOT_HAS_PROPERTY" },
  ];
  const data = await hubspot("POST", "/crm/v3/objects/tickets/search", { filterGroups: [{ filters }] });
  return data.results[0]?.id;
};

const submit = async (b) => {
  const field = (objectTypeId, name, value) =>
    value === undefined ? [] : [{ objectTypeId, name, value: String(value) }];
  const fields = [
    ...field("0-1", "firstname", b.first),
    ...field("0-1", "lastname", "Example"),
    ...field("0-1", "email", `${b.first.toLowerCase()}.seed@example.com`),
    ...field("0-5", "subject", b.item),
    ...field("0-5", "content", b.issue),
    ...field("0-5", "restarters_category", b.category),
    ...field("0-5", "repair_item_brand", b.brand),
    ...field("0-5", "repair_item_model", b.model),
    ...field("0-5", "repair_item_year_made", b.year),
    ...field("0-5", "requested_repair_date", b.date),
  ];
  const res = await fetch(
    `https://api-eu1.hsforms.com/submissions/v3/integration/submit/${PORTAL}/${FORM}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields, context: { pageName: "Seed data" } }) },
  );
  if (!res.ok) throw new Error(`Form submit failed for ${b.item}: ${await res.text()}`);
};

// HubSpot creates the ticket a few seconds after the submission.
const waitForTicket = async (b) => {
  for (let i = 0; i < 12; i++) {
    const id = await findTicket(b);
    if (id) return id;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`No ticket appeared for ${b.item}`);
};

for (const b of bookings) {
  let id = await findTicket(b);
  if (id) {
    console.log(`exists   ${id}  ${b.item}`);
  } else {
    await submit(b);
    id = await waitForTicket(b);
    console.log(`created  ${id}  ${b.item}`);
  }
  if (b.then) {
    await hubspot("PATCH", `/crm/v3/objects/tickets/${id}`, { properties: b.then });
    console.log(`         moved on with repair details`);
  }
}
