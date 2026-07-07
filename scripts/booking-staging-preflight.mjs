import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const checks = [
  ["wraparound dates", ["scripts/validate-wraparound-2026.mjs"]],
  ["backend map", ["scripts/validate-booking-backend-map.mjs"]],
  ["booking contract", ["scripts/booking-contract-check.mjs"]],
  ["env precedence", ["scripts/booking-env-precedence-check.mjs"]],
  ["staging env shape", ["scripts/booking-staging-env-check.mjs"]],
  ["staging env guards", ["scripts/booking-staging-env-guard-check.mjs"]],
  ["frontend env split", ["scripts/booking-frontend-env-check.mjs"]],
  ["secret safety", ["scripts/booking-secret-safety-check.mjs"]],
  ["hidden routes", ["scripts/booking-hidden-route-check.mjs"]],
  ["runtime tooling", ["scripts/booking-runtime-check.mjs"]],
  ["live readiness", ["scripts/booking-live-readiness.mjs"]],
  ["PonchoPay readiness", ["scripts/ponchopay-readiness-check.mjs", "--json"]],
  ["PonchoPay location URNs", ["scripts/ponchopay-location-urn-check.mjs"]],
  ["PonchoPay contract", ["scripts/ponchopay-contract-check.mjs"]],
  ["staging bundle", ["scripts/booking-staging-bundle.mjs", "--json"]],
  ["staging apply dry run", ["scripts/booking-staging-apply.mjs", "--json"]],
  ["staging smoke dry run", ["scripts/booking-staging-smoke.mjs", "--json"]],
  ["static checks", ["scripts/static-check.mjs"]],
  ["production build", ["node_modules/vite/bin/vite.js", "build"]],
];

const safeBuildNode = chooseBuildNode();
const results = checks.map(([label, args]) => runNodeCheck(label, args));
const failed = results.filter((result) => !result.pass);
const warnings = results.filter((result) => result.warning);
const report = {
  ok: failed.length === 0,
  generatedAt: new Date().toISOString(),
  ready: `${results.filter((result) => result.pass).length}/${results.length}`,
  results,
  warnings: warnings.map((result) => result.label),
  failures: failed.map((result) => result.label),
  next: failed.length
    ? ["Resolve failed local checks before pushing migrations or deploying functions."]
    : warnings.length
      ? ["Local code is deployable; load hidden-staging env/secrets before live rehearsal."]
      : ["Run supabase db push, deploy functions, configure PonchoPay callbacks, then run the hidden admin rehearsal."],
};

console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exitCode = 1;

