import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = parseArgs(process.argv.slice(2));
const runLive = args.has("--run");
const dryRunDir = clean(args.get("--dry-run-dir"));
const supabaseUrl = clean(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL);
const serviceRoleKey = clean(process.env.APRES_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

if (!dryRunDir) throw new Error("Provide --dry-run-dir.");
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase URL and service role key are required.");

const parents = readJsonLines(`${dryRunDir}/parent_accounts.import.jsonl`);
const children = readJsonLines(`${dryRunDir}/child_profiles.import.jsonl`);
const parentById = new Map(parents.map((parent) => [clean(parent.id), parent]));
const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const today = new Date().toISOString().slice(0, 10);
const expiredDevices = children.flatMap((child) => {
  const devices = child.consents?.registration?.autoInjectors || [];
  return devices
    .filter((device) => clean(device.type) && clean(device.expiry) && clean(device.expiry) < today)
    .map((device) => ({ child, device }));
});

const externalChildIds = expiredDevices.map(({ child }) => clean(child.external_id));
const { data: importedChildren, error: importedError } = await service
  .from("child_profiles")
  .select("id,external_id,parent_account_id")
  .eq("external_source", "magicbooking")
  .in("external_id", externalChildIds);
if (importedError) throw importedError;
const importedByExternalId = new Map((importedChildren || []).map((child) => [clean(child.external_id), child]));

const { data: existingReviewItems, error: existingReviewError } = await service
  .from("migration_health_review_items")
  .select("external_child_id,item_type,item_name,status")
  .eq("external_source", "magicbooking")
  .in("external_child_id", externalChildIds);
if (existingReviewError) throw existingReviewError;
const existingReviewByIdentity = new Map((existingReviewItems || []).map((item) => [
  `${clean(item.external_child_id)}|${clean(item.item_type)}|${clean(item.item_name).toLowerCase()}`,
  item,
]));

const rows = expiredDevices.map(({ child, device }) => {
  const parent = parentById.get(clean(child.parent_account_id));
  const importedChild = importedByExternalId.get(clean(child.external_id));
  const identity = `${clean(child.external_id)}|auto_injector|${clean(device.type).toLowerCase()}`;
  const existingReview = existingReviewByIdentity.get(identity);
  return {
    external_source: "magicbooking",
    external_parent_id: clean(parent?.external_id),
    external_child_id: clean(child.external_id),
    parent_name: clean(parent?.full_name) || null,
    parent_email: clean(parent?.email) || null,
    child_name: clean(child.full_name),
    item_type: "auto_injector",
    item_name: clean(device.type),
    expiry_date: clean(device.expiry),
    status: existingReview?.status === "resolved" ? "resolved" : importedChild ? "parent_update_required" : "awaiting_import",
    detail: `${clean(device.type)} expired on ${clean(device.expiry)}.`,
    recommended_action: "Parent must confirm the replacement auto-injector and current expiry date before booking.",
    source_batch: clean(child.migration_metadata?.batch) || "magicbooking-2026-07",
    imported_child_profile_id: importedChild?.id || null,
    updated_at: new Date().toISOString(),
  };
});

if (runLive && rows.length) {
  const writableRows = rows.filter((row) => row.status !== "resolved");
  if (writableRows.length) {
    const { error } = await service.from("migration_health_review_items").upsert(writableRows, {
      onConflict: "external_source,external_child_id,item_type,item_name",
    });
    if (error) throw error;
  }
}

console.log(JSON.stringify({
  mode: runLive ? "live" : "dry-run",
  expiredAutoInjectors: rows.length,
  parentUpdateRequired: rows.filter((row) => row.status === "parent_update_required").length,
  awaitingImport: rows.filter((row) => row.status === "awaiting_import").length,
  emailsSent: 0,
  rows: rows.map((row) => ({
    parent: row.parent_name,
    child: row.child_name,
    device: row.item_name,
    expiry: row.expiry_date,
    status: row.status,
  })),
}, null, 2));

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
