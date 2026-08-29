import { readFileSync } from "node:fs";

const files = {
  migration: readFileSync("supabase/migrations/0145_support_ticket_unread_attachments.sql", "utf8"),
  booking: readFileSync("src/BookingLab.jsx", "utf8"),
  parentClient: readFileSync("src/bookingSystem.js", "utf8"),
  staff: readFileSync("src/PlatformModule.jsx", "utf8"),
  staffClient: readFileSync("src/supabaseClient.js", "utf8"),
};
const checks = [
  ["private attachment bucket", /'support-ticket-private'[\s\S]*false[\s\S]*8388608/, files.migration],
  ["restricted attachment reads", /Families read own ticket attachments[\s\S]*parent_account_has_access/, files.migration],
  ["per-user receipts", /primary key \(enquiry_id, reader_profile_id, reader_type\)/, files.migration],
  ["audited attachment metadata", /audit_log[\s\S]*support_ticket_attachment_added/, files.migration],
  ["parent read marker", /markParentSupportTicketRead/, files.booking],
  ["parent unread badge", /lab-parent-tab-unread/, files.booking],
  ["parent file validation", /image\/jpeg[\s\S]*8 \* 1024 \* 1024/, files.parentClient],
  ["short-lived parent links", /createSignedUrl\(attachment\.storagePath, 900\)/, files.parentClient],
  ["staff read marker", /markStaffSupportTicketRead/, files.staff],
  ["staff unread badge", /support-ticket-unread-badge/, files.staff],
  ["staff private attachments", /uploadStaffSupportTicketAttachments/, files.staffClient],
  ["short-lived staff links", /createSignedUrl\(attachment\.storagePath, 900\)/, files.staffClient],
];
const failures = checks.filter(([, pattern, source]) => !pattern.test(source)).map(([name]) => name);
console.log(JSON.stringify({ supportTicketPortalReady: failures.length === 0, checks: checks.length, failures }, null, 2));
if (failures.length) process.exit(1);
