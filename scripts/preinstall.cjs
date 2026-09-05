const fs = require("node:fs");
const path = require("node:path");

for (const lockfile of ["package-lock.json", "yarn.lock"]) {
  fs.rmSync(path.join(__dirname, "..", lockfile), { force: true });
}

const userAgent =
  process.env.npm_config_user_agent ?? process.env.NPM_CONFIG_USER_AGENT ?? "";

if (!userAgent.startsWith("pnpm/")) {
  console.error("Use pnpm instead");
  process.exit(1);
}