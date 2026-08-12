import { readFileSync } from "node:fs";

const files = {
  migration: "supabase/migrations/0110_enquiry_intake_reliability.sql",
  intake: "supabase/functions/notify-public-enquiry/index.ts",
  client: "src/supabaseClient.js",
  app: "src/app.jsx",
  platform: "src/PlatformModule.jsx",
  emailLogs: "supabase/migrations/0025_email_logs.sql",
};

const content = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, readFileSync(file, "utf8")]));
const checks = [
  ["fingerprint stored and indexed", /submission_fingerprint[\s\S]*enquiries_submission_fingerprint_created_idx/, content.migration],
  ["duplicate classifications are explicit", /classification[\s\S]*duplicate_of[\s\S]*'duplicate', 'test', 'spam'/, content.migration],
  ["acceptance is serialized against races", /pg_advisory_xact_lock\(hashtextextended\(p_submission_fingerprint/, content.migration],
  ["dedupe window is bounded", /bounded_window_seconds[\s\S]*make_interval\(secs => bounded_window_seconds\)/, content.migration],
  ["acceptance is service-role only", /revoke all[\s\S]*from anon[\s\S]*from authenticated[\s\S]*grant execute[\s\S]*to service_role/, content.migration],
  ["classification verifies exact live identity", /classify_enquiry_record[\s\S]*Enquiry identity did not match the verified record/, content.migration],
  ["classification and audit are atomic", /update public\.enquiries[\s\S]*insert into public\.audit_log[\s\S]*enquiry_classified_/, content.migration],
  ["classification is service-role only", /classify_enquiry_record[\s\S]*revoke all[\s\S]*from authenticated[\s\S]*grant execute[\s\S]*to service_role/, content.migration],
  ["edge function fingerprints normalized content", /enquiryFingerprint[\s\S]*normalize\("NFKC"\)[\s\S]*SHA-256/, content.intake],
  ["edge function uses atomic acceptance", /rpc\("accept_public_enquiry"/, content.intake],
  ["duplicate does not notify again", /if \(!duplicate\) await notifyByEmail/, content.intake],
  ["client rejects unavailable service", /if \(!supabase\)[\s\S]*throw new Error/, content.client],
  ["client no longer saves failed submissions locally", !/local-fallback[\s\S]*saveLocalEnquiry/.test(content.client), true],
  ["client requires an accepted enquiry id", /if \(!data\?\.enquiry\?\.id\)[\s\S]*throw new Error/, content.client],
  ["public forms preserve recoverable errors", /state: "error"[\s\S]*message is still in the form/, content.app],
  ["duplicate confirmation is explicit", /We already received this enquiry/, content.app],
  ["CRM loads notification evidence", /email_logs\(id, email_type, status, provider, provider_message_id, error_message/, content.client],
  ["CRM distinguishes notification outcomes", /Notification sent[\s\S]*Notification failed[\s\S]*Notification queued[\s\S]*Notification unknown/, content.platform],
  ["CRM displays explicit classifications", /crm-classification[\s\S]*record\.classification/, content.platform],
  ["email evidence stays admin protected", /email_logs_admin_read[\s\S]*current_user_app_role\(\) in \('admin', 'superadmin'\)/, content.emailLogs],
  ["CRM remains unavailable to manager and staff tabs", /effectiveRole === "Staff"[\s\S]*effectiveRole === "Manager"[\s\S]*: platformTabs/, content.platform],
];

const failures = checks
  .filter(([, pattern, source]) => pattern instanceof RegExp ? !pattern.test(source) : pattern !== source)
  .map(([label]) => label);

const report = { enquiryIntakeReady: failures.length === 0, checks: checks.length, failures };
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
