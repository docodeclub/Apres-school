import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const envFiles = [".env.staging", ".env.production", ".env.local", ".env.development", ".env", ".env.example"];
const loadedEnvFiles = [];
const env = {
  ...loadEnvFiles(envFiles),
  ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value)),
};
const strict = process.argv.includes("--strict");

const checks = [
  checkFile("Core booking migration", "code", "supabase/migrations/0029_booking_core.sql", [
    "create table if not exists parent_accounts",
    "create table if not exists child_profiles",
    "create table if not exists bookings",
    "create table if not exists booking_items",
  ]),
  checkFile("Reservation RPC migration", "code", "supabase/migrations/0030_create_parent_booking_reservation.sql", [
    "create or replace function public.create_parent_booking_reservation",
    "pg_advisory_xact_lock",
    "metadata->>'labSessionId'",
    "metadata->>'sessionDate'",
  ]),
  checkFile("2026/27 wraparound seed", "code", "supabase/migrations/0045_seed_2026_wraparound_booking_sessions.sql", [
    "lab-willington-after",
    "lab-ripley-after",
    "lab-shrewsbury-after",
    "lab-kings-after",
  ]),
  checkFile("Parent cancellation RPC migration", "code", "supabase/migrations/0032_cancel_parent_booking.sql", [
    "create or replace function public.cancel_parent_booking",
    "booking_capacity_holds",
    "Cancellation window has closed",
  ]),
  checkFile("Parent amendment RPC migration", "code", "supabase/migrations/0033_amend_parent_booking_remove_items.sql", [
    "create or replace function public.amend_parent_booking_remove_items",
    "Amendment window has closed",
    "booking_capacity_holds",
  ]),
  checkFile("Parent add-session amendment RPC migration", "code", "supabase/migrations/0034_amend_parent_booking_add_items.sql", [
    "create or replace function public.amend_parent_booking_add_items",
    "Amendment window has closed",
    "availableBeforeAmendment",
    "amended_balance_due",
  ]),
  checkFile("Payment admin action ledger migration", "code", "supabase/migrations/0035_booking_payment_admin_actions.sql", [
    "create table if not exists booking_payment_admin_actions",
    "invoice_id text not null references booking_invoices",
    "mark_finance_review",
    "Admins can read booking payment admin actions",
  ]),
  checkFile("Parent booking Edge Function", "code", "supabase/functions/create-parent-booking/index.ts", [
    "create_parent_booking_reservation",
    "ponchopay-create-checkout",
    "labSessionId",
    "sessionDate",
  ]),
  checkFile("Parent booking update Edge Function", "code", "supabase/functions/update-parent-booking/index.ts", [
    "cancel_parent_booking",
    "amend_parent_booking_remove_items",
    "amend_parent_booking_add_items",
    "resend_payment_link",
    "resend_receipt",
    "mark_finance_review",
    "booking_payment_admin_actions",
    "Sign in before changing a booking",
    "Unsupported booking update action",
  ]),
  checkCli("Supabase CLI", "tooling", ["node_modules/.bin/supabase", "supabase"], ["--version"]),
  checkEnvValue("Hidden staging target", "environment", "BOOKING_STAGING_TARGET", "hidden"),
  checkEnv("Browser Supabase URL", "environment", "VITE_SUPABASE_URL"),
  checkEnv("Browser Supabase anon key", "environment", "VITE_SUPABASE_ANON_KEY"),
  checkEnv("Hidden booking preview token", "environment", "VITE_BOOKING_PREVIEW_TOKEN"),
  checkEnv("Service role key", "secret", "APRES_SERVICE_ROLE_KEY"),
  checkEnv("PonchoPay API URL", "secret", "PONCHOPAY_API_URL"),
  checkEnvValue("PonchoPay checkout path", "secret", "PONCHOPAY_CHECKOUT_PATH", "/api/integration/generic/initiate"),
  checkEnv("PonchoPay integration key", "secret", "PONCHOPAY_INTEGRATION_KEY"),
  checkEnv("PonchoPay processor token", "secret", "PONCHOPAY_PROCESSOR_TOKEN"),
];

const blockers = checks.filter((check) => !check.pass && check.required);
const warnings = checks.filter((check) => !check.pass && !check.required);
const readyCount = checks.filter((check) => check.pass).length;
const percent = Math.round((readyCount / checks.length) * 100);
const groups = buildGroups(checks);
const codeGroup = groups.code || { percent: 0, ready: "0/0", blockers: [] };
const externalGroupNames = ["tooling", "environment", "secret"];
const externalChecks = checks.filter((check) => externalGroupNames.includes(check.group));
const externalGroupsReady = externalChecks.length
  ? externalChecks.every((check) => check.pass)
  : true;
const externalNext = externalChecks.find((check) => !check.pass)?.label || "Authenticated parent booking rehearsal";

