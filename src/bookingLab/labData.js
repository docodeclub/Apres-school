import { daysForWraparoundConfig, wraparound2026Configs } from "./wraparound2026.js";

export const labSessions = [
  {
    id: "lab-ripley-after",
    site: "Ripley Court",
    area: "Surrey",
    type: "Wraparound",
    title: "After-school care",
    time: "15:30-18:00",
    price: 25.35,
    age: "Ripley Court pupils",
    capacity: 8,
    days: daysForWraparoundConfig("ripley"),
    academicYear: "2026/27",
    paymentRoute: "PonchoPay card + vouchers",
    sessionBlocks: [
      { label: "Session 1", start: "15:30", end: "16:00", price: 5.4 },
      { label: "Session 2", start: "16:00", end: "16:30", price: 5.4 },
      { label: "Session 3", start: "16:30", end: "17:00", price: 5.4 },
      { label: "Session 4", start: "17:00", end: "18:00", price: 9.15 },
    ],
    blockedLabels: wraparound2026Configs.ripley.blockedLabels,
    features: ["2026/27 term dates", "Four after-school blocks", "No holiday or INSET booking"],
  },
  {
    id: "lab-willington-after",
    site: "Willington Prep",
    area: "Wimbledon",
    type: "Wraparound",
    title: "After-school care",
    time: "15:30-18:00",
    price: 27.8,
    age: "Willington Prep pupils",
    capacity: 8,
    days: daysForWraparoundConfig("willington"),
    academicYear: "2026/27",
    paymentRoute: "PonchoPay card + vouchers",
    sessionBlocks: [
      { label: "Session 1", start: "15:30", end: "16:00", price: 6.8 },
      { label: "Session 2", start: "16:00", end: "17:00", price: 11.3 },
      { label: "Session 3", start: "17:00", end: "18:00", price: 9.7 },
    ],
    blockedLabels: wraparound2026Configs.willington.blockedLabels,
    features: ["2026/27 term dates", "Three after-school blocks", "Bank holidays excluded"],
  },
  {
    id: "lab-kings-after",
    site: "King's House School",
    area: "Richmond",
    type: "Wraparound",
    title: "After-school care",
    time: "15:15-18:00",
    price: 27,
    age: "King's House pupils",
    capacity: 6,
    days: daysForWraparoundConfig("kings"),
    academicYear: "2026/27",
    paymentRoute: "PonchoPay card + vouchers",
    sessionBlocks: [
      { label: "Session 1", start: "15:15", end: "16:00", price: 7 },
      { label: "Session 2", start: "16:00", end: "17:00", price: 11 },
      { label: "Session 3", start: "17:00", end: "18:00", price: 9 },
    ],
    blockedLabels: wraparound2026Configs.kings.blockedLabels,
    features: ["2026/27 term dates", "Last day of term excluded", "Three after-school blocks"],
  },
  {
    id: "lab-shrewsbury-breakfast",
    site: "Shrewsbury House School",
    area: "Surbiton",
    type: "Wraparound",
    title: "Breakfast club",
    time: "07:30-08:00",
    price: 7.4,
    age: "Shrewsbury House pupils",
    capacity: 12,
    days: daysForWraparoundConfig("shrewsbury"),
    academicYear: "2026/27",
    paymentRoute: "PonchoPay card + vouchers",
    sessionBlocks: [
      { label: "Breakfast Club", start: "07:30", end: "08:00", price: 7.4 },
    ],
    blockedLabels: wraparound2026Configs.shrewsbury.blockedLabels,
    features: ["2026/27 term dates", "Fixed 2026/27 breakfast price", "Term time only"],
  },
  {
    id: "lab-shrewsbury-after",
    site: "Shrewsbury House School",
    area: "Surbiton",
    type: "Wraparound",
    title: "After-school care",
    time: "15:15-18:00",
    price: 27.45,
    age: "Shrewsbury House pupils",
    capacity: 12,
    days: daysForWraparoundConfig("shrewsbury"),
    academicYear: "2026/27",
    paymentRoute: "PonchoPay card + vouchers",
    sessionBlocks: [
      { label: "Session 1", start: "15:15", end: "16:00", price: 9.15 },
      { label: "Session 2", start: "16:00", end: "17:10", price: 9.15 },
      { label: "Session 3", start: "17:10", end: "18:00", price: 9.15 },
    ],
    blockedLabels: wraparound2026Configs.shrewsbury.blockedLabels,
    features: ["2026/27 term dates", "Three after-school blocks", "2pm term finishes flagged"],
  },
  {
    id: "lab-rowans-camp",
    site: "The Rowans School",
    area: "Wimbledon",
    type: "Holiday Camp",
    title: "Creative adventure camp",
    time: "08:30-16:30",
    price: 48,
    age: "Open to all primary-age children",
    capacity: 18,
    academicYear: "2026/27",
    days: ["Tue 28 Jul", "Wed 29 Jul", "Thu 30 Jul", "Fri 31 Jul"],
    features: ["Open access", "Creative studio", "Active games"],
  },
  {
    id: "lab-kings-camp",
    site: "King's House School",
    area: "Richmond",
    type: "Holiday Camp",
    title: "Active holiday camp",
    time: "08:30-16:30",
    price: 52,
    age: "Open to all primary-age children",
    capacity: 14,
    academicYear: "2026/27",
    days: ["Tue 28 Jul", "Wed 29 Jul", "Thu 30 Jul", "Fri 31 Jul"],
    features: ["Sports focus", "Sibling discount", "Packed-lunch day"],
  },
];

