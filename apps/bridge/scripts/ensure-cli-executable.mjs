#!/usr/bin/env node

import { chmodSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(scriptDir, "..", "dist", "cli.js");

chmodSync(cliPath, 0o755);

const mode = statSync(cliPath).mode & 0o777;
if ((mode & 0o111) === 0) {
  throw new Error(`handoff_cli_not_executable:${cliPath}`);
}
