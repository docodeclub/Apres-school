import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const registerFoundation = readFileSync(join(root, "supabase/migrations/0062_server_backed_staff_register.sql"), "utf8");
const registerDetails = readFileSync(join(root, "supabase/migrations/0072_staff_register_operational_details.sql"), "utf8");
const adHocBookings = readFileSync(join(root, "supabase/migrations/0074_staff_adhoc_bookings.sql"), "utf8");
const adHocFinance = readFileSync(join(root, "supabase/migrations/0075_staff_adhoc_account_finance.sql"), "utf8");
const pupilReports = readFileSync(join(root, "supabase/migrations/0083_register_pupil_reports.sql"), "utf8");
const reportReviewQueue = readFileSync(join(root, "supabase/migrations/0084_register_report_review_queue.sql"), "utf8");
const guidedIncidentWorkflow = readFileSync(join(root, "supabase/migrations/0089_guided_incident_workflow.sql"), "utf8");
const firstAidProviderRequirement = readFileSync(join(root, "supabase/migrations/0091_require_first_aid_provider.sql"), "utf8");
const migration = `${registerFoundation}\n${registerDetails}\n${adHocBookings}\n${adHocFinance}\n${pupilReports}\n${reportReviewQueue}\n${guidedIncidentWorkflow}\n${firstAidProviderRequirement}`;
const service = readFileSync(join(root, "src/bookingSystem.js"), "utf8");
const interfaceSource = readFileSync(join(root, "src/BookingLab.jsx"), "utf8");
const platformSource = readFileSync(join(root, "src/PlatformModule.jsx"), "utf8");
const adHocFunction = readFileSync(join(root, "supabase/functions/create-staff-adhoc-booking/index.ts"), "utf8");
const parentBookingFunction = readFileSync(join(root, "supabase/functions/create-parent-booking/index.ts"), "utf8");
const registerParentNotification = readFileSync(join(root, "supabase/functions/notify-register-parent/index.ts"), "utf8");
const failures = [];

