import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = parseArgs(process.argv.slice(2));
const runLive = args.has("--run");
const dryRunDir = clean(args.get("--dry-run-dir"));
const requestedIds = clean(args.get("--parent-ids"))
  .split(",")
  .map(clean)
  .filter(Boolean);
const supabaseUrl = clean(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL);
const serviceRoleKey = clean(
  process.env.LIVE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.APRES_SERVICE_ROLE_KEY,
);

if (!dryRunDir) throw new Error("Provide --dry-run-dir.");
if (!requestedIds.length) throw new Error("Provide a comma-separated --parent-ids list.");
if (new Set(requestedIds).size !== requestedIds.length) throw new Error("The parent ID list contains duplicates.");
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase URL and service role key are required.");

const parents = readJsonLines(`${dryRunDir}/parent_accounts.import.jsonl`);
const children = readJsonLines(`${dryRunDir}/child_profiles.import.jsonl`);
const selectedParents = requestedIds.map((externalId) => {
  const parent = parents.find((row) => clean(row.external_id) === externalId);
  if (!parent) throw new Error(`Parent ${externalId} is not present in the reviewed dry-run payload.`);
  return parent;
});
const selectedParentIds = new Set(selectedParents.map((parent) => parent.id));
const selectedChildren = children.filter((child) => selectedParentIds.has(child.parent_account_id));

for (const parent of selectedParents) {
  const familyChildren = selectedChildren.filter((child) => child.parent_account_id === parent.id);
  if (!familyChildren.length) throw new Error(`Parent ${parent.external_id} has no linked children in the payload.`);
  if (!familyChildren.some((child) => child.active)) {
    throw new Error(`Parent ${parent.external_id} has no active child and cannot enter the invitation cohort.`);
  }
}

const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const databaseBatchSize = 75;
const existingAccounts = [];
for (const parentBatch of chunks(selectedParents, databaseBatchSize)) {
  const { data, error } = await service
    .from("parent_accounts")
    .select("id,email,external_source,external_id")
    .or(`id.in.(${parentBatch.map((parent) => parent.id).join(",")}),external_id.in.(${parentBatch.map((parent) => parent.external_id).join(",")})`);
  if (error) throw error;
  existingAccounts.push(...(data || []));
}

const emailMatches = [];
for (const emailBatch of chunks(selectedParents.map((parent) => parent.email), databaseBatchSize)) {
  const { data, error } = await service
    .from("parent_accounts")
    .select("id,email,external_source,external_id")
    .in("email", emailBatch);
  if (error) throw error;
  emailMatches.push(...(data || []));
}

for (const parent of selectedParents) {
  const identityMatch = existingAccounts.find((row) => (
    row.id === parent.id
    || (row.external_source === parent.external_source && clean(row.external_id) === clean(parent.external_id))
  ));
  if (identityMatch && identityMatch.id !== parent.id) {
    throw new Error(`Parent ${parent.external_id} conflicts with an existing imported identity.`);
  }
  const emailMatch = emailMatches.find((row) => clean(row.email).toLowerCase() === clean(parent.email).toLowerCase());
  if (emailMatch && emailMatch.id !== parent.id) {
    throw new Error(`Email ${parent.email} already belongs to another parent account.`);
  }
}

const existingParentIds = new Set(existingAccounts.map((row) => row.id));
const report = {
  mode: runLive ? "live" : "dry-run",
  emailsSent: 0,
  requestedFamilies: selectedParents.length,
  requestedChildren: selectedChildren.length,
  families: selectedParents.map((parent) => ({
    externalParentId: parent.external_id,
    parentAccountId: parent.id,
    name: parent.full_name,
    email: parent.email,
    centres: parent.registered_centres,
    missingFields: parent.migration_metadata?.missingFields || [],
    children: selectedChildren
      .filter((child) => child.parent_account_id === parent.id)
      .map((child) => ({
        externalChildId: child.external_id,
        childProfileId: child.id,
        name: child.full_name,
        active: child.active,
        missingFields: child.migration_metadata?.missingFields || [],
      })),
  })),
};

