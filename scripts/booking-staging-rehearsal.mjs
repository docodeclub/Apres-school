import { spawnSync } from "node:child_process";

const checks = [
  {
    label: "Preflight",
    command: ["scripts/booking-staging-preflight.mjs"],
    readyKey: "ok",
    warningOk: true,
  },
  {
    label: "Live readiness",
    command: ["scripts/booking-live-readiness.mjs"],
    readyKey: "bookingLiveReady",
    warningOk: true,
  },
  {
    label: "PonchoPay readiness",
    command: ["scripts/ponchopay-readiness-check.mjs", "--json"],
    readyKey: "ok",
    warningOk: true,
  },
  {
    label: "Staging bundle",
    command: ["scripts/booking-staging-bundle.mjs", "--json"],
    readyKey: "ok",
    warningOk: true,
  },
  {
    label: "Staging apply dry run",
    command: ["scripts/booking-staging-apply.mjs", "--json"],
    readyKey: "ok",
    warningOk: true,
  },
  {
    label: "Staging smoke dry run",
    command: ["scripts/booking-staging-smoke.mjs", "--json"],
    readyKey: "smokeReady",
    warningOk: true,
  },
  {
    label: "Parent booking rehearsal dry run",
    command: ["scripts/booking-parent-rehearsal.mjs", "--json"],
    readyKey: "parentRehearsalReady",
    warningOk: true,
  },
  {
    label: "Handoff",
    command: ["scripts/booking-staging-handoff.mjs"],
    readyKey: "handoffReady",
    warningOk: true,
  },
];

const results = checks.map(runCheck);
const hardFailures = results.filter((result) => !result.pass);
const openItems = results.filter((result) => result.pass && result.warning);
const readyItems = results.filter((result) => result.pass && !result.warning);
const localReady = Boolean(results.find((result) => result.label === "Preflight")?.pass);
const externalReady = openItems.length === 0 && hardFailures.length === 0;

const report = {
  rehearsalReady: hardFailures.length === 0,
  launchReady: hardFailures.length === 0 && openItems.length === 0,
  localReady,
  externalReady,
  ready: `${readyItems.length}/${results.length}`,
  open: `${openItems.length}/${results.length}`,
  generatedAt: new Date().toISOString(),
  results,
  blockers: hardFailures.map((item) => item.label),
  openItems: openItems.map((item) => item.label),
  next: buildNext(results, hardFailures, openItems),
};

console.log(JSON.stringify(report, null, 2));
if (hardFailures.length) process.exitCode = 1;

function runCheck(check) {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, check.command, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 30,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  const parsed = tryParseJson(output);
  const ready = parsed ? Boolean(parsed[check.readyKey]) : false;
  const exitOk = result.status === 0;
  const warning = exitOk && !ready && check.warningOk;
  return {
    label: check.label,
    pass: exitOk || warning,
    warning,
    ready,
    durationMs: Date.now() - startedAt,
    command: `${process.execPath} ${check.command.join(" ")}`,
    summary: parsed ? summarise(check.label, parsed) : output.split(/\r?\n/).slice(-6).join(" | ").slice(0, 1000),
    next: toList(parsed?.next),
  };
}

function buildNext(results, failures, warnings) {
  if (failures.length) return ["Resolve failed rehearsal checks before applying staging changes."];
  const next = [];
  results.forEach((result) => {
    if (!result.warning) return;
    toList(result.next).slice(0, 2).forEach((item) => {
      if (item && !next.includes(item)) next.push(item);
    });
  });
  if (!next.length) {
    next.push("Run staging apply with --all --yes, then run booking:staging-smoke:run and the authenticated parent booking rehearsal.");
  }
  return next.slice(0, 8);
}

function summarise(label, parsed) {
  if (label === "Preflight") return `${parsed.ok ? "ready" : "open"}; checks=${parsed.ready}; warnings=${parsed.warnings?.length || 0}; failures=${parsed.failures?.length || 0}`;
  if (label === "Live readiness") return `ready=${parsed.ready}; local=${parsed.localCodeReady}; external=${parsed.externalConfigReady}; next=${parsed.externalNext || parsed.next}`;
  if (label === "PonchoPay readiness") return `${parsed.ok ? "ready" : "open"}; callbacks=${parsed.callbackUrls?.filter((item) => item.url).length || 0}; next=${parsed.next?.[0] || "none"}`;
  if (label === "Staging bundle") return `${parsed.ok ? "ready" : "open"}; guard=${parsed.stagingGuard?.target || "missing"}; next=${parsed.next?.[0] || "none"}`;
  if (label === "Staging apply dry run") return `${parsed.ok ? "ready" : "open"}; guard=${parsed.stagingGuard?.target || "missing"}; secrets=${parsed.secrets?.requiredReady}; next=${parsed.next?.[0] || "none"}`;
  if (label === "Staging smoke dry run") return `${parsed.smokeReady ? "ready" : "open"}; ranLive=${parsed.ranLive}; endpoints=${parsed.endpoints?.length || 0}; next=${parsed.next?.[0] || "none"}`;
  if (label === "Parent booking rehearsal dry run") return `${parsed.parentRehearsalReady ? "ready" : "open"}; ranLive=${parsed.ranLive}; clientRequestId=${parsed.requestSummary?.clientRequestId || "missing"}; next=${parsed.next?.[0] || "none"}`;
  if (label === "Handoff") return `${parsed.handoffReady ? "ready" : "open"}; guard=${parsed.stagingGuard?.target || "missing"}; callbacks=${parsed.callbackUrls?.filter((item) => item.url).length || 0}; next=${parsed.next?.[0] || "none"}`;
  return JSON.stringify(parsed).slice(0, 500);
}

function tryParseJson(output) {
  if (!output.trim().startsWith("{")) return null;
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function toList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [value];
  if (typeof value === "object") return Object.values(value).flatMap(toList);
  return [];
}
