import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tempDir = mkdtempSync(join(tmpdir(), "apres-env-precedence-"));
const node = process.execPath;
const repoRoot = process.cwd();
const script = join(repoRoot, "scripts", "booking-live-readiness.mjs");

try {
  symlinkSync(join(repoRoot, "supabase"), join(tempDir, "supabase"), "dir");
  symlinkSync(join(repoRoot, "node_modules"), join(tempDir, "node_modules"), "dir");

  writeFileSync(join(tempDir, ".env"), [
    "BOOKING_STAGING_TARGET=wrong-target",
    "VITE_SUPABASE_URL=https://wrong-project.supabase.co",
    "VITE_SUPABASE_ANON_KEY=wrong-anon",
    "VITE_BOOKING_PREVIEW_TOKEN=wrong-preview-token",
    "APRES_SERVICE_ROLE_KEY=wrong-service",
    "PONCHOPAY_API_URL=https://wrong-poncho.example",
    "PONCHOPAY_CHECKOUT_PATH=/wrong",
    "PONCHOPAY_INTEGRATION_KEY=wrong-integration",
    "PONCHOPAY_PROCESSOR_TOKEN=wrong-processor",
  ].join("\n"));

  writeFileSync(join(tempDir, ".env.staging"), [
    "BOOKING_STAGING_TARGET=hidden",
    "VITE_SUPABASE_URL=https://staging-project.supabase.co",
    "VITE_SUPABASE_ANON_KEY=staging-anon",
    "VITE_BOOKING_PREVIEW_TOKEN=staging-preview-token",
    "APRES_SERVICE_ROLE_KEY=staging-service",
    "PONCHOPAY_API_URL=https://pay.ponchopay.com",
    "PONCHOPAY_CHECKOUT_PATH=/api/integration/generic/initiate",
    "PONCHOPAY_INTEGRATION_KEY=staging-integration",
    "PONCHOPAY_PROCESSOR_TOKEN=staging-processor",
  ].join("\n"));

  const result = spawnSync(node, [script], {
    cwd: tempDir,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: [join(repoRoot, "node_modules", ".bin"), process.env.PATH].filter(Boolean).join(":"),
    },
  });

  if (result.status !== 0) fail("booking-live-readiness exited unexpectedly", result);
  const parsed = JSON.parse(result.stdout);
  const loaded = parsed.envFilesLoaded || [];
  const blockers = parsed.blockers || [];
  const envChecksReady = parsed.groups?.environment?.ready === "4/4";
  const secretChecksReady = parsed.groups?.secret?.ready === "5/5";
  const loadedInPriorityOrder = loaded[0] === ".env.staging" && loaded.includes(".env");

  const blockersAllowed = blockers.length === 0 || (blockers.length === 1 && blockers[0] === "Supabase CLI");
  const report = {
    envPrecedenceReady: loadedInPriorityOrder && envChecksReady && secretChecksReady && blockersAllowed,
    loadedEnvFiles: loaded,
    environmentReady: parsed.groups?.environment?.ready,
    secretsReady: parsed.groups?.secret?.ready,
    blockers,
  };

  console.log(JSON.stringify(report, null, 2));
  if (!report.envPrecedenceReady) process.exitCode = 1;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function fail(message, result) {
  console.error(message);
  if (result?.stdout) console.error(result.stdout);
  if (result?.stderr) console.error(result.stderr);
  process.exit(1);
}
