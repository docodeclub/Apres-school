import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const tempDir = mkdtempSync(join(tmpdir(), "apres-env-guard-"));

try {
  symlinkSync(join(repoRoot, "scripts"), join(tempDir, "scripts"), "dir");

  const baseEnv = [
    "SUPABASE_PROJECT_REF=abcdefghijklmnop",
    "SUPABASE_FUNCTIONS_URL=https://abcdefghijklmnop.functions.supabase.co",
    "VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co",
    "VITE_SUPABASE_ANON_KEY=sb_publishable_abcdefghijklmnop",
    "VITE_BOOKING_PREVIEW_TOKEN=preview-token-abcdefghijklmnop",
    "PONCHOPAY_API_URL=https://api.ponchopay.example",
  ];

  const cases = [
    {
      name: "service-role-reuses-anon-key",
      env: [...baseEnv, "APRES_SERVICE_ROLE_KEY=sb_publishable_abcdefghijklmnop", "PONCHOPAY_INTEGRATION_KEY=poncho-integration-12345", "PONCHOPAY_PROCESSOR_TOKEN=poncho-processor-67890"],
      expectedInvalid: "APRES_SERVICE_ROLE_KEY",
    },
    {
      name: "processor-token-reuses-integration-key",
      env: [...baseEnv, "APRES_SERVICE_ROLE_KEY=service-role-secret-12345", "PONCHOPAY_INTEGRATION_KEY=poncho-shared-token-12345", "PONCHOPAY_PROCESSOR_TOKEN=poncho-shared-token-12345"],
      expectedInvalid: "PONCHOPAY_PROCESSOR_TOKEN",
    },
  ];

  const results = cases.map((item) => runCase(item));
  const failures = results.filter((item) => !item.pass);
  console.log(JSON.stringify({
    stagingEnvGuardReady: failures.length === 0,
    results,
    failures,
  }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function runCase(testCase) {
  writeFileSync(join(tempDir, ".env.staging"), `${testCase.env.join("\n")}\n`);
  const result = spawnSync(process.execPath, ["scripts/booking-staging-env-check.mjs"], {
    cwd: tempDir,
    encoding: "utf8",
  });
  const parsed = JSON.parse(result.stdout || "{}");
  const invalidKeys = (parsed.invalid || []).map((item) => item.key);
  return {
    name: testCase.name,
    pass: result.status !== 0 && invalidKeys.includes(testCase.expectedInvalid),
    expectedInvalid: testCase.expectedInvalid,
    invalidKeys,
  };
}
