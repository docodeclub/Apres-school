import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const registerFoundation = readFileSync(join(root, "supabase/migrations/0062_server_backed_staff_register.sql"), "utf8");
const registerDetails = readFileSync(join(root, "supabase/migrations/0072_staff_register_operational_details.sql"), "utf8");
const adHocBookings = readFileSync(join(root, "supabase/migrations/0074_staff_adhoc_bookings.sql"), "utf8");
const adHocFinance = readFileSync(join(root, "supabase/migrations/0075_staff_adhoc_account_finance.sql"), "utf8");
const adHocPricing = readFileSync(join(root, "supabase/migrations/0106_staff_adhoc_pricing_quote.sql"), "utf8");
const adHocSchoolSafety = readFileSync(join(root, "supabase/migrations/0111_adhoc_pupil_school_safety.sql"), "utf8");
const pupilReports = readFileSync(join(root, "supabase/migrations/0083_register_pupil_reports.sql"), "utf8");
const reportReviewQueue = readFileSync(join(root, "supabase/migrations/0084_register_report_review_queue.sql"), "utf8");
const guidedIncidentWorkflow = readFileSync(join(root, "supabase/migrations/0089_guided_incident_workflow.sql"), "utf8");
const firstAidProviderRequirement = readFileSync(join(root, "supabase/migrations/0091_require_first_aid_provider.sql"), "utf8");
const registerPreferences = readFileSync(join(root, "supabase/migrations/0150_register_care_type_and_default_site.sql"), "utf8");
const registerFullNames = readFileSync(join(root, "supabase/migrations/0151_register_full_child_names.sql"), "utf8");
const registerDayReset = readFileSync(join(root, "supabase/migrations/0152_reset_daily_register_attendance.sql"), "utf8");
const registerDayResetRepair = readFileSync(join(root, "supabase/migrations/0153_fix_register_reset_audit_snapshot.sql"), "utf8");
const registerRecheckin = readFileSync(join(root, "supabase/migrations/0168_refresh_register_timestamps_on_recheckin.sql"), "utf8");
const migration = `${registerFoundation}\n${registerDetails}\n${adHocBookings}\n${adHocFinance}\n${adHocPricing}\n${adHocSchoolSafety}\n${pupilReports}\n${reportReviewQueue}\n${guidedIncidentWorkflow}\n${firstAidProviderRequirement}\n${registerPreferences}\n${registerFullNames}\n${registerDayReset}\n${registerDayResetRepair}\n${registerRecheckin}`;
const service = readFileSync(join(root, "src/bookingSystem.js"), "utf8");
const interfaceSource = readFileSync(join(root, "src/BookingLab.jsx"), "utf8");
const platformSource = readFileSync(join(root, "src/PlatformModule.jsx"), "utf8");
const stylesSource = readFileSync(join(root, "src/styles.css"), "utf8");
const appSource = readFileSync(join(root, "src/app.jsx"), "utf8");
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
  ["checking in again refreshes the action time and clears stale checkout time", /update_staff_register_entry[\s\S]*excluded\.attendance_status = 'checked_in' then now\(\)[\s\S]*excluded\.attendance_status = 'checked_in' then null/],
  ["client resets one daily register through the secure RPC", /resetStaffRegisterDay[\s\S]*reset_staff_register_day[\s\S]*p_register_date[\s\S]*p_site_name/],
  ["staff UI prefers server register rows", /useServerRegister \? liveRegisterRows : localRegisterRows/],
  ["staff UI fails closed when the server register is unavailable", /Local drafts are deliberately not shown as live attendance/],
  ["register returns emergency contact details", /emergency_contact jsonb/],
  ["register returns child year group", /child_year_group text/],
  ["staff UI bulk register actions persist through the server RPC", /Promise\.allSettled\(targetRows\.map\(\(row\) => updateStaffRegisterEntry\(\{/],
  ["compact register opens pupil details from the child name", /className="register-child-button"[\s\S]*setSelectedChildId\(row\.bookingItemId\)/],
  ["compact register removes repeated session details from child rows", /<thead><tr><th>Child<\/th><th>Needs<\/th><th>Status<\/th><th>Actions<\/th><\/tr><\/thead>/],
  ["compact register shows SEND only when recorded", /hasSend && <span className="register-need-icon send"/],
  ["compact register shows medical only when recorded", /hasMedical && <span className="register-need-icon medical"/],
  ["pupil drawer contains care, SEND and emergency details", /className=\{`register-child-drawer[\s\S]*Medical and care information[\s\S]*<h3>SEND<\/h3>[\s\S]*Emergency contact/],
  ["register selectors combine timetable options with confirmed rows", /const registerOptions = \[\.\.\.timetable, \.\.\.rows\]/],
  ["register defaults to wraparound care without holiday add-ons", /const \[careType, setCareType\] = useState\("wraparound"\)[\s\S]*registerCareType\(row\) === careType/],
  ["register allows holiday care to be deliberately selected", /<option value="holiday">Holiday Camp<\/option>/],
  ["staff can save an account-level default register site", /set_my_default_register_site[\s\S]*default_register_site/],
  ["registers identify children by full name before preferred name", /coalesce\(nullif\(trim\(child\.full_name\), ''\), nullif\(trim\(item\.child_name\), ''\), nullif\(trim\(child\.preferred_name\), ''\), 'Child'\)/],
  ["register day reset is restricted to one school and date", /reset_staff_register_day[\s\S]*Choose one school before resetting attendance[\s\S]*item\.site_name = v_site_name[\s\S]*p_register_date/],
  ["register day reset preserves a complete audit snapshot", /Register day attendance reset[\s\S]*previousEntries[\s\S]*v_previous_entries/],
  ["register reset UI shows a clear destructive-action warning", /Reset day[\s\S]*all attendance for this school and date will be reset[\s\S]*Yes, reset this day/],
  ["register applies the saved account default site", /accountDefaultSite[\s\S]*setSchool\(nextDefault\)/],
  ["register renders every available session as a section", /const sessionSections = visibleSessionLabels\.map[\s\S]*className="register-session-section"/],
  ["register orders expected, present, absent and checked-out children", /function compareRegisterAttendance[\s\S]*booked: 0[\s\S]*checked_in: 1[\s\S]*absent: 2[\s\S]*checked_out: 3[\s\S]*\.sort\(compareRegisterAttendance\)/],
  ["checked-out register rows are faded but can be checked in again", /status-checked_out[\s\S]*register-row-actions button:first-child/],
  ["register provides quick session filter buttons", /className="register-session-filters"[\s\S]*setSession\(item\)/],
  ["ad-hoc pupil search is server-backed and role protected", /staff_adhoc_booking_options[\s\S]*role in \('staff', 'manager', 'admin', 'superadmin'\)/],
  ["ad-hoc sessions use the exact local register date", /staff_adhoc_booking_options[\s\S]*at time zone 'Europe\/London'\)::date = p_register_date/],
  ["ad-hoc booking explicitly prevents duplicate child sessions", /create_staff_adhoc_booking[\s\S]*is already booked into/],
  ["ad-hoc booking checks capacity before insertion", /create_staff_adhoc_booking[\s\S]*is full\./],
  ["ad-hoc pupil results use the child's full name", /coalesce\(nullif\(trim\(child\.full_name\), ''\), nullif\(trim\(child\.preferred_name\), ''\)/],
  ["ad-hoc options match pupils and sessions to the selected school", /adhoc_school_key\(child\.school_name\) = public\.adhoc_school_key\(p_site_name\)[\s\S]*adhoc_school_key\(location\.name\) = public\.adhoc_school_key\(p_site_name\)/],
  ["ad-hoc booking rejects cross-school sessions on the server", /School mismatch:[\s\S]*Choose a session at that school/],
  ["non-booking fee is optional and fixed at £2.50", /p_apply_non_booking_fee[\s\S]*then 2\.50 else 0/],
  ["ad-hoc booking creates a parent invoice", /insert into public\.booking_invoices[\s\S]*'Outstanding'/],
  ["client invokes the protected ad-hoc booking service", /export async function createStaffAdHocBooking[\s\S]*supabase\.functions\.invoke\("create-staff-adhoc-booking"/],
  ["ad-hoc booking charges the family credit ledger", /finalise_staff_adhoc_account_charge[\s\S]*creditBalanceAfter/],
  ["ad-hoc quote applies the selected family's pricing group", /quote_staff_adhoc_pricing[\s\S]*calculate_parent_price/],
  ["outstanding family finance blocks new parent bookings", /parent_booking_finance_gate[\s\S]*OUTSTANDING_ACCOUNT_BALANCE/],
  ["ad-hoc account debit sends a parent notification", /staff_adhoc_account_debit/],
  ["register exposes the ad-hoc booking action", /onClick=\{openAdHocBooking\}>Ad-hoc booking/],
  ["register disables sessions already booked for that pupil", /childAlreadyBookedInSession\(adHocChildId, option\.id\)/],
  ["register highlights the pupil school before session selection", /register-adhoc-selected-child[\s\S]*Only sessions at this school can be added/],
  ["register only offers sessions matching the selected pupil school", /const matchingAdHocSessions = selectedAdHocChild[\s\S]*matchingAdHocSessions\.map/],
  ["register shows the optional non-booking fee control", /Add £2\.50 non-booking fee/],
  ["register previews pricing group savings before confirmation", /Family pricing[\s\S]*Pricing benefit[\s\S]*Family charge/],
  ["register report queue is restricted to administrators", /list_register_pupil_reports[\s\S]*v_role not in \('admin', 'superadmin'\)/],
  ["restricted safeguarding reports require superadmin access", /sensitivity = 'standard'[\s\S]*v_role = 'superadmin'/],
  ["report review updates are written to the audit log", /Register pupil report reviewed/],
  ["admin UI fetches the secure report queue", /fetchRegisterPupilReports\(\{ limit: 500 \}\)/],
  ["admin UI saves report review status and follow-up", /updateRegisterPupilReport\(\{[\s\S]*followUpNote/],
  ["first aid reports require a named provider", /require_first_aid_provider[\s\S]*firstAidProvider/],
  ["staff form captures the named first aider", /Who performed first aid\?[\s\S]*firstAidProvider/],
  ["parent first aid email places what happened above date and time", /label: "What happened:"[\s\S]*label: "Date and time"/],
  ["staff dashboard provides a prominent registers shortcut", /className="staff-register-shortcut"[\s\S]*onClick=\{onOpenRegisters\}[\s\S]*Open Registers/],
  ["admin dashboard provides the same prominent registers shortcut", /className="staff-register-shortcut admin-register-shortcut"[\s\S]*onOpenTab\("Registers"\)[\s\S]*Open Registers/],
  ["every staff role receives a pinned dashboard link", /const pinnedDashboardTab = [^;]*\["Admin", "Superadmin"\]\.includes\(effectiveRole\) \? "Admin" : "Staff"[\s\S]*<span>Dashboard<\/span>/],
  ["authenticated sessions land on the role dashboard", /applySession\(data\.session, \{ landOnDashboard: true \}\)[\s\S]*landOnDashboard[\s\S]*\? "Admin" : "Staff"/],
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
    : label.startsWith("authenticated sessions")
      ? appSource
    : label.startsWith("checked-out register")
      ? stylesSource
    : label.startsWith("compact register") || label.startsWith("pupil drawer") || label.startsWith("register selectors") || label.startsWith("register defaults") || label.startsWith("register allows") || label.startsWith("register applies") || label.startsWith("register renders") || label.startsWith("register orders") || label.startsWith("register provides") || label.startsWith("register exposes") || label.startsWith("register disables") || label.startsWith("register shows") || label.startsWith("register previews") || label.startsWith("register highlights") || label.startsWith("register only offers") || label.startsWith("register reset UI") || label.startsWith("admin UI") || label.startsWith("staff form") || label.startsWith("staff dashboard") || label.startsWith("admin dashboard") || label.startsWith("every staff role")
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
