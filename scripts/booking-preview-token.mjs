import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const envFile = ".env.staging";
const key = "VITE_BOOKING_PREVIEW_TOKEN";
const write = process.argv.includes("--write");
const rotate = process.argv.includes("--rotate");
const token = randomBytes(24).toString("base64url");

const existing = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
const current = readValue(existing, key);
const shouldWrite = write && (rotate || !current);
const nextToken = shouldWrite ? token : current || token;

if (shouldWrite) {
  writeFileSync(envFile, upsertEnvValue(existing, key, nextToken));
}

const report = {
  previewTokenReady: Boolean(nextToken),
  envFile,
  key,
  action: shouldWrite ? (current ? "rotated" : "created") : write ? "kept-existing" : "generated-preview-only",
  token: redact(nextToken),
  shareUrlPattern: "/launch-booking?preview=REDACTED",
};

console.log(JSON.stringify(report, null, 2));

function readValue(content, name) {
  const line = content.split(/\r?\n/).find((item) => item.trim().startsWith(`${name}=`));
  if (!line) return "";
  return line.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "");
}

function upsertEnvValue(content, name, value) {
  const lines = content ? content.split(/\r?\n/) : [];
  const index = lines.findIndex((line) => line.trim().startsWith(`${name}=`));
  if (index >= 0) {
    lines[index] = `${name}=${value}`;
  } else {
    if (lines.length && lines[lines.length - 1].trim()) lines.push("");
    lines.push(`${name}=${value}`);
  }
  return `${lines.join("\n").replace(/\n*$/, "")}\n`;
}

function redact(value) {
  if (!value) return "missing";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
