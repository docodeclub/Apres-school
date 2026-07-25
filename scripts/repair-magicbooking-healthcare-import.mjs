import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = parseArgs(process.argv.slice(2));
const runLive = args.has("--run");
const dryRunDir = clean(args.get("--dry-run-dir"));
const supabaseUrl = clean(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL);
const serviceRoleKey = clean(process.env.APRES_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
const healthKeys = ["dietaryNeeds", "allergies", "medications", "autoInjectors", "medicalConditions", "send"];
const healthReviewPattern = /dietary|allerg|medication|auto-injector|medical condition|send/i;

if (!dryRunDir) throw new Error("Provide --dry-run-dir.");
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase URL and service role key are required.");

const sourceChildren = readJsonLines(`${dryRunDir}/child_profiles.import.jsonl`)
  .filter((child) => healthKeys.some((key) => child.consents?.registration?.[key]?.length));
const sourceByExternalId = new Map(sourceChildren.map((child) => [clean(child.external_id), child]));
const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: existing, error: loadError } = await service
  .from("child_profiles")
  .select("id,external_source,external_id,full_name,consents,migration_metadata")
  .eq("external_source", "magicbooking")
  .in("external_id", [...sourceByExternalId.keys()]);
if (loadError) throw loadError;

const conflicts = [];
const repairs = [];
for (const child of existing || []) {
  const source = sourceByExternalId.get(clean(child.external_id));
  if (!source) continue;
  const currentConsents = child.consents && typeof child.consents === "object" ? child.consents : {};
  const currentRegistration = currentConsents.registration && typeof currentConsents.registration === "object"
    ? currentConsents.registration
    : {};
  const sourceRegistration = source.consents?.registration || {};
  const nextRegistration = { ...currentRegistration };
  const repairedKeys = [];
  for (const key of healthKeys) {
    const sourceValue = Array.isArray(sourceRegistration[key]) ? sourceRegistration[key] : [];
    if (!sourceValue.length) continue;
    const currentValue = Array.isArray(currentRegistration[key]) ? currentRegistration[key] : [];
    if (!currentValue.length || isLegacyMedication(key, currentValue)) {
      nextRegistration[key] = sourceValue;
      repairedKeys.push(key);
    } else if (!deepEqual(currentValue, sourceValue)) {
      conflicts.push({ externalId: child.external_id, name: child.full_name, field: key });
    }
  }
  const sourceHealthMissing = (source.migration_metadata?.missingFields || []).filter((field) => healthReviewPattern.test(String(field)));
  const currentMetadata = child.migration_metadata && typeof child.migration_metadata === "object" ? child.migration_metadata : {};
  const nextMissingFields = [...new Set([...(currentMetadata.missingFields || []), ...sourceHealthMissing])];
  const metadataChanged = JSON.stringify(nextMissingFields) !== JSON.stringify(currentMetadata.missingFields || []);
  if (!repairedKeys.length && !metadataChanged) continue;
  repairs.push({
    id: child.id,
    externalId: child.external_id,
    name: child.full_name,
    repairedKeys,
    consents: { ...currentConsents, registration: nextRegistration },
    migrationMetadata: {
      ...currentMetadata,
      missingFields: nextMissingFields,
      requiresReview: true,
      healthcareStructuredAt: new Date().toISOString(),
    },
  });
}

if (runLive) {
  for (const repair of repairs) {
    const { error } = await service.from("child_profiles").update({
      consents: repair.consents,
      migration_metadata: repair.migrationMetadata,
      updated_at: new Date().toISOString(),
    }).eq("id", repair.id).eq("external_source", "magicbooking").eq("external_id", repair.externalId);
    if (error) throw error;
  }
}

console.log(JSON.stringify({
  mode: runLive ? "live" : "dry-run",
  sourceHealthcareRecords: sourceChildren.length,
  matchedImportedRecords: (existing || []).length,
  recordsToRepair: repairs.length,
  conflictsPreservedForManualReview: conflicts.length,
  emailsSent: 0,
  repairs: repairs.map(({ externalId, name, repairedKeys, migrationMetadata }) => ({
    externalId,
    name,
    repairedKeys,
    healthReviewFields: migrationMetadata.missingFields.filter((field) => healthReviewPattern.test(String(field))),
  })),
  conflicts,
}, null, 2));

function isLegacyMedication(key, value) {
  if (key !== "medications" || value.length !== 1) return false;
  const medication = value[0] || {};
  return /^\s*(name|medication name)\s*:/i.test(clean(medication.name))
    && ![medication.administered, medication.supervision, medication.time, medication.dosage, medication.effect, medication.reason].some(clean);
}

function deepEqual(left, right) {
  return JSON.stringify(sortForComparison(left)) === JSON.stringify(sortForComparison(right));
}

function sortForComparison(value) {
  if (Array.isArray(value)) return value.map(sortForComparison);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, nestedValue]) => [key, sortForComparison(nestedValue)]),
  );
}

function readJsonLines(path) {
  return readFileSync(path, "utf8").split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

function parseArgs(tokens) {
  const parsed = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) continue;
    if (token === "--run") parsed.set(token, true);
    else { parsed.set(token, tokens[index + 1]); index += 1; }
  }
  return parsed;
}

function clean(value) {
  return String(value ?? "").trim();
}
