import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const privateEnvFiles = [".env", ".env.local", ".env.development", ".env.staging", ".env.production"];
const allowedEnvExamples = [".env.example", ".env.staging.example"];
const serverSecretKeys = [
  "APRES_SERVICE_ROLE_KEY",
  "PONCHOPAY_API_URL",
  "PONCHOPAY_INTEGRATION_KEY",
  "PONCHOPAY_PROCESSOR_TOKEN",
  "PONCHOPAY_WEBHOOK_SECRET",
  "PONCHOPAY_PROVIDER_ID",
  "PONCHOPAY_LOCATION_URN_DEFAULT",
  "RESEND_API_KEY",
];

const trackedFiles = runGit(["ls-files"]).split(/\r?\n/).filter(Boolean);
const ignoredPrivateFiles = privateEnvFiles.filter((file) => isIgnored(file));
const trackedPrivateEnv = privateEnvFiles.filter((file) => trackedFiles.includes(file));
const untrackedExampleFiles = allowedEnvExamples.filter((file) => !trackedFiles.includes(file) && existsInWorkingTree(file));
const exampleLeaks = allowedEnvExamples.flatMap((file) => scanExampleFile(file));

const report = {
  secretSafetyReady: trackedPrivateEnv.length === 0
    && ignoredPrivateFiles.length === privateEnvFiles.length
    && exampleLeaks.length === 0,
  privateEnvIgnored: `${ignoredPrivateFiles.length}/${privateEnvFiles.length}`,
  trackedPrivateEnv,
  untrackedExampleFiles,
  exampleLeaks,
  checkedPrivateEnvFiles: privateEnvFiles,
};

console.log(JSON.stringify(report, null, 2));
if (!report.secretSafetyReady) process.exitCode = 1;

function scanExampleFile(file) {
  if (!existsInWorkingTree(file)) return [];
  const values = parseEnv(readFileSync(file, "utf8"));
  return serverSecretKeys
    .filter((key) => values[key] && !isSafeExampleValue(values[key]))
    .map((key) => ({ file, key, detail: "Example file contains a non-placeholder server secret value." }));
}

function parseEnv(content) {
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
      }),
  );
}

function isSafeExampleValue(value) {
  return !value || /^(change-me|todo|your-|placeholder|example|dummy|test|\.\.\.)$/i.test(value);
}

function isIgnored(file) {
  const result = spawnSync("git", ["check-ignore", "--quiet", file], { encoding: "utf8" });
  return result.status === 0;
}

function existsInWorkingTree(file) {
  const result = spawnSync("test", ["-f", file], { encoding: "utf8" });
  return result.status === 0;
}

function runGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
  return result.stdout.trim();
}
