import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

const bundledNode = "/Users/lukecurrie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node";
const bundledPnpm = "/Users/lukecurrie/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pnpm";
const pathWithCurrentNode = [dirname(process.execPath), process.env.PATH].filter(Boolean).join(":");

const tools = [
  checkTool("node", ["--version"]),
  checkTool("npm", ["--version"]),
  checkTool("pnpm", ["--version"]),
  checkPath("bundled node", bundledNode, ["--version"]),
  checkPath("bundled pnpm", bundledPnpm, ["--version"]),
  checkTool("supabase", ["--version"]),
  checkPath("local supabase", "node_modules/.bin/supabase", ["--version"]),
];

const canRunPackageScripts = tools.some((tool) => tool.name === "npm" && tool.ok)
  || tools.some((tool) => tool.name === "pnpm" && tool.ok)
  || tools.some((tool) => tool.name === "bundled pnpm" && tool.ok);
const canRunNodeScripts = tools.some((tool) => tool.name === "node" && tool.ok)
  || tools.some((tool) => tool.name === "bundled node" && tool.ok);
const canRunSupabase = tools.some((tool) => ["supabase", "local supabase"].includes(tool.name) && tool.ok);

const report = {
  runtimeReady: canRunPackageScripts && canRunNodeScripts && canRunSupabase,
  canRunPackageScripts,
  canRunNodeScripts,
  canRunSupabase,
  currentNode: process.execPath,
  tools,
  recommendedCommands: {
    preflight: packageCommand("booking:staging-preflight") || `${bundledNode} scripts/booking-staging-preflight.mjs`,
    stagingRehearsal: packageCommand("booking:staging-rehearsal") || `${bundledNode} scripts/booking-staging-rehearsal.mjs`,
    parentRehearsal: packageCommand("booking:parent-rehearsal") || `${bundledNode} scripts/booking-parent-rehearsal.mjs`,
    stagingApply: packageCommand("booking:staging-apply") || `${bundledNode} scripts/booking-staging-apply.mjs`,
    bundledPnpm: existsSync(bundledPnpm) ? `${bundledPnpm} run booking:staging-preflight` : null,
  },
};

console.log(JSON.stringify(report, null, 2));

function checkTool(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, PATH: pathWithCurrentNode },
  });
  return {
    name: command,
    ok: result.status === 0,
    version: result.status === 0 ? (result.stdout || result.stderr).trim() : null,
    detail: result.status === 0 ? "available" : "not on PATH",
  };
}

function checkPath(name, command, args) {
  if (!existsSync(command)) {
    return {
      name,
      ok: false,
      version: null,
      detail: "missing",
    };
  }
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, PATH: pathWithCurrentNode },
  });
  return {
    name,
    ok: result.status === 0,
    version: result.status === 0 ? (result.stdout || result.stderr).trim() : null,
    detail: result.status === 0 ? command : (result.stderr || result.stdout || "failed").trim(),
  };
}

function packageCommand(scriptName) {
  if (tools.some((tool) => tool.name === "npm" && tool.ok)) return `npm run ${scriptName}`;
  if (tools.some((tool) => tool.name === "pnpm" && tool.ok)) return `pnpm run ${scriptName}`;
  if (tools.some((tool) => tool.name === "bundled pnpm" && tool.ok)) return `${bundledPnpm} run ${scriptName}`;
  return "";
}