export const labPaymentOptions = [
  ["card", "Card", "Take payment now with saved receipt and confirmation."],
  ["tax-free", "Tax-Free Childcare", "Add a reference so the payment can be matched automatically."],
  ["voucher", "Childcare voucher", "Reserve the place while the voucher payment is matched."],
];

export const labChildProfiles = [
  { id: "child-ava", name: "Ava", year: "Year 2", school: "Willington Prep", flags: ["Nut allergy"], consent: "Photo consent off" },
  { id: "child-leo", name: "Leo", year: "Reception", school: "Willington Prep", flags: ["Asthma inhaler"], consent: "Photo consent on" },
  { id: "child-sam", name: "Sam", year: "Year 4", school: "King's House School", flags: [], consent: "Photo consent on" },
];

export const defaultFamilyAccounts = [
  {
    id: "family-demo",
    parentName: "Demo Parent",
    email: "demo@example.com",
    phone: "07123 456789",
    emergencyContact: "Jordan Parent",
    collectors: ["Jordan Parent", "Auntie Jo"],
    notificationPreferences: {
      paymentReminders: "Email/SMS",
      invoices: "Email",
      careNotes: "Email",
      bookingChanges: "Email/SMS",
    },
    children: [
      { id: "family-ava", name: "Ava", year: "Year 2", school: "Willington Prep", flags: ["Nut allergy"], medicalPlan: "EpiPen in club bag. Avoid all nut products.", consent: "Photo consent off" },
      { id: "family-leo", name: "Leo", year: "Reception", school: "Willington Prep", flags: ["Asthma inhaler"], medicalPlan: "Blue inhaler in front pocket of backpack.", consent: "Photo consent on" },
    ],
    consentHistory: ["Terms accepted 2026-06-01", "Emergency care consent 2026-06-01", "Data storage consent 2026-06-01"],
  },
];

export const labAddOns = [
  { id: "early", label: "Early drop-off", price: 6, appliesTo: "Holiday Camp" },
  { id: "late", label: "Late pickup", price: 8, appliesTo: "Holiday Camp" },
  { id: "snack", label: "Hot snack", price: 3.5, appliesTo: "All" },
  { id: "enrichment", label: "Premium activity", price: 7, appliesTo: "Holiday Camp" },
];

