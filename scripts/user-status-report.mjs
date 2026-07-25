import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = readEnv(".env.staging");
const supabaseUrl = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.APRES_SERVICE_ROLE_KEY || env.APRES_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Supabase URL and service role key are required.");
}

const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [parents, bookings, invoices, bookingItems, emailLogs, users] = await Promise.all([
  readAll(
    "parent_accounts",
    "id,profile_id,full_name,email,portal_status,external_source,external_id,migration_metadata,created_at,updated_at",
  ),
  readAll(
    "bookings",
    "id,parent_account_id,parent_email,parent_name,status,source,booking_reference,invoice_id,total_amount,metadata,created_at,updated_at",
  ),
  readAll(
    "booking_invoices",
    "id,booking_id,parent_email,total_amount,paid_amount,balance,payment_status,finance_status,parent_portal_status,metadata,created_at,updated_at",
  ),
  readAll(
    "booking_items",
    "id,booking_id,child_id,child_name,site_name,programme_name,session_label,starts_at,status,metadata,created_at,updated_at",
  ),
  readAll("email_logs", "recipient_email,status,email_type,created_at"),
  readAllAuthUsers(),
]);

const importedParents = parents.filter((parent) => parent.external_source === "magicbooking");
const importedParentIds = new Set(importedParents.map((parent) => parent.id));
const parentById = new Map(parents.map((parent) => [parent.id, parent]));
const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
const authUserByEmail = new Map(
  users.map((user) => [normalizeEmail(user.email), user]),
);
const importedBookings = bookings.filter((booking) =>
  importedParentIds.has(booking.parent_account_id)
);
const genuineImportedBookings = importedBookings.filter((booking) => {
  const parent = parentById.get(booking.parent_account_id);
  return isGenuineParentEmail(booking.parent_email || parent?.email);
});
const genuineActiveBookings = genuineImportedBookings.filter((booking) =>
  !["draft", "cancelled", "waitlist"].includes(booking.status)
);
const genuineConfirmedBookings = genuineImportedBookings.filter((booking) =>
  ["confirmed", "payment_plan_active"].includes(booking.status)
);
const genuinePendingBookings = genuineImportedBookings.filter((booking) =>
  ["reserved", "payment_pending"].includes(booking.status)
);
const invitedImportedParents = importedParents.filter((parent) =>
  parent.profile_id || ["invited", "active"].includes(parent.portal_status)
);
const signedInImportedParents = invitedImportedParents.filter((parent) =>
  Boolean(authUserByEmail.get(normalizeEmail(parent.email))?.last_sign_in_at)
);
const genuineSignedInParents = signedInImportedParents.filter((parent) =>
  isGenuineParentEmail(parent.email)
);
const inviteEmailRecipients = new Set(
  emailLogs
    .filter((log) =>
      log.email_type === "parent_migration_invite" && log.status === "sent"
    )
    .map((log) => normalizeEmail(log.recipient_email)),
);

const report = {
  asOf: new Date().toISOString(),
  invitedFamilies: invitedImportedParents.length,
  invitationEmailsSent: inviteEmailRecipients.size,
  familiesSignedIn: genuineSignedInParents.length,
  familiesWithActiveBookings: new Set(
    genuineActiveBookings.map((booking) => booking.parent_account_id),
  ).size,
  activeBookings: genuineActiveBookings.length,
  confirmedBookings: genuineConfirmedBookings.length,
  pendingBookings: genuinePendingBookings.length,
  bookingStatuses: countBy(genuineImportedBookings, "status"),
  bookingSources: countBy(genuineImportedBookings, "source"),
  bookings: genuineActiveBookings.map((booking) => {
    const parent = parentById.get(booking.parent_account_id);
    const invoice = invoiceById.get(booking.invoice_id);
    return {
      createdAt: booking.created_at,
      parent: parent?.full_name || booking.parent_name || "Parent",
      status: booking.status,
      source: booking.source,
      reference: booking.booking_reference,
      total: Number(booking.total_amount || 0),
      paymentStatus: invoice?.payment_status || "",
      paid: Number(invoice?.paid_amount || 0),
      balance: Number(invoice?.balance || 0),
      items: bookingItems
        .filter((item) => item.booking_id === booking.id)
        .map((item) => ({
          child: item.child_name,
          date: item.starts_at,
          session: item.session_label,
          status: item.status,
        })),
    };
  }),
};

console.log(JSON.stringify(report, null, 2));

async function readAll(table, select) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await service
      .from(table)
      .select(select)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if ((data || []).length < pageSize) break;
  }
  return rows;
}

async function readAllAuthUsers() {
  const users = [];
  const pageSize = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage: pageSize,
    });
    if (error) throw error;
    users.push(...(data.users || []));
    if ((data.users || []).length < pageSize) break;
  }
  return users;
}

function countBy(rows, key) {
  return Object.fromEntries(
    [...rows.reduce((counts, row) => {
      const value = String(row[key] || "unknown");
      counts.set(value, (counts.get(value) || 0) + 1);
      return counts;
    }, new Map())],
  );
}

function isGenuineParentEmail(input) {
  return !/(^|[.@_+-])(test|demo|lukecurrie|luke)([.@_+-]|$)|@magicbooking\.co\.uk|@apres-school\.test/i
    .test(String(input || ""));
}

function normalizeEmail(input) {
  return String(input || "").trim().toLowerCase();
}

function readEnv(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.trim().startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        let value = line.slice(index + 1).trim();
        if (
          (value.startsWith("\"") && value.endsWith("\""))
          || (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return [key, value];
      }),
  );
}
