import { readFile } from "node:fs/promises";

const files = {
  migration: await readFile("supabase/migrations/0128_staff_offer_onboarding.sql", "utf8"),
  edge: await readFile("supabase/functions/manage-staff-offer/index.ts", "utf8"),
  client: await readFile("src/supabaseClient.js", "utf8"),
  platform: await readFile("src/PlatformModule.jsx", "utf8"),
  publicApp: await readFile("src/app.jsx", "utf8"),
  vercel: await readFile("vercel.json", "utf8"),
};

const checks = [
  ["protected offer table", /create table if not exists public\.staff_offers/i.test(files.migration)],
  ["candidate onboarding table", /create table if not exists public\.staff_candidate_onboarding/i.test(files.migration)],
  ["admin-only offer reads", /Admins can read staff offers[\s\S]*role in \('admin','superadmin'\)/i.test(files.migration)],
  ["application answers marked unverified", /imported_unverified/.test(files.migration) && /verified: false/.test(files.edge)],
  ["offer tokens stored only as hashes", /response_token_hash/.test(files.migration) && /sha256\(token\)/.test(files.edge) && !/response_token\s+text/i.test(files.migration)],
  ["secure accept and decline flow", /action === "respond"/.test(files.edge) && /\["accept", "decline"\]/.test(files.edge)],
  ["family-account collision guard", /belongs to a family account/.test(files.edge)],
  ["SCR checks remain incomplete", /identity_checks: \{ status: "incomplete"/.test(files.edge) && /dbs: \{ status: "incomplete"/.test(files.edge)],
  ["formal offer document awaits signature", /status: "awaiting_signature"/.test(files.edge) && /requires_signature: true/.test(files.edge)],
  ["admin offer wizard", /function StaffOfferWizard/.test(files.platform) && /"Offer job"/.test(files.platform)],
  ["candidate response page", /function StaffOfferResponse/.test(files.publicApp) && /"Accept offer"/.test(files.publicApp)],
  ["candidate route is noindex and no-store", /"Staff Offer"/.test(files.publicApp) && /"source": "\/staff-offer"[\s\S]*"noindex, nofollow"[\s\S]*"no-store"/.test(files.vercel)],
  ["frontend offer service", /fetchPublicStaffOffer/.test(files.client) && /respondToStaffOffer/.test(files.client) && /activateCandidateOnboarding/.test(files.client)],
];

let failed = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? "✓" : "✗"} ${label}`);
  if (!passed) failed += 1;
}

if (failed) {
  console.error(`\n${failed} staff offer onboarding contract check(s) failed.`);
  process.exit(1);
}

console.log("\nStaff offer onboarding contract checks passed.");