export const labStaffRoster = [
  { id: "staff-amelia", name: "Amelia Clarke", role: "Site Lead", qualified: true, firstAid: true, safeguarding: true, maxSessions: 5, sites: ["Willington Prep", "The Rowans School"] },
  { id: "staff-ben", name: "Ben Wallace", role: "Playworker", qualified: false, firstAid: true, safeguarding: true, maxSessions: 4, sites: ["Willington Prep", "King's House School"] },
  { id: "staff-cara", name: "Cara Singh", role: "Deputy Lead", qualified: true, firstAid: true, safeguarding: true, maxSessions: 5, sites: ["King's House School", "Shrewsbury House School"] },
  { id: "staff-dan", name: "Dan Hughes", role: "Sports Coach", qualified: false, firstAid: false, safeguarding: true, maxSessions: 4, sites: ["King's House School", "The Rowans School"] },
  { id: "staff-ella", name: "Ella Brooks", role: "SEN Support", qualified: true, firstAid: false, safeguarding: true, maxSessions: 3, sites: ["Willington Prep", "Shrewsbury House School"] },
  { id: "staff-fran", name: "Fran Carter", role: "Bank Staff", qualified: false, firstAid: true, safeguarding: true, maxSessions: 3, sites: ["Willington Prep", "King's House School", "The Rowans School"] },
];

export const defaultLabRules = {
  cancellationHours: 24,
  amendmentHours: 24,
  paymentDueHours: 12,
  siblingDiscountPercent: 10,
  fullWeekDiscountPercent: 5,
  promoCode: "APRES10",
  promoDiscountPercent: 10,
  autoWaitlistAtPercent: 100,
  paymentPlanMinTotal: 25,
  paymentPlanMaxInstallments: 6,
  paymentPlanDepositPercent: 0,
  paymentPlanAllowCard: true,
  paymentPlanAllowTfc: true,
  paymentPlanAllowVoucher: true,
  attendanceGraceMinutes: 10,
  attendanceAutoInvoice: true,
  attendanceInvoiceDueHours: 24,
  allowAdminOverride: true,
  schoolOnlyStrict: true,
  holidayYearMin: "Reception",
  holidayYearMax: "Year 6",
};

export const schoolYears = ["Nursery", "Reception", "Year 1", "Year 2", "Year 3", "Year 4", "Year 5", "Year 6", "Year 7"];
export const overrideReasons = ["Sibling placement", "School request", "SEN / care need", "Staff discretion", "Payment exception"];

export const labDataEntities = [
  ["families", "Parent/carer account, contact details, billing profile and communication preferences.", "children, bookings, messages"],
  ["children", "Child profile, school/year, medical flags, consent status and care plans.", "families, register_entries"],
  ["sites", "School or venue configuration, area, contacts, operating notes and launch status.", "activities, staff_assignments"],
  ["activities", "Bookable provision: wraparound, camp or club with dates, capacity, prices and eligibility.", "sessions, bookings, rules"],
  ["sessions", "Specific date/time instances with live capacity, staffing assumptions and register state.", "activities, register_entries"],
  ["bookings", "Parent purchase/reservation with children, dates, add-ons, discounts and status.", "families, children, payments"],
  ["payments", "Card/TFC/voucher status, references, receipts, reconciliation and refunds.", "bookings, audit_events"],
  ["register_entries", "Child-level attendance, check-in/out, absence, late collection and incident notes.", "sessions, children"],
  ["messages", "Confirmations, reminders, payment nudges and incident follow-ups.", "families, bookings"],
  ["rules", "Cancellation, amendment, eligibility, discount, waitlist and override settings.", "activities, bookings"],
  ["audit_events", "Immutable trail for booking, payment, register, rule and admin actions.", "all operational entities"],
];

export const labIntegrations = [
  ["Stripe or payment provider", "Card checkout, payment intents, refunds and receipts."],
  ["Tax-Free Childcare / vouchers", "Reference capture, manual reconciliation and outstanding balance handling."],
  ["Email/SMS", "Confirmations, payment reminders, incident follow-ups and missing-info nudges."],
  ["Supabase/Postgres", "Auth, RLS, relational data, audit events and private documents."],
  ["CSV/XLSX exports", "Registers, finance reconciliation, occupancy and safeguarding summaries."],
];