const checks = [
  ["one attendance row per booking item", /booking_item_id uuid primary key references public\.booking_items/],
  ["register is restricted to confirmed booking items", /item\.status in \('confirmed', 'attended'\)/],
  ["register is restricted to confirmed bookings", /booking\.status = 'confirmed'/],
  ["register uses the requested local date", /at time zone 'Europe\/London'\)::date = p_register_date/],
  ["cancelled and waitlist items cannot be updated", /Only confirmed booking items can be updated on the register/],
  ["staff register RPC requires an active staff role", /role in \('staff', 'manager', 'admin', 'superadmin'\)/],
  ["client fetches the authoritative register RPC", /supabase\.rpc\("staff_register_for_day"/],
  ["client fetches configured register timetable options", /export async function fetchStaffRegisterTimetable[\s\S]*\.from\("sessions"\)/],
  ["client persists attendance through the register RPC", /supabase\.rpc\("update_staff_register_entry"/],
  ["staff UI prefers server register rows", /useServerRegister \? liveRegisterRows : localRegisterRows/],
  ["staff UI fails closed when the server register is unavailable", /Local drafts are deliberately not shown as live attendance/],
  ["register returns emergency contact details", /emergency_contact jsonb/],
  ["register returns child year group", /child_year_group text/],
  ["staff UI bulk register actions persist through the server RPC", /Promise\.allSettled\(targetRows\.map\(\(row\) => updateStaffRegisterEntry\(\{/],
  ["compact register opens pupil details from the child name", /className="register-child-button"[\s\S]*setSelectedChildId\(row\.bookingItemId\)/],
  ["compact register shows SEND only when recorded", /hasSend && <span className="register-need-icon send"/],
  ["compact register shows medical only when recorded", /hasMedical && <span className="register-need-icon medical"/],
  ["pupil drawer contains care, SEND and emergency details", /className="register-child-drawer"[\s\S]*Medical and care information[\s\S]*<h3>SEND<\/h3>[\s\S]*Emergency contact/],
  ["register selectors combine timetable options with confirmed rows", /const registerOptions = \[\.\.\.timetable, \.\.\.rows\]/],
  ["register renders every available session as a section", /const sessionSections = visibleSessionLabels\.map[\s\S]*className="register-session-section"/],
  ["register provides quick session filter buttons", /className="register-session-filters"[\s\S]*setSession\(item\)/],
  ["ad-hoc pupil search is server-backed and role protected", /staff_adhoc_booking_options[\s\S]*role in \('staff', 'manager', 'admin', 'superadmin'\)/],
  ["ad-hoc sessions use the exact local register date", /staff_adhoc_booking_options[\s\S]*at time zone 'Europe\/London'\)::date = p_register_date/],
  ["ad-hoc booking explicitly prevents duplicate child sessions", /create_staff_adhoc_booking[\s\S]*is already booked into/],
  ["ad-hoc booking checks capacity before insertion", /create_staff_adhoc_booking[\s\S]*is full\./],
  ["non-booking fee is optional and fixed at £2.50", /p_apply_non_booking_fee[\s\S]*then 2\.50 else 0/],
  ["ad-hoc booking creates a parent invoice", /insert into public\.booking_invoices[\s\S]*'Outstanding'/],
  ["client invokes the protected ad-hoc booking service", /export async function createStaffAdHocBooking[\s\S]*supabase\.functions\.invoke\("create-staff-adhoc-booking"/],
  ["ad-hoc booking charges the family credit ledger", /finalise_staff_adhoc_account_charge[\s\S]*creditBalanceAfter/],
  ["outstanding family finance blocks new parent bookings", /parent_booking_finance_gate[\s\S]*OUTSTANDING_ACCOUNT_BALANCE/],
  ["ad-hoc account debit sends a parent notification", /staff_adhoc_account_debit/],
  ["register exposes the ad-hoc booking action", /onClick=\{openAdHocBooking\}>Ad-hoc booking/],
  ["register disables sessions already booked for that pupil", /childAlreadyBookedInSession\(adHocChildId, option\.id\)/],
  ["register shows the optional non-booking fee control", /Add £2\.50 non-booking fee/],
  ["register report queue is restricted to administrators", /list_register_pupil_reports[\s\S]*v_role not in \('admin', 'superadmin'\)/],
  ["restricted safeguarding reports require superadmin access", /sensitivity = 'standard'[\s\S]*v_role = 'superadmin'/],
  ["report review updates are written to the audit log", /Register pupil report reviewed/],
  ["admin UI fetches the secure report queue", /fetchRegisterPupilReports\(\{ limit: 500 \}\)/],
  ["admin UI saves report review status and follow-up", /updateRegisterPupilReport\(\{[\s\S]*followUpNote/],
  ["first aid reports require a named provider", /require_first_aid_provider[\s\S]*firstAidProvider/],
  ["staff form captures the named first aider", /Who performed first aid\?[\s\S]*firstAidProvider/],
  ["parent first aid email places what happened above date and time", /label: "What happened:"[\s\S]*label: "Date and time"/],
];

checks.forEach(([label, pattern]) => {
  const source = label.startsWith("client")
    ? service
    : label === "ad-hoc account debit sends a parent notification"
      ? adHocFunction
      : label === "outstanding family finance blocks new parent bookings"
      ? `${migration}\n${parentBookingFunction}`
    : label.startsWith("parent first aid email")
      ? registerParentNotification
    : label.startsWith("compact register") || label.startsWith("pupil drawer") || label.startsWith("register selectors") || label.startsWith("register renders") || label.startsWith("register provides") || label.startsWith("register exposes") || label.startsWith("register disables") || label.startsWith("register shows") || label.startsWith("admin UI") || label.startsWith("staff form")
      ? platformSource
      : label.startsWith("staff UI")
        ? interfaceSource
        : migration;
  if (!pattern.test(source)) failures.push(label);
});

const result = {
  registerContractReady: failures.length === 0,
  checks: checks.length,
  failures,
};

console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