const report = {
  bookingLiveReady: blockers.length === 0,
  localCodeReady: codeGroup.blockers.length === 0,
  externalConfigReady: externalGroupsReady,
  percent,
  localCodePercent: codeGroup.percent,
  externalConfigPercent: externalChecks.length
    ? Math.round((externalChecks.filter((check) => check.pass).length / externalChecks.length) * 100)
    : 100,
  ready: `${readyCount}/${checks.length}`,
  codeReady: codeGroup.ready,
  externalReady: `${externalChecks.filter((check) => check.pass).length}/${externalChecks.length}`,
  envFilesLoaded: loadedEnvFiles,
  next: blockers[0]?.label || warnings[0]?.label || "Run authenticated parent booking rehearsal",
  externalNext,
  summary: codeGroup.blockers.length === 0 && blockers.length
    ? "Local booking code is ready; remaining blockers are live tooling, environment values or secrets."
    : blockers.length
      ? "Booking launch still has local code or live configuration blockers."
      : "Booking launch checks are ready for authenticated live rehearsal.",
  groups,
  checks,
  blockers: blockers.map((check) => check.label),
  warnings: warnings.map((check) => check.label),
};

console.log(JSON.stringify(report, null, 2));
if (strict && blockers.length) process.exitCode = 1;

function checkFile(label, group, relativePath, requiredFragments) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    return {
      label,
      group,
      pass: false,
      required: true,
      state: "Missing",
      detail: relativePath,
    };
  }

  const contents = readFileSync(absolutePath, "utf8");
  const missing = requiredFragments.filter((fragment) => !contents.includes(fragment));
  return {
    label,
    group,
    pass: missing.length === 0,
    required: true,
    state: missing.length ? "Incomplete" : "Ready",
    detail: missing.length ? `Missing: ${missing.join(", ")}` : relativePath,
  };
}

function checkEnv(label, group, key) {
  const value = env[key] || "";
  const configured = Boolean(value && !/^change-me$|^todo$|^your-/i.test(value));
  return {
    label,
    group,
    pass: configured,
    required: true,
    state: configured ? "Configured" : "Missing",
    detail: key,
  };
}

function checkEnvValue(label, group, key, expected) {
  const value = env[key] || "";
  const configured = Boolean(value && !/^change-me$|^todo$|^your-/i.test(value));
  return {
    label,
    group,
    pass: configured && value === expected,
    required: true,
    state: configured && value === expected ? "Configured" : configured ? "Wrong target" : "Missing",
    detail: `${key}=${expected}`,
  };
}

function checkCli(label, group, commands, args) {
  const candidates = Array.isArray(commands) ? commands : [commands];
  const pathWithCurrentNode = [dirname(process.execPath), process.env.PATH].filter(Boolean).join(":");
  const results = candidates.map((command) => ({
    command,
    result: spawnSync(command, args, {
      encoding: "utf8",
      env: { ...process.env, PATH: pathWithCurrentNode },
    }),
  }));
  const passing = results.find(({ result }) => result.status === 0);
  const attempted = results.map(({ command }) => command).join(", ");
  return {
    label,
    group,
    pass: Boolean(passing),
    required: true,
    state: passing ? "Installed" : "Missing",
    detail: passing
      ? `${passing.command}: ${passing.result.stdout.trim()}`
      : `Install the Supabase CLI before applying migrations/functions. Tried: ${attempted}.`,
  };
}

function buildGroups(checks) {
  const grouped = checks.reduce((groups, check) => {
    const group = check.group || "other";
    const groupChecks = groups[group]?._rawChecks || [];
    const nextChecks = [...groupChecks, check];
    const passed = nextChecks.filter((item) => item.pass).length;
    groups[group] = {
      _rawChecks: nextChecks,
      percent: Math.round((passed / nextChecks.length) * 100),
      ready: `${passed}/${nextChecks.length}`,
      blockers: nextChecks.filter((item) => !item.pass && item.required).map((item) => item.label),
      checks: nextChecks.map((item) => ({
        label: item.label,
        pass: item.pass,
        state: item.state,
        detail: item.detail,
      })),
    };
    return groups;
  }, {});
  Object.values(grouped).forEach((group) => delete group._rawChecks);
  return grouped;
}

function loadEnvFiles(files) {
  loadedEnvFiles.length = 0;
  return files.reduce((values, file) => {
    const absolutePath = join(root, file);
    if (!existsSync(absolutePath)) return values;
    loadedEnvFiles.push(file);
    const lines = readFileSync(absolutePath, "utf8").split(/\r?\n/);
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const rawValue = trimmed.slice(index + 1).trim();
      if (!key || values[key]) return;
      values[key] = rawValue.replace(/^['"]|['"]$/g, "");
    });
    return values;
  }, {});
}
