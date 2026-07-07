import { existsSync, readFileSync, writeFileSync } from "node:fs";

const envFile = ".env.staging";
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=")];
}));
const projectRef = clean(args.get("project-ref") || process.env.SUPABASE_PROJECT_REF);
const anonKey = clean(args.get("anon-key") || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY);
const write = args.has("write");

if (!projectRef || !/^[a-z0-9]{15,30}$/.test(projectRef)) {
  console.error("Provide a Supabase project ref with --project-ref=abcdefghijklmnopqrst.");
  process.exit(1);
}

const values = {
  SUPABASE_PROJECT_REF: projectRef,
  SUPABASE_FUNCTIONS_URL: `https://${projectRef}.functions.supabase.co`,
  VITE_SUPABASE_URL: `https://${projectRef}.supabase.co`,
};
if (anonKey) {
  if (!isLikelyAnonKey(anonKey)) {
    console.error("The anon key looks invalid. Use the Supabase publishable/anon key, not the service-role key.");
    process.exit(1);
  }
  values.VITE_SUPABASE_ANON_KEY = anonKey;
  values.SUPABASE_ANON_KEY = anonKey;
}

const existing = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
if (write) {
  writeFileSync(envFile, upsertEnvValues(existing, values));
}

console.log(JSON.stringify({
  supabaseStagingEnvReady: true,
  action: write ? "wrote-env-staging" : "preview-only",
  envFile,
  values: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, key.includes("KEY") ? redact(value) : value])),
  stillNeeded: [
    ...(!anonKey ? ["VITE_SUPABASE_ANON_KEY"] : []),
    "APRES_SERVICE_ROLE_KEY",
    "PONCHOPAY_API_URL",
    "PONCHOPAY_CHECKOUT_PATH",
    "PONCHOPAY_INTEGRATION_KEY",
    "PONCHOPAY_PROCESSOR_TOKEN",
  ],
}, null, 2));

function upsertEnvValues(content, nextValues) {
  const lines = content ? content.split(/\r?\n/) : [];
  Object.entries(nextValues).forEach(([key, value]) => {
    const index = lines.findIndex((line) => line.trim().startsWith(`${key}=`));
    if (index >= 0) {
      lines[index] = `${key}=${value}`;
    } else {
      if (lines.length && lines[lines.length - 1].trim()) lines.push("");
      lines.push(`${key}=${value}`);
    }
  });
  return `${lines.join("\n").replace(/\n*$/, "")}\n`;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isLikelyAnonKey(value) {
  return value.length >= 20 && !/^service_role/i.test(value) && !/^(change-me|todo|your-|placeholder|example|dummy|test)$/i.test(value);
}

function redact(value) {
  if (!value) return "missing";
  if (value.length <= 8) return "configured";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