export const labRoleAccessMatrix = [
  ["Parent", "families, children, own bookings, own payments, own messages", "Create/amend own bookings, update child records, view receipts and credit."],
  ["Staff", "assigned sessions, child care flags, register entries, incident drafts", "Check children in/out, record absence, add notes and export assigned registers."],
  ["Manager", "sites, activities, all bookings, rules, registers, reports, audit", "Configure provision, override rules, manage waitlists, run reports and review audit."],
  ["Finance", "payments, credit ledger, invoices, voucher/TFC references, settlement exports", "Reconcile payments, process refunds, apply credit and export finance batches."],
];

export const labApiContracts = [
  ["GET", "/api/activities/search", "Parent", "Find bookable wraparound, camp and club sessions by school, area, date and eligibility."],
  ["POST", "/api/bookings/quote", "Parent", "Return capacity, rules trace, discounts, add-ons, credit balance and payable amount before checkout."],
  ["POST", "/api/bookings", "Parent", "Create booking, reserve capacity transactionally and start card or reference payment state."],
  ["PATCH", "/api/bookings/:id/amend", "Parent / Manager", "Apply amendment rules, recalculate price and create payment, refund or credit event."],
  ["POST", "/api/register/:sessionId/events", "Staff", "Record check-in, check-out, absence, incident and collection events with audit metadata."],
  ["POST", "/api/payments/reconcile", "Finance", "Match card webhook, TFC, voucher or invoice reference against outstanding bookings."],
  ["POST", "/api/credits/:id/action", "Finance", "Refund, retain on account or apply credit to a later outstanding balance."],
  ["PATCH", "/api/admin/rules", "Manager", "Publish cancellation, amendment, capacity, discount and eligibility policy changes."],
  ["GET", "/api/reports/operations", "Manager", "Export occupancy, attendance, incidents, revenue and site performance for a date range."],
];

export const labRlsPolicies = [
  ["families", "Parents read/update their own family only; managers can read all; staff see limited child fields for assigned sessions."],
  ["bookings", "Parents see own bookings; staff see assigned session attendance fields; finance sees payment fields; managers see all."],
  ["payments", "Parents see own payment state; finance and managers can update reconciliation, refund and credit fields."],
  ["register_entries", "Staff update entries only for assigned sessions; managers can correct entries with reason; parents see status summaries only."],
  ["rules", "Published rules are readable to booking flows; draft and write access is manager-only."],
  ["audit_events", "Append-only through service functions; managers can read operational audit, finance can read payment audit."],
];

export const readinessItems = [
  ["Prototype only", "LocalStorage data, simulated payments, simulated messages and generated reports.", "Replace with authenticated backend services before any live parent use."],
  ["Backend", "Families, children, bookings, sessions, registers, payments, messages, rules and audit tables.", "Build relational schema, migrations, RLS and service-role functions."],
  ["Payments", "Card, Tax-Free Childcare and voucher flows are modelled but not connected.", "Integrate card provider, webhook reconciliation, refunds and manual voucher workflows."],
  ["Safeguarding", "Medical notes and register incidents are visible in the lab.", "Add access control, immutable audit, retention policy and export controls."],
  ["Operations", "Activity builder, setup wizard and reports are local.", "Add admin roles, approval workflow, activity publishing and notification logs."],
];

export const readinessRisks = [
  ["High", "Payment reconciliation", "Voucher/TFC workflows need careful manual and automated matching."],
  ["High", "Child data protection", "Medical notes, collectors and incident logs need strict access control and retention."],
  ["Medium", "Capacity accuracy", "Concurrent bookings need transactional capacity locking and waitlist conversion."],
  ["Medium", "Parent support load", "Amend/cancel rules need clear copy, receipts and admin override tooling."],
  ["Medium", "School-specific rules", "Eligibility, year groups and site exceptions must be configurable per activity."],
];

export const readinessPhases = [
  ["1", "Backend foundation", "Schema, RLS, auth roles, audit events and seed migration from lab concepts."],
  ["2", "Parent booking MVP", "Family accounts, child profiles, booking, payment state and confirmations."],
  ["3", "Operations MVP", "Registers, attendance actions, incident notes, finance queue and exports."],
  ["4", "Payments and comms", "Payment provider, voucher/TFC reconciliation, email/SMS and receipt workflows."],
  ["5", "Pilot launch", "One site, internal QA, parent pilot, support scripts and rollback plan."],
];