function runNodeCheck(label, args) {
  const startedAt = Date.now();
  const nodePath = label === "production build" ? safeBuildNode : process.execPath;
  const result = spawnSync(nodePath, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  const pass = result.status === 0;
  const summary = summariseOutput(output);
  return {
    label,
    pass,
    warning: pass && isWarningSummary(label, summary, output),
    durationMs: Date.now() - startedAt,
    command: `${nodePath} ${args.join(" ")}`,
    summary,
  };
}

function isWarningSummary(label, summary, output) {
  if (label === "runtime tooling") return /runtimeReady=false/.test(summary);
  if (/bookingLiveReady=false|ponchoPayReady=false|stagingBundleReady=false|stagingApplyReady=false|frontendEnvReady=false/.test(summary)) return true;
  if (/stagingSmokeReady=false/.test(summary)) return true;
  return /OPEN ITEMS/.test(output);
}

function chooseBuildNode() {
  const explicit = process.env.BOOKING_PREFLIGHT_NODE;
  if (explicit && existsSync(explicit)) return explicit;
  const bundled = "/Users/lukecurrie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node";
  const major = Number(process.versions.node.split(".")[0] || 0);
  if (major >= 24 && existsSync(bundled)) return bundled;
  return process.execPath;
}

function summariseOutput(output) {
  if (!output) return "";
  const lines = output.split(/\r?\n/).filter(Boolean);
  const jsonLine = output.trim().startsWith("{") ? tryJsonSummary(output) : "";
  if (jsonLine) return jsonLine;
  return lines.slice(-6).join(" | ").slice(0, 1000);
}

function tryJsonSummary(output) {
  try {
    const parsed = JSON.parse(output);
    if ("launchReady" in parsed) return `launchReady=${parsed.launchReady}; days=${parsed.totals?.days}; failures=${parsed.failures?.length || 0}`;
    if ("backendMapReady" in parsed) return `backendMapReady=${parsed.backendMapReady}; mappings=${parsed.totals?.backendBlockMappings}; failures=${parsed.failures?.length || 0}`;
    if ("bookingContractReady" in parsed) return `bookingContractReady=${parsed.bookingContractReady}; failures=${parsed.failures?.length || 0}`;
    if ("envPrecedenceReady" in parsed) return `envPrecedenceReady=${parsed.envPrecedenceReady}; loaded=${parsed.loadedEnvFiles?.join(" > ") || "none"}`;
    if ("stagingEnvValid" in parsed) return `stagingEnvValid=${parsed.stagingEnvValid}; present=${parsed.present}; invalid=${parsed.invalid?.length || 0}`;
    if ("stagingEnvGuardReady" in parsed) return `stagingEnvGuardReady=${parsed.stagingEnvGuardReady}; failures=${parsed.failures?.length || 0}`;
    if ("frontendEnvReady" in parsed) return `frontendEnvReady=${parsed.frontendEnvReady}; missing=${parsed.missing?.length || 0}; blocked=${parsed.blocked?.length || 0}`;
    if ("secretSafetyReady" in parsed) return `secretSafetyReady=${parsed.secretSafetyReady}; privateEnvIgnored=${parsed.privateEnvIgnored}; trackedPrivate=${parsed.trackedPrivateEnv?.length || 0}`;
    if ("runtimeReady" in parsed) return `runtimeReady=${parsed.runtimeReady}; packageScripts=${parsed.canRunPackageScripts}; supabase=${parsed.canRunSupabase}`;
    if ("bookingLiveReady" in parsed) {
      const code = "localCodeReady" in parsed ? `; localCodeReady=${parsed.localCodeReady}` : "";
      const external = "externalConfigReady" in parsed ? `; externalConfigReady=${parsed.externalConfigReady}` : "";
      return `bookingLiveReady=${parsed.bookingLiveReady}; ready=${parsed.ready}${code}${external}; next=${parsed.externalNext || parsed.next}`;
    }
    if ("ponchoPayContractReady" in parsed) return `ponchoPayContractReady=${parsed.ponchoPayContractReady}; checks=${parsed.checks}; failures=${parsed.failures?.length || 0}`;
    if ("ponchoPayLocationUrnsReady" in parsed) return `ponchoPayLocationUrnsReady=${parsed.ponchoPayLocationUrnsReady}; configured=${parsed.configured}; pending=${parsed.pending?.join(", ") || "none"}`;
    if ("ok" in parsed && parsed.deployPlan) return `ponchoPayReady=${parsed.ok}; next=${parsed.next?.[0] || "none"}`;
    if ("ok" in parsed && parsed.stagingOnly) return `stagingBundleReady=${parsed.ok}; next=${parsed.next?.[0] || "none"}`;
    if ("dryRun" in parsed && "secrets" in parsed) return `stagingApplyReady=${parsed.ok}; dryRun=${parsed.dryRun}; requiredSecrets=${parsed.secrets?.requiredReady}; next=${parsed.next?.[0] || "none"}`;
    if ("smokeReady" in parsed) return `stagingSmokeReady=${parsed.smokeReady}; ranLive=${parsed.ranLive}; next=${parsed.next?.[0] || "none"}`;
    return JSON.stringify(parsed).slice(0, 500);
  } catch {
    return "";
  }
}