if (!runLive) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const insertedParentIds = selectedParents
  .filter((parent) => !existingParentIds.has(parent.id))
  .map((parent) => parent.id);
const linkedHealthReviewIds = [];

try {
  const now = new Date().toISOString();
  for (const parentBatch of chunks(selectedParents, databaseBatchSize)) {
    const { error } = await service
      .from("parent_accounts")
      .upsert(parentBatch.map((parent) => ({ ...parent, updated_at: now })), { onConflict: "id" });
    if (error) throw error;
  }

  for (const childBatch of chunks(selectedChildren, databaseBatchSize)) {
    const { error } = await service
      .from("child_profiles")
      .upsert(childBatch.map((child) => ({ ...child, updated_at: now })), { onConflict: "id" });
    if (error) throw error;
  }

  const queuedHealthReviews = [];
  for (const childIdBatch of chunks(selectedChildren.map((child) => child.external_id), databaseBatchSize)) {
    const { data, error } = await service
      .from("migration_health_review_items")
      .select("id,external_child_id,status")
      .eq("external_source", "magicbooking")
      .in("external_child_id", childIdBatch)
      .neq("status", "resolved");
    if (error) throw error;
    queuedHealthReviews.push(...(data || []));
  }
  const selectedChildByExternalId = new Map(selectedChildren.map((child) => [clean(child.external_id), child]));
  for (const review of queuedHealthReviews) {
    const child = selectedChildByExternalId.get(clean(review.external_child_id));
    if (!child) continue;
    const { error: healthReviewLinkError } = await service
      .from("migration_health_review_items")
      .update({
        imported_child_profile_id: child.id,
        status: "parent_update_required",
        updated_at: now,
      })
      .eq("id", review.id)
      .neq("status", "resolved");
    if (healthReviewLinkError) throw healthReviewLinkError;
    linkedHealthReviewIds.push(review.id);
  }

  const verified = [];
  for (const parentIdBatch of chunks(selectedParents.map((parent) => parent.id), databaseBatchSize)) {
    const { data, error } = await service
      .from("parent_accounts")
      .select("id,email,external_id,portal_status,migration_metadata,child_profiles(id,external_id,active,migration_metadata)")
      .in("id", parentIdBatch);
    if (error) throw error;
    verified.push(...(data || []));
  }
  if (verified.length !== selectedParents.length) throw new Error("Not every parent account was present after import.");
  const verifiedChildren = verified.flatMap((parent) => parent.child_profiles || []);
  if (verifiedChildren.length !== selectedChildren.length) throw new Error("Not every child profile was linked after import.");

  console.log(JSON.stringify({
    ...report,
    importedFamilies: verified.length,
    importedChildren: verifiedChildren.length,
    parentChildLinksVerified: true,
    missingInformationFlagsVerified: verified.every((parent) => (
      Array.isArray(parent.migration_metadata?.missingFields)
      && (parent.child_profiles || []).every((child) => Array.isArray(child.migration_metadata?.missingFields))
    )),
    healthReviewQueueLinked: true,
  }, null, 2));
} catch (error) {
  for (const parentIdBatch of chunks(insertedParentIds, databaseBatchSize)) {
    await service.from("parent_accounts").delete().in("id", parentIdBatch);
  }
  for (const reviewIdBatch of chunks(linkedHealthReviewIds, databaseBatchSize)) {
    await service
      .from("migration_health_review_items")
      .update({
        imported_child_profile_id: null,
        status: "awaiting_import",
        updated_at: new Date().toISOString(),
      })
      .in("id", reviewIdBatch)
      .neq("status", "resolved");
  }
  throw error;
}

function readJsonLines(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function parseArgs(tokens) {
  const parsed = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) continue;
    if (token === "--run") {
      parsed.set(token, true);
    } else {
      parsed.set(token, tokens[index + 1]);
      index += 1;
    }
  }
  return parsed;
}

function clean(value) {
  return String(value ?? "").trim();
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
