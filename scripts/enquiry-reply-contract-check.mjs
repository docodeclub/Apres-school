import { readFileSync } from "node:fs";

const files = {
  migration: "supabase/migrations/0108_enquiry_replies.sql",
  function: "supabase/functions/send-enquiry-reply/index.ts",
  email: "supabase/functions/_shared/booking-email.ts",
  client: "src/supabaseClient.js",
  platform: "src/PlatformModule.jsx",
};

const content = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, readFileSync(file, "utf8")]));
const checks = [
  ["reply history table", /create table if not exists public\.enquiry_replies/, content.migration],
  ["admin-only reply history", /current_user_app_role\(\) in \('admin', 'superadmin'\)/, content.migration],
  ["responded enquiry status", /add value if not exists 'responded'/, content.migration],
  ["reply function requires an administrator", /Only administrators can send enquiry replies/, content.function],
  ["reply function loads the original enquiry", /from\("enquiries"\)[\s\S]*select\("id,name,email,type,subject,message,status"\)/, content.function],
  ["reply function sends branded email", /paragraphsToHtml[\s\S]*Customer care[\s\S]*A reply from Après School/, content.function],
  ["reply function records audit evidence", /audit_log[\s\S]*enquiry_reply_sent/, content.function],
  ["shared email log links enquiry", /enquiry_id: input\.enquiryId/, content.email],
  ["client loads reply history", /enquiry_replies\(id, recipient_email, subject, body, status/, content.client],
  ["client invokes secure reply function", /functions\.invoke\("send-enquiry-reply"/, content.client],
  ["composer requires explicit approval", /I have reviewed the recipient, subject and message and approve this email for sending/, content.platform],
  ["composer disables unapproved sends", /disabled=\{!replyReviewed/, content.platform],
];

const failures = checks.filter(([, pattern, source]) => !pattern.test(source)).map(([label]) => label);
const report = { enquiryReplyReady: failures.length === 0, checks: checks.length, failures };
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
