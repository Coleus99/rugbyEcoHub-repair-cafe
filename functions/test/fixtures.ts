import {readFileSync} from "node:fs";
import {resolve} from "node:path";

// Real sandbox responses saved from Bruno / curl in docs/hubspot_api.
export const fixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(
      resolve(__dirname, "../../docs/hubspot_api", name),
      "utf8",
    ),
  ) as T;
