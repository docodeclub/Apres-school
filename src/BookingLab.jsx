import { useState } from "react";
import {
  defaultFamilyAccounts,
  defaultLabRules,
  labAddOns,
  labApiContracts,
  labChildProfiles,
  labDataEntities,
  labIntegrations,
  labPaymentOptions,
  labRlsPolicies,
  labRoleAccessMatrix,
  labSessions,
  labStaffRoster,
  overrideReasons,
  readinessItems,
  readinessPhases,
  readinessRisks,
  schoolYears,
} from "./bookingLab/labData.js";
import {
  addAuditLog,
  csvEscape,
  downloadTextFile,
  money,
  readJson,
  schoolYearIndex,
} from "./bookingLab/labUtils.js";
import DataModelLab from "./bookingLab/DataModelLab.jsx";
import ReadinessLab from "./bookingLab/ReadinessLab.jsx";

const defaultMessageTemplates = [
  {
    id: "template-confirmation",
    name: "Confirmation",
    channel: "Email",
    trigger: "Booking confirmed",
    subject: "Your {activity} booking is confirmed",
    body: "Hi {parent}, your {activity} booking at {site} is confirmed for {days}. Total: {total}.",
  },
  {
    id: "template-payment",
    name: "Payment reminder",
    channel: "Email/SMS",
    trigger: "Payment pending",
    subject: "Payment needed for {activity}",
    body: "Hi {parent}, your place is reserved for {activity}. Please complete payment or send your voucher/TFC reference within {deadline} hours.",
  },
  {
    id: "template-waitlist",
    name: "Waitlist offer",
    channel: "Email",
    trigger: "Space opens",
    subject: "A space is available for {activity}",
    body: "Hi {parent}, a space may be available for {activity} at {site}. Please confirm quickly so we can move you from the waitlist.",
  },
  {
    id: "template-incident",
    name: "Incident follow-up",
    channel: "Email",
    trigger: "Staff incident note",
    subject: "Care note for {children}",
    body: "Hi {parent}, we have added a care note for {children}. A member of the team can talk this through at collection.",
  },
  {
    id: "template-launch",
    name: "Launch announcement",
    channel: "Email",
    trigger: "New site launch",
    subject: "{site} booking is open",
    body: "Hi {parent}, bookings are now open for {activity} at {site}. You can choose the days you need and manage details in your parent account.",
  },
];

export default function BookingLab({ setPage }) {
  const [labView, setLabView] = useState("Parent");
  const [customSessions, setCustomSessions] = useState(() => readJson("apres-booking-lab-activities", []));
  const [launchPlans, setLaunchPlans] = useState(() => readJson("apres-booking-lab-launch-plans", []));
  const [rules, setRules] = useState(() => ({ ...defaultLabRules, ...readJson("apres-booking-lab-rules", {}) }));
  const [families, setFamilies] = useState(() => {
    const saved = readJson("apres-booking-lab-families", null);
    return Array.isArray(saved) && saved.length ? saved : defaultFamilyAccounts;
  });
  const [activeFamilyId, setActiveFamilyId] = useState("family-demo");
  const [careType, setCareType] = useState("All");
  const [area, setArea] = useState("All");
  const [query, setQuery] = useState("");
  const [supportQuery, setSupportQuery] = useState("");
  const [activeSupportId, setActiveSupportId] = useState("");
  const [staffingSessionId, setStaffingSessionId] = useState(labSessions[0].id);
  const [capacitySessionId, setCapacitySessionId] = useState(labSessions[0].id);
  const [activeTemplateId, setActiveTemplateId] = useState(defaultMessageTemplates[0].id);
  const [activeId, setActiveId] = useState(labSessions[0].id);
  const [pilotSessionId, setPilotSessionId] = useState(labSessions[0].id);
  const [selectedDays, setSelectedDays] = useState(() => ({ [labSessions[0].id]: [labSessions[0].days[0]] }));
  const [selectedChildIds, setSelectedChildIds] = useState([labChildProfiles[0].id]);
  const [guestChildren, setGuestChildren] = useState([]);
  const [guestName, setGuestName] = useState("");
  const [bookingMode, setBookingMode] = useState("Ad-hoc");
  const [selectedAddOns, setSelectedAddOns] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState("card");
  const [activePaymentId, setActivePaymentId] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [adminOverride, setAdminOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState(overrideReasons[0]);
  const [checkoutStep, setCheckoutStep] = useState("Children");
  const [amendment, setAmendment] = useState(null);
  const [ruleTest, setRuleTest] = useState({
    careType: "Wraparound",
    site: "Willington Prep",
    childYear: "Year 2",
    childSchool: "Willington Prep",
    childCount: 1,
    days: 1,
    capacity: 8,
    alreadyBooked: 5,
    price: 17.5,
    paymentMethod: "card",
    promo: "",
    override: false,
  });
  const [ruleScenarios, setRuleScenarios] = useState(() => readJson("apres-booking-lab-rule-scenarios", []));
  const [confirmation, setConfirmation] = useState(null);
  const [drafts, setDrafts] = useState(() => readJson("apres-booking-lab-drafts", []));
  const [supportTickets, setSupportTickets] = useState(() => readJson("apres-booking-lab-support-tickets", []));
  const [supportNotes, setSupportNotes] = useState(() => readJson("apres-booking-lab-support-notes", []));
  const [staffAssignments, setStaffAssignments] = useState(() => readJson("apres-booking-lab-staff-assignments", []));
  const [capacityOverrides, setCapacityOverrides] = useState(() => readJson("apres-booking-lab-capacity-overrides", {}));
  const [messageTemplates, setMessageTemplates] = useState(() => {
    const saved = readJson("apres-booking-lab-message-templates", null);
    return Array.isArray(saved) && saved.length ? saved : defaultMessageTemplates;
  });
  const [registerEvents, setRegisterEvents] = useState(() => readJson("apres-booking-lab-register", {}));
  const [messageLog, setMessageLog] = useState(() => readJson("apres-booking-lab-messages", []));
  const [incidentDrafts, setIncidentDrafts] = useState({});
  const [registerMode, setRegisterMode] = useState("Cards");
  const [creditFilter, setCreditFilter] = useState("Open");
  const [activeRole, setActiveRole] = useState("Parent");
  const [status, setStatus] = useState("");
  const sessions = [...labSessions, ...customSessions];
  const activeFamily = families.find((family) => family.id === activeFamilyId) || families[0] || defaultFamilyAccounts[0];
  const familyChildProfiles = activeFamily.children?.map((child) => ({ ...child, school: child.school || "Guest" })) || [];
  const allChildProfiles = [
    ...familyChildProfiles,
    ...labChildProfiles.filter((child) => !familyChildProfiles.some((familyChild) => familyChild.name === child.name)),
  ];
  const activeSession = sessions.find((session) => session.id === activeId) || sessions[0] || labSessions[0];
  const pilotSession = sessions.find((session) => session.id === pilotSessionId) || activeSession;
  const staffingSession = sessions.find((session) => session.id === staffingSessionId) || activeSession;
  const capacitySession = sessions.find((session) => session.id === capacitySessionId) || activeSession;
  const pickedDays = selectedDays[activeSession.id] || [];
  const [registerDay, setRegisterDay] = useState(activeSession.days[0]);
  const selectedChildren = [
    ...allChildProfiles.filter((child) => selectedChildIds.includes(child.id)),
    ...guestChildren,
  ];
  const childCount = Math.max(1, selectedChildren.length);
  const availableAddOns = labAddOns.filter((item) => item.appliesTo === "All" || item.appliesTo === activeSession.type);
  const addOnTotal = pickedDays.length * childCount * availableAddOns
    .filter((item) => selectedAddOns.includes(item.id))
    .reduce((sum, item) => sum + item.price, 0);
  const bookedSpaces = drafts
    .filter((draft) => draft.sessionId === activeSession.id)
    .reduce((sum, draft) => sum + (draft.days || []).filter((day) => pickedDays.includes(day)).length * Number(draft.childCount || 1), 0);
  const remainingSpaces = Math.max(0, activeSession.capacity - bookedSpaces);
  const capacityPercentAfterBooking = activeSession.capacity ? ((bookedSpaces + childCount) / activeSession.capacity) * 100 : 0;
  const isWaitlist = pickedDays.length ? childCount > remainingSpaces || capacityPercentAfterBooking > Number(rules.autoWaitlistAtPercent || 100) : false;
  const filteredSessions = sessions.filter((session) => {
    const haystack = `${session.site} ${session.area} ${session.type} ${session.title}`.toLowerCase();
    return (careType === "All" || session.type === careType)
      && (area === "All" || session.area === area)
      && haystack.includes(query.toLowerCase());
  });
  const subtotal = pickedDays.length * activeSession.price * childCount;
  const siblingDiscount = childCount > 1 ? subtotal * (Number(rules.siblingDiscountPercent || 0) / 100) : 0;
  const weeklyDiscount = pickedDays.length >= 4 ? subtotal * (Number(rules.fullWeekDiscountPercent || 0) / 100) : 0;
  const promoDiscount = promoCode.trim().toUpperCase() === String(rules.promoCode || "").toUpperCase() ? (subtotal + addOnTotal) * (Number(rules.promoDiscountPercent || 0) / 100) : 0;
  const total = Math.max(0, subtotal + addOnTotal - siblingDiscount - weeklyDiscount - promoDiscount);
  const opsRevenue = drafts.reduce((sum, draft) => sum + Number(draft.total || 0), 0);
  const opsChildren = drafts.reduce((sum, draft) => sum + Number(draft.childCount || 0), 0);
  const opsPaymentDue = drafts.filter((draft) => draft.status !== "Prototype paid").length;
  const opsConfirmed = drafts.filter((draft) => ["Prototype paid", "Payment reference pending"].includes(draft.status)).length;
  const openIncidents = Object.values(registerEvents).filter((event) => event.status === "Incident").length;
  const occupancyRows = sessions.map((session) => {
    const bookings = drafts.filter((draft) => draft.sessionId === session.id && draft.status !== "Cancelled");
    const booked = bookings.reduce((sum, draft) => sum + Number(draft.childCount || 0) * (draft.days?.length || 0), 0);
    const capacity = session.capacity * session.days.length;
    const waitlist = bookings.filter((draft) => draft.status === "Waitlist").reduce((sum, draft) => sum + Number(draft.childCount || 0), 0);
    const revenue = bookings.reduce((sum, draft) => sum + Number(draft.total || 0), 0);
    return { session, booked, capacity, waitlist, revenue, fill: capacity ? Math.round((booked / capacity) * 100) : 0 };
  });
  const financeRows = drafts.map((draft) => ({
    id: draft.id,
    parent: draft.parentName || "Parent",
    parentEmail: draft.parentEmail || "",
    site: draft.site,
    activity: draft.activity,
    status: draft.status,
    method: draft.paymentMethod,
    reference: draft.paymentReference || "",
    total: Number(draft.total || 0),
    credit: (draft.creditEvents || []).reduce((sum, event) => sum + Number(event.amount || 0), 0),
    createdAt: draft.createdAt,
  }));
  const creditEvents = drafts.flatMap((draft) => (draft.creditEvents || []).map((event, index) => ({
    ...event,
    amount: Number(event.amount || 0),
    activity: draft.activity,
    bookingId: draft.id,
    eventId: event.id || `credit-${draft.id}-${index}`,
    parentEmail: draft.parentEmail || "",
    parentName: draft.parentName || "Parent",
    site: draft.site,
    status: event.status || "Open",
  })));
  const activeCreditEvents = creditEvents.filter((event) => !["Refunded", "Applied"].includes(event.status));
  const filteredCreditEvents = creditEvents.filter((event) => creditFilter === "All" || event.status === creditFilter);
  const creditLiability = activeCreditEvents.reduce((sum, event) => sum + event.amount, 0);
  const referenceRows = financeRows.filter((row) => row.method !== "card" && row.status !== "Prototype paid" && row.status !== "Cancelled");
  const pendingWithReference = referenceRows.filter((row) => row.reference.trim());
  const pendingWithoutReference = referenceRows.filter((row) => !row.reference.trim());
  const paymentDueMs = Number(rules.paymentDueHours || 0) * 60 * 60 * 1000;
  const overdueReferenceRows = referenceRows.filter((row) => paymentDueMs > 0 && row.createdAt && Date.now() - new Date(row.createdAt).getTime() > paymentDueMs);
  const paymentMethodTotals = ["card", "tfc", "voucher", "invoice"].map((method) => {
    const methodRows = financeRows.filter((row) => row.method === method && row.status !== "Cancelled");
    const paidRows = methodRows.filter((row) => row.status === "Prototype paid");
    return {
      method,
      count: methodRows.length,
      paid: paidRows.length,
      pending: methodRows.length - paidRows.length,
      total: methodRows.reduce((sum, row) => sum + row.total, 0),
    };
  });
  const paymentSandboxRows = financeRows.map((row) => ({
    ...row,
    label: row.method === "tfc" ? "Tax-Free Childcare" : row.method === "card" ? "Card" : row.method === "voucher" ? "Voucher" : "Invoice",
    intent: row.status === "Prototype paid" ? "succeeded" : row.status === "Payment failed" ? "failed" : row.status === "Partially refunded" ? "partially_refunded" : row.method === "card" ? "requires_action" : "awaiting_reference",
    risk: row.status === "Payment failed" || (!row.reference && row.method !== "card") ? "High" : row.status === "Partially refunded" || row.credit > 0 ? "Medium" : "Low",
  }));
  const activePaymentRow = paymentSandboxRows.find((row) => row.id === activePaymentId) || paymentSandboxRows[0] || null;
  const paymentSandboxCards = [
    ["Card intents", String(paymentSandboxRows.filter((row) => row.method === "card").length), "Checkout payment intent route"],
    ["References", String(paymentSandboxRows.filter((row) => row.method !== "card" && row.reference).length), "Voucher, TFC or invoice refs"],
    ["Failed / action", String(paymentSandboxRows.filter((row) => ["Payment failed", "Payment action required"].includes(row.status)).length), "Needs parent or finance action"],
    ["Refund exposure", money(paymentSandboxRows.reduce((sum, row) => sum + row.credit, 0)), "Credits and refund events"],
    ["Unmatched", String(paymentSandboxRows.filter((row) => row.method !== "card" && !row.reference && row.status !== "Prototype paid").length), "Manual matching needed"],
  ];
  const supportRows = drafts.map((draft) => {
    const family = families.find((item) => item.email === draft.parentEmail || item.parentName === draft.parentName);
    const childText = draft.children?.join(", ") || draft.childName || "";
    return {
      id: draft.id,
      draft,
      family,
      parent: draft.parentName || family?.parentName || "Parent",
      email: draft.parentEmail || family?.email || "",
      children: childText,
      searchable: `${draft.parentName || ""} ${draft.parentEmail || ""} ${childText} ${draft.site} ${draft.activity} ${draft.status}`.toLowerCase(),
    };
  });
  const filteredSupportRows = supportRows.filter((row) => !supportQuery.trim() || row.searchable.includes(supportQuery.toLowerCase()));
  const activeSupportRow = supportRows.find((row) => row.id === activeSupportId) || filteredSupportRows[0] || supportRows[0] || null;
  const activeSupportMessages = activeSupportRow ? messageLog.filter((message) => message.bookingId === activeSupportRow.id || message.recipient === activeSupportRow.email) : [];
  const activeSupportNotes = activeSupportRow ? supportNotes.filter((note) => note.bookingId === activeSupportRow.id) : [];
  const activeSupportTickets = activeSupportRow ? supportTickets.filter((ticket) => ticket.bookingId === activeSupportRow.id && ticket.status !== "Resolved") : [];
  const supportCards = [
    ["Open tickets", String(supportTickets.filter((ticket) => ticket.status !== "Resolved").length), "Queries needing admin action"],
    ["Search results", String(filteredSupportRows.length), "Matching booking records"],
    ["Internal notes", String(supportNotes.length), "Local admin note trail"],
    ["Parent messages", String(messageLog.length), "Generated confirmations and receipts"],
    ["Overrides", String(drafts.filter((draft) => draft.override || draft.supportOverride).length), "Admin exceptions recorded"],
  ];
  const ratioLimit = staffingSession.type === "Holiday Camp" ? 10 : 8;
  const staffingRows = staffingSession.days.map((day) => {
    const dayDrafts = drafts.filter((draft) => draft.sessionId === staffingSession.id && (draft.days || []).includes(day) && draft.status !== "Cancelled");
    const children = dayDrafts.reduce((sum, draft) => sum + Number(draft.childCount || 0), 0);
    const assignments = staffAssignments.filter((assignment) => assignment.sessionId === staffingSession.id && assignment.day === day && assignment.status !== "Absent");
    const absent = staffAssignments.filter((assignment) => assignment.sessionId === staffingSession.id && assignment.day === day && assignment.status === "Absent");
    const required = Math.max(1, Math.ceil(children / ratioLimit));
    const qualified = assignments.filter((assignment) => labStaffRoster.find((staff) => staff.id === assignment.staffId)?.qualified).length;
    const firstAid = assignments.some((assignment) => labStaffRoster.find((staff) => staff.id === assignment.staffId)?.firstAid);
    const covered = assignments.length >= required && qualified >= 1 && firstAid;
    return { day, children, assignments, absent, required, qualified, firstAid, covered, gap: Math.max(0, required - assignments.length) };
  });
  const coveredStaffingRows = staffingRows.filter((row) => row.covered).length;
  const staffingOpenGaps = staffingRows.reduce((sum, row) => sum + row.gap + (row.qualified ? 0 : 1) + (row.firstAid ? 0 : 1), 0);
  const staffLoadRows = labStaffRoster.map((staff) => {
    const assigned = staffAssignments.filter((assignment) => assignment.staffId === staff.id && assignment.status !== "Absent").length;
    return { staff, assigned, load: Math.round((assigned / staff.maxSessions) * 100) };
  });
  const staffingCards = [
    ["Covered days", `${coveredStaffingRows}/${staffingRows.length}`, "Days meeting ratio, qualification and first-aid checks"],
    ["Open gaps", String(staffingOpenGaps), "Ratio, lead or first-aid gaps"],
    ["Ratio target", `1:${ratioLimit}`, staffingSession.type],
    ["Projected children", String(staffingRows.reduce((sum, row) => sum + row.children, 0)), "Across selected activity"],
    ["Staff assigned", String(staffAssignments.filter((assignment) => assignment.sessionId === staffingSession.id && assignment.status !== "Absent").length), "Active rota slots"],
  ];
  const capacityRows = capacitySession.days.map((day) => {
    const overrideKey = `${capacitySession.id}-${day}`;
    const capacity = Number(capacityOverrides[overrideKey] || capacitySession.capacity);
    const dayBookings = drafts.filter((draft) => draft.sessionId === capacitySession.id && (draft.days || []).includes(day) && draft.status !== "Cancelled");
    const confirmed = dayBookings.filter((draft) => draft.status !== "Waitlist").reduce((sum, draft) => sum + Number(draft.childCount || 0), 0);
    const waitlist = dayBookings.filter((draft) => draft.status === "Waitlist").reduce((sum, draft) => sum + Number(draft.childCount || 0), 0);
    const spaces = Math.max(0, capacity - confirmed);
    const fill = capacity ? Math.round((confirmed / capacity) * 100) : 0;
    return { day, capacity, confirmed, waitlist, spaces, fill, overbooked: confirmed > capacity, bookings: dayBookings };
  });
  const waitlistDrafts = drafts.filter((draft) => draft.sessionId === capacitySession.id && draft.status === "Waitlist");
  const capacityTotalSpaces = capacityRows.reduce((sum, row) => sum + row.spaces, 0);
  const capacityWaitlistChildren = waitlistDrafts.reduce((sum, draft) => sum + Number(draft.childCount || 0), 0);
  const capacityOverbookedDays = capacityRows.filter((row) => row.overbooked).length;
  const capacitySessionDraftIds = new Set(drafts.filter((draft) => draft.sessionId === capacitySession.id).map((draft) => draft.id));
  const capacityOfferMessages = messageLog.filter((message) => message.template === "Waitlist offer" && capacitySessionDraftIds.has(message.bookingId));
  const capacityCards = [
    ["Open spaces", String(capacityTotalSpaces), "Across selected activity days"],
    ["Waitlist children", String(capacityWaitlistChildren), "Children waiting for an offer"],
    ["Overbooked days", String(capacityOverbookedDays), "Days above visible capacity"],
    ["Average fill", `${capacityRows.length ? Math.round(capacityRows.reduce((sum, row) => sum + row.fill, 0) / capacityRows.length) : 0}%`, "Confirmed children only"],
    ["Offers sent", String(capacityOfferMessages.length), "Local parent offer messages"],
  ];
  const activeTemplate = messageTemplates.find((template) => template.id === activeTemplateId) || messageTemplates[0] || defaultMessageTemplates[0];
  const templatePreviewDraft = drafts[0] || {
    id: "preview-booking",
    parentName: activeFamily.parentName,
    parentEmail: activeFamily.email,
    children: activeFamily.children?.slice(0, 1).map((child) => child.name) || ["Child"],
    activity: activeSession.title,
    site: activeSession.site,
    days: [activeSession.days[0]],
    total,
    paymentReference: "",
  };
  const templateStats = [
    ["Templates", String(messageTemplates.length), "Editable local comms"],
    ["Channels", String(new Set(messageTemplates.map((template) => template.channel)).size), "Email, SMS or hybrid"],
    ["Messages sent", String(messageLog.length), "Local message history"],
    ["Payment nudges", String(messageLog.filter((message) => message.template === "Payment reminder").length), "Reminder volume"],
    ["Waitlist offers", String(messageLog.filter((message) => message.template === "Waitlist offer").length), "Space offer volume"],
  ];
  const medicalRows = drafts
    .filter((draft) => draft.medicalNotes || (draft.children || []).some((name) => allChildProfiles.find((child) => child.name === name)?.flags?.length))
    .map((draft) => ({
      children: draft.children?.join(", ") || draft.childName,
      site: draft.site,
      activity: draft.activity,
      collector: draft.collector || "",
      emergencyPhone: draft.emergencyPhone || "",
      notes: draft.medicalNotes || "",
      flags: (draft.children || []).flatMap((name) => allChildProfiles.find((child) => child.name === name)?.flags || []).join("; "),
    }));
  const reportCards = [
    ["Average occupancy", `${occupancyRows.length ? Math.round(occupancyRows.reduce((sum, row) => sum + row.fill, 0) / occupancyRows.length) : 0}%`, "Across active catalogue capacity"],
    ["Revenue captured", money(opsRevenue), "Prototype booking value"],
    ["Unpaid / pending", String(opsPaymentDue), "Voucher, TFC or review states"],
    ["Credit liability", money(creditLiability), "Parent credit from changes"],
    ["Waitlist demand", String(drafts.filter((draft) => draft.status === "Waitlist").reduce((sum, draft) => sum + Number(draft.childCount || 0), 0)), "Children waiting for space"],
    ["Medical records", String(medicalRows.length), "Bookings with care notes or flags"],
  ];
  const familyChildNames = new Set((activeFamily.children || []).map((child) => child.name));
  const familyDrafts = drafts.filter((draft) => {
    if (draft.parentEmail && draft.parentEmail === activeFamily.email) return true;
    if (draft.parentName && draft.parentName === activeFamily.parentName) return true;
    return (draft.children || []).some((name) => familyChildNames.has(name));
  });
  const familyMessages = messageLog.filter((message) => message.recipient === activeFamily.email || familyDrafts.some((draft) => draft.id === message.bookingId));
  const outstandingFamilyTotal = familyDrafts
    .filter((draft) => draft.status !== "Prototype paid" && draft.status !== "Cancelled")
    .reduce((sum, draft) => sum + Number(draft.total || 0), 0);
  const familyCreditBalance = familyDrafts
    .flatMap((draft) => draft.creditEvents || [])
    .reduce((sum, event) => sum + Number(event.amount || 0), 0);
  const activeFamilyBookings = familyDrafts.filter((draft) => draft.status !== "Cancelled");
  const amendmentSession = amendment ? sessions.find((session) => session.id === amendment.sessionId) : null;
  const amendmentChildren = amendment?.children || [];
  const amendmentDays = amendment?.days || [];
  const amendmentChildCount = Math.max(1, amendmentChildren.length);
  const amendmentAddOns = amendmentSession
    ? labAddOns.filter((item) => item.appliesTo === "All" || item.appliesTo === amendmentSession.type)
    : [];
  const amendmentAddOnTotal = amendmentDays.length * amendmentChildCount * amendmentAddOns
    .filter((item) => amendment?.addOns?.includes(item.label))
    .reduce((sum, item) => sum + item.price, 0);
  const amendmentSubtotal = amendmentSession ? amendmentDays.length * amendmentSession.price * amendmentChildCount : 0;
  const amendmentSiblingDiscount = amendmentChildCount > 1 ? amendmentSubtotal * (Number(rules.siblingDiscountPercent || 0) / 100) : 0;
  const amendmentWeekDiscount = amendmentDays.length >= 4 ? amendmentSubtotal * (Number(rules.fullWeekDiscountPercent || 0) / 100) : 0;
  const amendmentTotal = Math.max(0, amendmentSubtotal + amendmentAddOnTotal - amendmentSiblingDiscount - amendmentWeekDiscount);
  const originalAmendmentDraft = amendment ? drafts.find((draft) => draft.id === amendment.id) : null;
  const amendmentDelta = amendment && originalAmendmentDraft ? amendmentTotal - Number(originalAmendmentDraft.total || 0) : 0;
  const parentPortalCards = [
    ["Upcoming bookings", String(activeFamilyBookings.length), "Active bookings and waitlist requests"],
    ["Outstanding", money(outstandingFamilyTotal), "Unpaid, pending or voucher/TFC bookings"],
    ["Credit balance", money(familyCreditBalance), "Local credit from cancellations or amendments"],
    ["Children", String(activeFamily.children?.length || 0), "Saved reusable child records"],
    ["Inbox", String(familyMessages.length), "Local confirmation and follow-up messages"],
  ];
  const checkoutSteps = ["Children", "Extras", "Details", "Payment", "Review"];
  const checkoutStepIndex = Math.max(0, checkoutSteps.indexOf(checkoutStep));
  const checkoutProgress = checkoutSteps.length > 1 ? ((checkoutStepIndex + 1) / checkoutSteps.length) * 100 : 100;
  const checkoutSummary = [
    ["Activity", activeSession.title],
    ["Sessions", `${pickedDays.length} selected`],
    ["Children", `${childCount} selected`],
    ["Payment", labPaymentOptions.find(([value]) => value === paymentMethod)?.[1] || "Card"],
    ["Total", money(total)],
  ];
  const stageClass = (stage) => checkoutStep === stage ? "active" : checkoutSteps.indexOf(stage) < checkoutStepIndex ? "complete" : "";
  const eligibilityIssues = selectedChildren.flatMap((child) => {
    const issues = [];
    if (rules.schoolOnlyStrict && activeSession.type === "Wraparound" && child.school !== activeSession.site && child.school !== "Guest") {
      issues.push(`${child.name} is not linked to ${activeSession.site}`);
    }
    const childYear = schoolYearIndex(child.year);
    if (activeSession.type === "Holiday Camp" && (childYear < schoolYearIndex(rules.holidayYearMin) || childYear > schoolYearIndex(rules.holidayYearMax))) {
      issues.push(`${child.name} is outside the holiday camp year range`);
    }
    return issues;
  });
  const rulesBlocked = eligibilityIssues.length > 0 && !(adminOverride && rules.allowAdminOverride);
  const rulesSummary = [
    [`${rules.cancellationHours}h`, "Cancellation window"],
    [`${rules.amendmentHours}h`, "Amendment deadline"],
    [`${rules.paymentDueHours}h`, "Voucher/TFC deadline"],
    [`${rules.autoWaitlistAtPercent}%`, "Auto-waitlist threshold"],
  ];
  const parentQaChecks = [
    ["Find care", filteredSessions.length > 0, `${filteredSessions.length} matching activities for current filters`, "Search should never strand a parent without clear next options."],
    ["Select sessions", pickedDays.length > 0, `${pickedDays.length} selected day${pickedDays.length === 1 ? "" : "s"}`, "Parents need visible day choice and capacity feedback before checkout."],
    ["Child details", selectedChildren.length > 0 && selectedChildren.every((child) => child.name), `${selectedChildren.length} child profile${selectedChildren.length === 1 ? "" : "s"} ready`, "Child records, medical flags and consents reduce repeated form-filling."],
    ["Rules clarity", !rulesBlocked, rulesBlocked ? `${eligibilityIssues.length} rule issue${eligibilityIssues.length === 1 ? "" : "s"}` : "Rules currently pass", "Eligibility and waitlist decisions should be explained before payment."],
    ["Payment clarity", paymentMethod === "card" || rules.paymentDueHours > 0, paymentMethod === "card" ? "Card checkout path selected" : `${rules.paymentDueHours}h reference deadline`, "Voucher and TFC routes need clear reference deadlines and reminders."],
    ["Support risk", supportTickets.filter((ticket) => ticket.status !== "Resolved").length === 0, `${supportTickets.filter((ticket) => ticket.status !== "Resolved").length} open support ticket${supportTickets.filter((ticket) => ticket.status !== "Resolved").length === 1 ? "" : "s"}`, "Open queries indicate parents may be confused or blocked."],
    ["Comms coverage", messageTemplates.length >= 5, `${messageTemplates.length} templates available`, "Core confirmations, reminders and waitlist offers need polished copy."],
    ["Mobile fit", checkoutSteps.length <= 5, `${checkoutSteps.length} checkout steps`, "A short staged flow is easier to complete on a phone."],
  ];
  const parentQaScore = Math.round((parentQaChecks.filter(([, pass]) => pass).length / parentQaChecks.length) * 100);
  const parentQaRisk = parentQaScore >= 85 ? "Low" : parentQaScore >= 65 ? "Medium" : "High";
  const parentQaFrictionRows = [
    ["Missing info", drafts.filter((draft) => !draft.parentEmail || !draft.collector || !draft.emergencyPhone).length, "Bookings missing email, collector or emergency phone."],
    ["Payment friction", drafts.filter((draft) => draft.status !== "Prototype paid" && draft.status !== "Cancelled").length, "Pending, failed, waitlist or reference-required bookings."],
    ["Waitlist friction", drafts.filter((draft) => draft.status === "Waitlist").length, "Families who need a clear space-offer journey."],
    ["Care complexity", medicalRows.length, "Bookings with medical or safeguarding detail to surface cleanly."],
  ];
  const parentQaCards = [
    ["QA score", `${parentQaScore}%`, `${parentQaRisk} parent friction risk`],
    ["Checkout stage", checkoutStep, `${Math.round(checkoutProgress)}% through staged flow`],
    ["Visible activities", String(filteredSessions.length), "Search results from current filters"],
    ["Family records", String(families.length), "Reusable family accounts"],
    ["Open support", String(supportTickets.filter((ticket) => ticket.status !== "Resolved").length), "Unresolved support tickets"],
  ];
  function buildRuleSimulation(test) {
    const testSubtotal = Number(test.days || 0) * Number(test.price || 0) * Number(test.childCount || 0);
    const testSiblingDiscount = Number(test.childCount || 0) > 1 ? testSubtotal * (Number(rules.siblingDiscountPercent || 0) / 100) : 0;
    const testWeekDiscount = Number(test.days || 0) >= 4 ? testSubtotal * (Number(rules.fullWeekDiscountPercent || 0) / 100) : 0;
    const testPromoDiscount = String(test.promo || "").trim().toUpperCase() === String(rules.promoCode || "").toUpperCase() ? testSubtotal * (Number(rules.promoDiscountPercent || 0) / 100) : 0;
    const testTotal = Math.max(0, testSubtotal - testSiblingDiscount - testWeekDiscount - testPromoDiscount);
    const capacityAfter = Number(test.alreadyBooked || 0) + Number(test.childCount || 0);
    const capacityPercent = Number(test.capacity || 0) ? Math.round((capacityAfter / Number(test.capacity || 1)) * 100) : 0;
    const issues = [
      rules.schoolOnlyStrict && test.careType === "Wraparound" && test.childSchool !== test.site ? `School-only rule blocks ${test.childSchool || "this school"} for ${test.site}` : "",
      test.careType === "Holiday Camp" && schoolYearIndex(test.childYear) < schoolYearIndex(rules.holidayYearMin) ? `Below holiday minimum year ${rules.holidayYearMin}` : "",
      test.careType === "Holiday Camp" && schoolYearIndex(test.childYear) > schoolYearIndex(rules.holidayYearMax) ? `Above holiday maximum year ${rules.holidayYearMax}` : "",
    ].filter(Boolean);
    const blocked = issues.length > 0 && !(test.override && rules.allowAdminOverride);
    const waitlist = capacityAfter > Number(test.capacity || 0) || capacityPercent > Number(rules.autoWaitlistAtPercent || 100);
    const outcome = blocked ? "Blocked" : waitlist ? "Waitlist" : test.paymentMethod === "card" ? "Confirmed paid" : "Reserved pending reconciliation";
    return {
      blocked,
      capacityAfter,
      capacityPercent,
      issues,
      outcome,
      siblingDiscount: testSiblingDiscount,
      subtotal: testSubtotal,
      total: testTotal,
      promoDiscount: testPromoDiscount,
      waitlist,
      weekDiscount: testWeekDiscount,
    };
  }
  const simulatedSubtotal = Number(ruleTest.days || 0) * Number(ruleTest.price || 0) * Number(ruleTest.childCount || 0);
  const simulatedSiblingDiscount = Number(ruleTest.childCount || 0) > 1 ? simulatedSubtotal * (Number(rules.siblingDiscountPercent || 0) / 100) : 0;
  const simulatedWeekDiscount = Number(ruleTest.days || 0) >= 4 ? simulatedSubtotal * (Number(rules.fullWeekDiscountPercent || 0) / 100) : 0;
  const simulatedPromoDiscount = ruleTest.promo.trim().toUpperCase() === String(rules.promoCode || "").toUpperCase() ? simulatedSubtotal * (Number(rules.promoDiscountPercent || 0) / 100) : 0;
  const simulatedTotal = Math.max(0, simulatedSubtotal - simulatedSiblingDiscount - simulatedWeekDiscount - simulatedPromoDiscount);
  const simulatedCapacityAfter = Number(ruleTest.alreadyBooked || 0) + Number(ruleTest.childCount || 0);
  const simulatedCapacityPercent = Number(ruleTest.capacity || 0) ? Math.round((simulatedCapacityAfter / Number(ruleTest.capacity || 1)) * 100) : 0;
  const simulatedIssues = [
    rules.schoolOnlyStrict && ruleTest.careType === "Wraparound" && ruleTest.childSchool !== ruleTest.site ? `School-only rule blocks ${ruleTest.childSchool || "this school"} for ${ruleTest.site}` : "",
    ruleTest.careType === "Holiday Camp" && schoolYearIndex(ruleTest.childYear) < schoolYearIndex(rules.holidayYearMin) ? `Below holiday minimum year ${rules.holidayYearMin}` : "",
    ruleTest.careType === "Holiday Camp" && schoolYearIndex(ruleTest.childYear) > schoolYearIndex(rules.holidayYearMax) ? `Above holiday maximum year ${rules.holidayYearMax}` : "",
  ].filter(Boolean);
  const simulatedBlocked = simulatedIssues.length > 0 && !(ruleTest.override && rules.allowAdminOverride);
  const simulatedWaitlist = simulatedCapacityAfter > Number(ruleTest.capacity || 0) || simulatedCapacityPercent > Number(rules.autoWaitlistAtPercent || 100);
  const simulatedOutcome = simulatedBlocked ? "Blocked" : simulatedWaitlist ? "Waitlist" : ruleTest.paymentMethod === "card" ? "Confirmed paid" : "Reserved pending reconciliation";
  const simulatorCards = [
    ["Outcome", simulatedOutcome, simulatedBlocked ? "Rules prevent booking" : simulatedWaitlist ? "Capacity rule creates waitlist" : "Booking can proceed"],
    ["Price", money(simulatedTotal), `${money(simulatedSubtotal)} before discounts`],
    ["Capacity", `${simulatedCapacityPercent}%`, `${simulatedCapacityAfter}/${ruleTest.capacity || 0} projected spaces`],
    ["Payment", ruleTest.paymentMethod === "tfc" ? "Tax-Free Childcare" : ruleTest.paymentMethod, ruleTest.paymentMethod === "card" ? "Paid at checkout" : `${rules.paymentDueHours}h reference window`],
  ];
  const ruleScenarioPresets = [
    ["Strict policy", { ...ruleTest, careType: "Wraparound", site: "Willington Prep", childSchool: "Another School", childYear: "Year 2", childCount: 1, days: 1, capacity: 8, alreadyBooked: 4, paymentMethod: "card", promo: "", override: false }],
    ["Override allowed", { ...ruleTest, careType: "Wraparound", site: "Willington Prep", childSchool: "Another School", childYear: "Year 2", childCount: 1, days: 1, capacity: 8, alreadyBooked: 4, paymentMethod: "card", promo: "", override: true }],
    ["Capacity full", { ...ruleTest, careType: "Wraparound", site: "Willington Prep", childSchool: "Willington Prep", childYear: "Year 2", childCount: 2, days: 1, capacity: 8, alreadyBooked: 8, paymentMethod: "tfc", promo: "", override: false }],
    ["Holiday age range", { ...ruleTest, careType: "Holiday Camp", site: "Wimbledon Camp", childSchool: "Any School", childYear: "Year 7", childCount: 1, days: 5, capacity: 24, alreadyBooked: 12, paymentMethod: "voucher", promo: rules.promoCode || "", override: false }],
  ];
  const comparedRuleScenarios = ruleScenarios.map((scenario) => ({ ...scenario, result: buildRuleSimulation(scenario.test) }));
  const registerRows = drafts
    .filter((draft) => draft.sessionId === activeSession.id && (draft.days || []).includes(registerDay) && draft.status !== "Cancelled")
    .flatMap((draft) => {
      const names = draft.children?.length ? draft.children : [draft.childName || "Child"];
      return names.map((name) => {
        const profile = allChildProfiles.find((child) => child.name === name);
        const rowId = `${draft.id}-${registerDay}-${name}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
        const event = registerEvents[rowId] || {};
        return {
          rowId,
          draft,
          name,
          flags: profile?.flags || [],
          status: event.status || "Booked",
          note: event.note || "",
          time: event.time || "",
          collector: draft.collector || "Collector not set",
        };
      });
    });
  const pilotDrafts = drafts.filter((draft) => draft.sessionId === pilotSession.id && draft.status !== "Cancelled");
  const pilotChildSessions = pilotDrafts.reduce((sum, draft) => sum + Number(draft.childCount || 0) * (draft.days?.length || 0), 0);
  const pilotCapacity = pilotSession.capacity * pilotSession.days.length;
  const pilotFill = pilotCapacity ? Math.round((pilotChildSessions / pilotCapacity) * 100) : 0;
  const pilotRevenue = pilotDrafts.reduce((sum, draft) => sum + Number(draft.total || 0), 0);
  const pilotPending = pilotDrafts.filter((draft) => draft.status !== "Prototype paid").length;
  const pilotMessages = messageLog.filter((message) => message.template === "Pilot invite" || pilotDrafts.some((draft) => draft.id === message.bookingId));
  const pilotRegisterRows = pilotDrafts.flatMap((draft) => {
    const day = pilotSession.days[0];
    const names = draft.children?.length ? draft.children : [draft.childName || "Child"];
    return names.map((name) => {
      const rowId = `${draft.id}-${day}-${name}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
      return { rowId, name, draft, event: registerEvents[rowId] || {} };
    });
  });
  const pilotRegisterTouched = pilotRegisterRows.filter((row) => row.event.status).length;
  const pilotCareFlags = pilotDrafts.filter((draft) => draft.medicalNotes || draft.collector || draft.emergencyPhone).length;
  const pilotChecklist = [
    ["Activity configured", Boolean(pilotSession?.id), `${pilotSession.site} · ${pilotSession.title}`],
    ["Parent invite path", pilotMessages.length >= Math.max(4, pilotDrafts.length), `${pilotMessages.length} pilot message${pilotMessages.length === 1 ? "" : "s"}`],
    ["Bookings seeded", pilotDrafts.length >= 6, `${pilotDrafts.length} family booking${pilotDrafts.length === 1 ? "" : "s"}`],
    ["Capacity visible", pilotFill > 0 && pilotFill <= 100, `${pilotFill}% projected fill`],
    ["Payment rehearsal", pilotDrafts.length > 0 && pilotPending === 0, `${pilotPending} pending payment${pilotPending === 1 ? "" : "s"}`],
    ["Register rehearsal", pilotRegisterRows.length > 0 && pilotRegisterTouched >= Math.min(6, pilotRegisterRows.length), `${pilotRegisterTouched}/${pilotRegisterRows.length} rows touched`],
    ["Care data present", pilotCareFlags >= Math.min(4, pilotDrafts.length), `${pilotCareFlags} booking${pilotCareFlags === 1 ? "" : "s"} with care data`],
  ];
  const pilotReadyCount = pilotChecklist.filter(([, ready]) => ready).length;
  const pilotGoNoGo = pilotReadyCount === pilotChecklist.length ? "Go" : pilotReadyCount >= 5 ? "Pilot with watchpoints" : "Not ready";
  const registerCounts = ["Booked", "Checked in", "Checked out", "Absent", "Late collection", "Incident"].map((label) => [
    label,
    registerRows.filter((row) => row.status === label).length,
  ]);
  const staffWarnings = registerRows.filter((row) => row.flags.length || row.draft.medicalNotes || row.collector === "Collector not set").length;
  const checkedOutCount = registerRows.filter((row) => row.status === "Checked out").length;
  const registerCompletion = registerRows.length ? Math.round((checkedOutCount / registerRows.length) * 100) : 0;
  const roleDashboards = {
    Parent: {
      view: "Parent",
      title: "Parent booking hub",
      text: "Find care, manage family details, amend bookings and track payments or credit.",
      metrics: [
        ["Upcoming", String(activeFamilyBookings.length)],
        ["Outstanding", money(outstandingFamilyTotal)],
        ["Credit", money(familyCreditBalance)],
      ],
      actions: [["Book care", "Parent"], ["Family records", "Family"], ["Messages", "Parent"]],
    },
    Staff: {
      view: "Operations",
      title: "Live club register",
      text: "Check children in and out, review warnings, add handover notes and export the day register.",
      metrics: [
        ["On register", String(registerRows.length)],
        ["Warnings", String(staffWarnings)],
        ["Incidents", String(openIncidents)],
      ],
      actions: [["Open register", "Operations"], ["Seed day", "Operations"], ["Export register", "Operations"]],
    },
    Manager: {
      view: "Operations",
      title: "Manager control room",
      text: "Watch occupancy, waitlists, rules, comms, incidents and launch readiness across the booking lab.",
      metrics: [
        ["Occupancy", `${occupancyRows.length ? Math.round(occupancyRows.reduce((sum, row) => sum + row.fill, 0) / occupancyRows.length) : 0}%`],
        ["Waitlist", String(drafts.filter((draft) => draft.status === "Waitlist").reduce((sum, draft) => sum + Number(draft.childCount || 0), 0))],
        ["Rules", `${rules.autoWaitlistAtPercent}%`],
      ],
      actions: [["Parent QA", "QA"], ["Comms", "Comms"], ["Capacity", "Capacity"]],
    },
    Finance: {
      view: "Payments",
      title: "Finance and credit desk",
      text: "Reconcile card, voucher and TFC routes, manage credit liability and export finance records.",
      metrics: [
        ["Pending", String(opsPaymentDue)],
        ["Credit liability", money(creditLiability)],
        ["Referenced", String(pendingWithReference.length)],
      ],
      actions: [["Payments sandbox", "Payments"], ["Reconciliation", "Operations"], ["Finance export", "Operations"]],
    },
  };
  const activeRoleDashboard = roleDashboards[activeRole];
  const rolePermissions = {
    Parent: {
      actions: ["book", "family"],
      views: ["Parent", "Family"],
    },
    Staff: {
      actions: ["register"],
      views: ["Operations"],
    },
    Manager: {
      actions: ["book", "family", "register", "finance", "manage", "rules", "setup", "support", "staffing", "capacity", "comms", "qa", "export"],
      views: ["Parent", "Family", "Operations", "Setup", "Pilot", "Payments", "Support", "Staffing", "Capacity", "Comms", "QA", "Data Model", "Readiness"],
    },
    Finance: {
      actions: ["finance", "export"],
      views: ["Operations", "Payments"],
    },
  };
  const can = (action) => rolePermissions[activeRole]?.actions.includes(action);
  const canView = (view) => rolePermissions[activeRole]?.views.includes(view);
  const roleLockText = `${activeRole} role cannot use this action in the prototype. Switch to Manager for full access.`;

  function toggleDay(day) {
    setSelectedDays((current) => {
      const existing = current[activeSession.id] || [];
      const next = existing.includes(day) ? existing.filter((item) => item !== day) : [...existing, day];
      return { ...current, [activeSession.id]: next };
    });
  }

  function chooseSession(session) {
    setActiveId(session.id);
    setRegisterDay(session.days[0]);
    setStatus("");
    setSelectedAddOns((items) => items.filter((id) => labAddOns.find((item) => item.id === id && (item.appliesTo === "All" || item.appliesTo === session.type))));
    setSelectedDays((current) => current[session.id]?.length ? current : { ...current, [session.id]: [session.days[0]] });
  }

  function applyBookingMode(mode) {
    setBookingMode(mode);
    setStatus("");
    setSelectedDays((current) => {
      if (mode === "Full week") return { ...current, [activeSession.id]: activeSession.days };
      if (mode === "Same day weekly") return { ...current, [activeSession.id]: activeSession.days.filter((day) => day.startsWith("Mon") || day.startsWith("Tue")).slice(0, 1) };
      return { ...current, [activeSession.id]: current[activeSession.id]?.length ? current[activeSession.id] : [activeSession.days[0]] };
    });
  }

  function toggleChild(childId) {
    setSelectedChildIds((current) => {
      const next = current.includes(childId) ? current.filter((id) => id !== childId) : [...current, childId];
      return next.length ? next : current;
    });
  }

  function persistFamilies(nextFamilies) {
    setFamilies(nextFamilies);
    localStorage.setItem("apres-booking-lab-families", JSON.stringify(nextFamilies));
  }

  function createFamily(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const collectors = String(form.get("collectors") || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const childFlags = String(form.get("childFlags") || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const family = {
      id: `family-${Date.now()}`,
      parentName: form.get("parentName") || "Parent",
      email: form.get("email") || "",
      phone: form.get("phone") || "",
      emergencyContact: form.get("emergencyContact") || "",
      collectors,
      children: [{
        id: `family-child-${Date.now()}`,
        name: form.get("childName") || "Child",
        year: form.get("childYear") || "Reception",
        school: form.get("childSchool") || "",
        flags: childFlags,
        medicalPlan: form.get("medicalPlan") || "",
        consent: form.get("photoConsent") || "Photo consent off",
      }],
      consentHistory: [
        `Terms accepted ${new Date().toISOString().slice(0, 10)}`,
        `Emergency care consent ${new Date().toISOString().slice(0, 10)}`,
        `Data storage consent ${new Date().toISOString().slice(0, 10)}`,
      ],
    };
    const nextFamilies = [family, ...families].slice(0, 16);
    persistFamilies(nextFamilies);
    setActiveFamilyId(family.id);
    setSelectedChildIds([family.children[0].id]);
    event.currentTarget.reset();
  }

  function loadFamily(familyId) {
    const family = families.find((item) => item.id === familyId);
    if (!family) return;
    setActiveFamilyId(familyId);
    setSelectedChildIds(family.children?.slice(0, 1).map((child) => child.id) || selectedChildIds);
    setGuestChildren([]);
  }

  function addGuestChild() {
    const trimmed = guestName.trim();
    if (!trimmed) return;
    setGuestChildren((current) => [...current, { id: `guest-${Date.now()}`, name: trimmed, year: "Guest", school: activeSession.site, flags: [], consent: "Consent to confirm" }]);
    setGuestName("");
  }

  function moveCheckoutStep(direction) {
    const nextIndex = Math.max(0, Math.min(checkoutSteps.length - 1, checkoutStepIndex + direction));
    setCheckoutStep(checkoutSteps[nextIndex]);
  }

  function updateRuleTest(field, value) {
    setRuleTest((current) => ({ ...current, [field]: value }));
  }

  function chooseRole(role) {
    setActiveRole(role);
    const nextView = roleDashboards[role]?.view;
    if (nextView) setLabView(nextView);
  }

  function runRoleAction(view) {
    setLabView(view);
    if (activeRole === "Staff" && view === "Operations") setRegisterMode("Cards");
    if (activeRole === "Finance" && view === "Operations") setCreditFilter("Open");
  }

  function persistRuleScenarios(nextScenarios) {
    setRuleScenarios(nextScenarios);
    localStorage.setItem("apres-booking-lab-rule-scenarios", JSON.stringify(nextScenarios));
  }

  function saveCurrentRuleScenario() {
    const result = buildRuleSimulation(ruleTest);
    const scenario = {
      id: `rule-scenario-${Date.now()}`,
      createdAt: new Date().toISOString(),
      name: `${result.outcome} · ${ruleTest.careType} · ${ruleTest.childYear}`,
      test: { ...ruleTest },
    };
    persistRuleScenarios([scenario, ...ruleScenarios].slice(0, 8));
    setStatus("Rules simulator scenario saved locally.");
  }

  function loadRuleScenario(scenario) {
    setRuleTest({ ...scenario.test });
    setStatus(`Loaded scenario: ${scenario.name}`);
  }

  function removeRuleScenario(id) {
    persistRuleScenarios(ruleScenarios.filter((scenario) => scenario.id !== id));
  }

  function toggleAddOn(addOnId) {
    setSelectedAddOns((current) => current.includes(addOnId) ? current.filter((id) => id !== addOnId) : [...current, addOnId]);
  }

  function persistDrafts(nextDrafts) {
    setDrafts(nextDrafts);
    localStorage.setItem("apres-booking-lab-drafts", JSON.stringify(nextDrafts));
  }

  function persistRegisterEvents(nextEvents) {
    setRegisterEvents(nextEvents);
    localStorage.setItem("apres-booking-lab-register", JSON.stringify(nextEvents));
  }

  function updateRegisterRow(rowId, nextStatus, note = "") {
    const timestamp = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const current = registerEvents[rowId] || {};
    persistRegisterEvents({
      ...registerEvents,
      [rowId]: {
        ...current,
        status: nextStatus,
        note: note || current.note || "",
        time: timestamp,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  function addRegisterNote(rowId) {
    const note = incidentDrafts[rowId]?.trim();
    if (!note) return;
    updateRegisterRow(rowId, "Incident", note);
    setIncidentDrafts((current) => ({ ...current, [rowId]: "" }));
  }

  function quickRegisterIncident(rowId, note) {
    updateRegisterRow(rowId, "Incident", note);
  }

  function bulkUpdateRegister(nextStatus) {
    if (!registerRows.length) return;
    const timestamp = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const nextEvents = { ...registerEvents };
    registerRows.forEach((row) => {
      nextEvents[row.rowId] = {
        ...(nextEvents[row.rowId] || {}),
        status: nextStatus,
        note: nextEvents[row.rowId]?.note || "",
        time: timestamp,
        updatedAt: new Date().toISOString(),
      };
    });
    persistRegisterEvents(nextEvents);
    setStatus(`${registerRows.length} register row${registerRows.length === 1 ? "" : "s"} marked ${nextStatus.toLowerCase()}.`);
  }

  function seedDemoBooking() {
    const booking = {
      id: `lab-booking-${Date.now()}`,
      createdAt: new Date().toISOString(),
      sessionId: activeSession.id,
      site: activeSession.site,
      activity: activeSession.title,
      days: [activeSession.days[0]],
      children: ["Ava", "Leo"],
      childCount: 2,
      addOns: [],
      total: activeSession.price * 2,
      paymentMethod: "card",
      parentName: "Demo Parent",
      parentEmail: "demo@example.com",
      childName: "Ava",
      collector: "Jordan Parent",
      emergencyPhone: "07123 456789",
      medicalNotes: "Ava has a nut allergy. Leo has an inhaler in his bag.",
      consents: { terms: true, emergency: true, data: true },
      status: "Prototype paid",
    };
    persistDrafts([booking, ...drafts].slice(0, 20));
    setRegisterDay(activeSession.days[0]);
  }

  function seedPilotLaunch() {
    const parents = [
      ["Nina Patel", "nina.patel@example.com", ["Maya"], "Maya has a nut allergy. EpiPen in red pouch.", "Grandad Patel"],
      ["Chris Morgan", "chris.morgan@example.com", ["Eli", "Rosa"], "Rosa has an asthma inhaler in front pocket.", "Chris Morgan"],
      ["Sofia Ahmed", "sofia.ahmed@example.com", ["Ibrahim"], "", "Auntie Leila"],
      ["Tom Greene", "tom.greene@example.com", ["Freya"], "Freya needs quiet handover if tired.", "Tom Greene"],
      ["Priya Shah", "priya.shah@example.com", ["Arjun"], "", "Priya Shah"],
      ["Marta Nowak", "marta.nowak@example.com", ["Zofia"], "No dairy snack.", "Marta Nowak"],
      ["Daniel Reed", "daniel.reed@example.com", ["Oscar"], "", "Sam Reed"],
      ["Aisha Brown", "aisha.brown@example.com", ["Amelie"], "SEN support note: use visual timer for transitions.", "Aisha Brown"],
    ];
    const methods = ["card", "tfc", "voucher", "invoice"];
    const daySets = [
      pilotSession.days.slice(0, 1),
      pilotSession.days.slice(0, 2),
      pilotSession.days.slice(1, 3),
      pilotSession.days.slice(0, Math.min(4, pilotSession.days.length)),
    ];
    const now = Date.now();
    const pilotBookings = parents.map(([parentName, parentEmail, children, medicalNotes, collector], index) => {
      const payment = methods[index % methods.length];
      const days = daySets[index % daySets.length].length ? daySets[index % daySets.length] : [pilotSession.days[0]];
      return {
        id: `pilot-booking-${now}-${index}`,
        createdAt: new Date(now + index).toISOString(),
        sessionId: pilotSession.id,
        site: pilotSession.site,
        activity: pilotSession.title,
        days,
        children,
        childCount: children.length,
        addOns: index % 3 === 0 ? ["Hot snack"] : [],
        total: days.length * children.length * pilotSession.price + (index % 3 === 0 ? days.length * children.length * 3.5 : 0),
        paymentMethod: payment,
        paymentReference: payment === "card" ? `CARD-${now}-${index}` : index % 2 === 0 ? `REF-${pilotSession.site.slice(0, 3).toUpperCase()}-${index}` : "",
        parentName,
        parentEmail,
        childName: children[0],
        collector,
        emergencyPhone: `07${String(100000000 + index * 37913).slice(0, 9)}`,
        medicalNotes,
        consents: { terms: true, emergency: true, data: true },
        status: payment === "card" ? "Prototype paid" : "Payment reference pending",
        pilot: true,
      };
    });
    const existingNonPilot = drafts.filter((draft) => !(draft.pilot && draft.sessionId === pilotSession.id));
    persistDrafts([...pilotBookings, ...existingNonPilot].slice(0, 30));
    const inviteMessages = pilotBookings.map((booking, index) => ({
      id: `pilot-message-${now}-${index}`,
      createdAt: new Date(now + index).toISOString(),
      template: "Pilot invite",
      recipient: booking.parentEmail,
      bookingId: booking.id,
      subject: `Pilot invite · ${pilotSession.site}`,
      body: `Hi ${booking.parentName}, you are invited to test ${pilotSession.title} at ${pilotSession.site}. Your provisional sessions are ${booking.days.join(", ")}.`,
    }));
    persistMessages([...inviteMessages, ...messageLog].slice(0, 40));
    setActiveId(pilotSession.id);
    setRegisterDay(pilotSession.days[0]);
    setStatus(`Pilot seeded for ${pilotSession.site}: ${pilotBookings.length} bookings, invites and mixed payment states created locally.`);
  }

  function sendPilotInvites() {
    if (!pilotDrafts.length) {
      setStatus("Seed a pilot first so invite messages can be attached to bookings.");
      return;
    }
    const now = Date.now();
    const messages = pilotDrafts.map((draft, index) => ({
      id: `pilot-reminder-${now}-${index}`,
      createdAt: new Date(now + index).toISOString(),
      template: "Pilot invite",
      recipient: draft.parentEmail || "parent@example.com",
      bookingId: draft.id,
      subject: `Pilot reminder · ${draft.activity}`,
      body: `Hi ${draft.parentName || "there"}, please check your ${draft.activity} pilot booking for ${draft.site} and confirm collection, medical and payment details.`,
    }));
    persistMessages([...messages, ...messageLog].slice(0, 40));
    setStatus(`${messages.length} pilot invite/reminder message${messages.length === 1 ? "" : "s"} queued locally.`);
  }

  function runPilotRegister() {
    if (!pilotRegisterRows.length) {
      setStatus("Seed pilot bookings before running the register rehearsal.");
      return;
    }
    const timestamp = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const nextEvents = { ...registerEvents };
    pilotRegisterRows.forEach((row, index) => {
      nextEvents[row.rowId] = {
        ...(nextEvents[row.rowId] || {}),
        status: index % 5 === 0 ? "Incident" : index % 2 === 0 ? "Checked out" : "Checked in",
        note: index % 5 === 0 ? "Pilot rehearsal: handover note captured and visible to manager." : nextEvents[row.rowId]?.note || "",
        time: timestamp,
        updatedAt: new Date().toISOString(),
      };
    });
    persistRegisterEvents(nextEvents);
    setActiveId(pilotSession.id);
    setRegisterDay(pilotSession.days[0]);
    setStatus(`${pilotRegisterRows.length} pilot register rows rehearsed locally.`);
  }

  function reconcilePilotPayments() {
    if (!pilotDrafts.length) {
      setStatus("Seed a pilot first so payments can be reconciled.");
      return;
    }
    const nextDrafts = drafts.map((draft) => {
      if (draft.sessionId !== pilotSession.id || draft.status === "Cancelled") return draft;
      return {
        ...draft,
        status: "Prototype paid",
        paymentReference: draft.paymentReference || `PILOT-${draft.id.slice(-6).toUpperCase()}`,
        reconciledAt: new Date().toISOString(),
      };
    });
    persistDrafts(nextDrafts);
    setStatus(`${pilotDrafts.length} pilot payment row${pilotDrafts.length === 1 ? "" : "s"} marked reconciled.`);
  }

  function ensurePaymentRows() {
    if (drafts.length) return;
    seedPilotLaunch();
  }

  function updatePaymentDraft(id, updater) {
    const nextDrafts = drafts.map((draft) => draft.id === id ? { ...updater(draft), updatedAt: new Date().toISOString() } : draft);
    persistDrafts(nextDrafts);
  }

  function setPaymentState(id, status, extras = {}) {
    updatePaymentDraft(id, (draft) => ({ ...draft, status, ...extras }));
    setActivePaymentId(id);
  }

  function simulateCardAction(id, outcome) {
    const draft = drafts.find((item) => item.id === id);
    if (!draft) return;
    if (outcome === "success") {
      setPaymentState(id, "Prototype paid", {
        paymentMethod: "card",
        paymentReference: draft.paymentReference || `pi_${Date.now()}`,
        reconciledAt: new Date().toISOString(),
        paymentTimeline: [
          ...(draft.paymentTimeline || []),
          { label: "Card intent succeeded", at: new Date().toISOString() },
        ],
      });
      setStatus("Card payment intent simulated as succeeded.");
      return;
    }
    setPaymentState(id, outcome === "failed" ? "Payment failed" : "Payment action required", {
      paymentMethod: "card",
      paymentReference: draft.paymentReference || `pi_${Date.now()}`,
      paymentTimeline: [
        ...(draft.paymentTimeline || []),
        { label: outcome === "failed" ? "Card declined" : "Strong customer authentication required", at: new Date().toISOString() },
      ],
    });
    setStatus(outcome === "failed" ? "Card payment simulated as failed." : "Card payment now requires parent action.");
  }

  function matchReferencePayment(id) {
    const draft = drafts.find((item) => item.id === id);
    if (!draft) return;
    setPaymentState(id, "Prototype paid", {
      paymentReference: draft.paymentReference || `MATCH-${Date.now().toString().slice(-6)}`,
      reconciledAt: new Date().toISOString(),
      paymentTimeline: [
        ...(draft.paymentTimeline || []),
        { label: "Manual reference matched", at: new Date().toISOString() },
      ],
    });
    setStatus("Reference payment matched and reconciled.");
  }

  function createPartialRefund(id) {
    const draft = drafts.find((item) => item.id === id);
    if (!draft) return;
    const amount = Math.max(1, Math.round(Number(draft.total || 0) * 0.25 * 100) / 100);
    updatePaymentDraft(id, (item) => ({
      ...item,
      status: "Partially refunded",
      creditEvents: [
        ...(item.creditEvents || []),
        {
          id: `payment-credit-${Date.now()}`,
          type: "Partial refund",
          reason: "Payment sandbox partial refund",
          amount,
          status: "Open",
          createdAt: new Date().toISOString(),
        },
      ],
      paymentTimeline: [
        ...(item.paymentTimeline || []),
        { label: `Partial refund created for ${money(amount)}`, at: new Date().toISOString() },
      ],
    }));
    setActivePaymentId(id);
    setStatus(`Partial refund created for ${money(amount)}.`);
  }

  function sendPaymentReceipt(id) {
    const draft = drafts.find((item) => item.id === id);
    if (!draft) return;
    const message = {
      id: `payment-receipt-${Date.now()}`,
      createdAt: new Date().toISOString(),
      template: "Payment receipt",
      recipient: draft.parentEmail || "parent@example.com",
      bookingId: draft.id,
      subject: `Receipt · ${draft.activity}`,
      body: `Hi ${draft.parentName || "there"}, receipt for ${draft.activity}: ${money(Number(draft.total || 0))}. Status: ${draft.status}. Reference: ${draft.paymentReference || "not recorded"}.`,
    };
    persistMessages([message, ...messageLog].slice(0, 40));
    setStatus("Payment receipt message created locally.");
  }

  function exportPilotReport() {
    const lines = [
      "# Après Booking Lab Pilot Report",
      "",
      `Site: ${pilotSession.site}`,
      `Activity: ${pilotSession.title}`,
      `Go / no-go: ${pilotGoNoGo}`,
      `Checklist: ${pilotReadyCount}/${pilotChecklist.length}`,
      `Bookings: ${pilotDrafts.length}`,
      `Projected fill: ${pilotFill}%`,
      `Revenue: ${money(pilotRevenue)}`,
      `Pending payments: ${pilotPending}`,
      `Register rows touched: ${pilotRegisterTouched}/${pilotRegisterRows.length}`,
      "",
      "## Checklist",
      ...pilotChecklist.map(([label, ready, detail]) => `- ${ready ? "Ready" : "Open"}: ${label} (${detail})`),
      "",
      "## Bookings",
      ...pilotDrafts.map((draft) => `- ${draft.parentName}: ${draft.children?.join(", ") || draft.childName} · ${draft.status} · ${money(Number(draft.total || 0))}`),
    ];
    downloadTextFile("apres-booking-lab-pilot-report.md", lines.join("\n"));
  }

  function exportDailyRegister() {
    const lines = [
      `Après School register - ${activeSession.site}`,
      `${activeSession.title} · ${registerDay} · ${activeSession.time}`,
      "",
      ...registerRows.map((row) => [
        row.name,
        row.status,
        row.time || "No time",
        row.collector,
        row.flags.length ? row.flags.join("; ") : "No flags",
        row.note || row.draft.medicalNotes || "No notes",
      ].join(" | ")),
    ];
    downloadTextFile(`apres-register-${activeSession.site.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${registerDay.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.txt`, lines.join("\n"));
  }

  function persistMessages(nextMessages) {
    setMessageLog(nextMessages);
    localStorage.setItem("apres-booking-lab-messages", JSON.stringify(nextMessages));
  }

  function persistMessageTemplates(nextTemplates) {
    setMessageTemplates(nextTemplates);
    localStorage.setItem("apres-booking-lab-message-templates", JSON.stringify(nextTemplates));
  }

  function renderTemplateText(text, draft = templatePreviewDraft) {
    const values = {
      parent: draft.parentName || "Parent",
      activity: draft.activity || activeSession.title,
      site: draft.site || activeSession.site,
      days: (draft.days || [activeSession.days[0]]).join(", "),
      total: money(Number(draft.total || 0)),
      children: draft.children?.join(", ") || draft.childName || "your child",
      reference: draft.paymentReference || "to follow",
      deadline: String(rules.paymentDueHours),
    };
    return Object.entries(values).reduce((body, [key, value]) => body.replaceAll(`{${key}}`, value), text || "");
  }

  function saveTemplate(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const template = {
      id: activeTemplate.id,
      name: form.get("name") || activeTemplate.name,
      channel: form.get("channel") || activeTemplate.channel,
      trigger: form.get("trigger") || activeTemplate.trigger,
      subject: form.get("subject") || activeTemplate.subject,
      body: form.get("body") || activeTemplate.body,
      updatedAt: new Date().toISOString(),
    };
    persistMessageTemplates(messageTemplates.map((item) => item.id === template.id ? template : item));
    setStatus(`${template.name} template saved locally.`);
  }

  function duplicateTemplate() {
    const copy = {
      ...activeTemplate,
      id: `template-${Date.now()}`,
      name: `${activeTemplate.name} copy`,
      updatedAt: new Date().toISOString(),
    };
    persistMessageTemplates([copy, ...messageTemplates].slice(0, 12));
    setActiveTemplateId(copy.id);
    setStatus("Template duplicated locally.");
  }

  function resetTemplates() {
    persistMessageTemplates(defaultMessageTemplates);
    setActiveTemplateId(defaultMessageTemplates[0].id);
    setStatus("Templates reset to prototype defaults.");
  }

  function sendTemplatePreview() {
    const draft = templatePreviewDraft;
    const message = {
      id: `template-preview-${Date.now()}`,
      createdAt: new Date().toISOString(),
      template: activeTemplate.name,
      recipient: draft.parentEmail || activeFamily.email || "parent@example.com",
      bookingId: draft.id,
      subject: renderTemplateText(activeTemplate.subject, draft),
      body: renderTemplateText(activeTemplate.body, draft),
    };
    persistMessages([message, ...messageLog].slice(0, 50));
    setStatus(`${activeTemplate.name} preview sent to local message log.`);
  }

  function persistSupportTickets(nextTickets) {
    setSupportTickets(nextTickets);
    localStorage.setItem("apres-booking-lab-support-tickets", JSON.stringify(nextTickets));
  }

  function persistSupportNotes(nextNotes) {
    setSupportNotes(nextNotes);
    localStorage.setItem("apres-booking-lab-support-notes", JSON.stringify(nextNotes));
  }

  function persistStaffAssignments(nextAssignments) {
    setStaffAssignments(nextAssignments);
    localStorage.setItem("apres-booking-lab-staff-assignments", JSON.stringify(nextAssignments));
  }

  function persistCapacityOverrides(nextOverrides) {
    setCapacityOverrides(nextOverrides);
    localStorage.setItem("apres-booking-lab-capacity-overrides", JSON.stringify(nextOverrides));
  }

  function seedWaitlistDemand() {
    const parents = [
      ["Hannah Lee", "hannah.lee@example.com", ["Theo"]],
      ["Marcus King", "marcus.king@example.com", ["Nora", "Max"]],
      ["Gemma Stone", "gemma.stone@example.com", ["Luca"]],
      ["Omar Hassan", "omar.hassan@example.com", ["Yasmin"]],
    ];
    const now = Date.now();
    const seeded = parents.map(([parentName, parentEmail, children], index) => {
      const days = capacitySession.days.slice(index % 2, Math.min(capacitySession.days.length, (index % 2) + 2));
      return {
        id: `waitlist-booking-${now}-${index}`,
        createdAt: new Date(now + index).toISOString(),
        sessionId: capacitySession.id,
        site: capacitySession.site,
        activity: capacitySession.title,
        days: days.length ? days : [capacitySession.days[0]],
        children,
        childCount: children.length,
        addOns: [],
        total: capacitySession.price * children.length * (days.length || 1),
        paymentMethod: "card",
        parentName,
        parentEmail,
        childName: children[0],
        collector: parentName,
        emergencyPhone: `07${String(200000000 + index * 61337).slice(0, 9)}`,
        medicalNotes: "",
        consents: { terms: true, emergency: true, data: true },
        status: "Waitlist",
        waitlistRank: index + 1,
      };
    });
    persistDrafts([...seeded, ...drafts].slice(0, 34));
    setStatus(`${seeded.length} waitlist requests seeded for ${capacitySession.site}.`);
  }

  function updateDayCapacity(day, delta) {
    const key = `${capacitySession.id}-${day}`;
    const current = Number(capacityOverrides[key] || capacitySession.capacity);
    const next = Math.max(0, current + delta);
    persistCapacityOverrides({ ...capacityOverrides, [key]: next });
    setStatus(`${day} capacity changed to ${next}.`);
  }

  function sendWaitlistOffer(draft) {
    const message = {
      id: `waitlist-offer-${Date.now()}`,
      createdAt: new Date().toISOString(),
      template: "Waitlist offer",
      recipient: draft.parentEmail || "parent@example.com",
      bookingId: draft.id,
      subject: `Waitlist space available · ${draft.activity}`,
      body: `Hi ${draft.parentName || "there"}, a space may be available for ${draft.activity} at ${draft.site}. Please confirm within ${rules.paymentDueHours} hours so we can move you from the waitlist.`,
    };
    persistMessages([message, ...messageLog].slice(0, 50));
    setStatus(`Waitlist offer sent to ${draft.parentName || "parent"}.`);
  }

  function promoteWaitlistBooking(id) {
    const target = drafts.find((draft) => draft.id === id);
    if (!target) return;
    const nextDrafts = drafts.map((draft) => draft.id === id ? {
      ...draft,
      status: target.paymentMethod === "card" ? "Payment reference pending" : "Payment reference pending",
      promotedAt: new Date().toISOString(),
      waitlistRank: null,
      updatedAt: new Date().toISOString(),
    } : draft);
    persistDrafts(nextDrafts);
    sendWaitlistOffer(target);
    setStatus(`${target.parentName || "Parent"} promoted from waitlist.`);
  }

  function exportCapacityPlan() {
    const rows = [
      ["Day", "Capacity", "Confirmed children", "Waitlist children", "Open spaces", "Fill %", "Overbooked"],
      ...capacityRows.map((row) => [
        row.day,
        row.capacity,
        row.confirmed,
        row.waitlist,
        row.spaces,
        row.fill,
        row.overbooked ? "Yes" : "No",
      ]),
    ];
    downloadTextFile("apres-booking-lab-capacity-plan.csv", rows.map((row) => row.map(csvEscape).join(",")).join("\n"), "text/csv");
  }

  function seedStaffingPlan() {
    const nextAssignments = staffingSession.days.flatMap((day, dayIndex) => {
      const preferred = labStaffRoster.filter((staff) => staff.sites.includes(staffingSession.site));
      const staffForDay = [
        preferred[dayIndex % preferred.length] || labStaffRoster[dayIndex % labStaffRoster.length],
        preferred[(dayIndex + 1) % preferred.length] || labStaffRoster[(dayIndex + 1) % labStaffRoster.length],
      ].filter(Boolean);
      return staffForDay.map((staff, index) => ({
        id: `staffing-${staffingSession.id}-${day}-${staff.id}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase(),
        sessionId: staffingSession.id,
        day,
        staffId: staff.id,
        status: "Assigned",
        role: index === 0 ? "Lead" : "Support",
        createdAt: new Date().toISOString(),
      }));
    });
    const others = staffAssignments.filter((assignment) => assignment.sessionId !== staffingSession.id);
    persistStaffAssignments([...nextAssignments, ...others]);
    setStatus(`Staffing plan seeded for ${staffingSession.site}.`);
  }

  function toggleStaffAssignment(day, staffId) {
    const existing = staffAssignments.find((assignment) => assignment.sessionId === staffingSession.id && assignment.day === day && assignment.staffId === staffId);
    if (existing) {
      persistStaffAssignments(staffAssignments.filter((assignment) => assignment.id !== existing.id));
      setStatus("Staff assignment removed.");
      return;
    }
    const staff = labStaffRoster.find((item) => item.id === staffId);
    const assignment = {
      id: `staffing-${staffingSession.id}-${day}-${staffId}-${Date.now()}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase(),
      sessionId: staffingSession.id,
      day,
      staffId,
      status: "Assigned",
      role: staff?.qualified ? "Lead" : "Support",
      createdAt: new Date().toISOString(),
    };
    persistStaffAssignments([assignment, ...staffAssignments]);
    setStatus(`${staff?.name || "Staff"} assigned to ${day}.`);
  }

  function markStaffAbsent(day, staffId) {
    const nextAssignments = staffAssignments.map((assignment) => (
      assignment.sessionId === staffingSession.id && assignment.day === day && assignment.staffId === staffId
        ? { ...assignment, status: assignment.status === "Absent" ? "Assigned" : "Absent", updatedAt: new Date().toISOString() }
        : assignment
    ));
    persistStaffAssignments(nextAssignments);
    setStatus("Staff absence toggled for rota testing.");
  }

  function exportStaffingPlan() {
    const rows = [
      ["Day", "Children", "Required staff", "Assigned staff", "Qualified leads", "First aid", "Covered"],
      ...staffingRows.map((row) => [
        row.day,
        row.children,
        row.required,
        row.assignments.map((assignment) => labStaffRoster.find((staff) => staff.id === assignment.staffId)?.name || assignment.staffId).join("; "),
        row.qualified,
        row.firstAid ? "Yes" : "No",
        row.covered ? "Yes" : "No",
      ]),
    ];
    downloadTextFile("apres-booking-lab-staffing-plan.csv", rows.map((row) => row.map(csvEscape).join(",")).join("\n"), "text/csv");
  }

  function ensureSupportRows() {
    if (drafts.length) return;
    seedPilotLaunch();
    setStatus("Support console seeded with a pilot parent cohort.");
  }

  function createSupportTicket(type = "Parent query") {
    if (!activeSupportRow) {
      setStatus("Select or seed a booking before creating a support ticket.");
      return;
    }
    const ticket = {
      id: `support-ticket-${Date.now()}`,
      bookingId: activeSupportRow.id,
      parent: activeSupportRow.parent,
      email: activeSupportRow.email,
      type,
      status: "Open",
      priority: type === "Safeguarding note" ? "High" : "Normal",
      createdAt: new Date().toISOString(),
    };
    persistSupportTickets([ticket, ...supportTickets].slice(0, 40));
    setStatus(`${type} ticket opened for ${activeSupportRow.parent}.`);
  }

  function resolveSupportTicket(id) {
    persistSupportTickets(supportTickets.map((ticket) => ticket.id === id ? { ...ticket, status: "Resolved", resolvedAt: new Date().toISOString() } : ticket));
    setStatus("Support ticket resolved locally.");
  }

  function addSupportNote(event) {
    event.preventDefault();
    if (!activeSupportRow) return;
    const form = new FormData(event.currentTarget);
    const body = String(form.get("supportNote") || "").trim();
    if (!body) return;
    const note = {
      id: `support-note-${Date.now()}`,
      bookingId: activeSupportRow.id,
      parent: activeSupportRow.parent,
      body,
      createdAt: new Date().toISOString(),
      author: activeRole,
    };
    persistSupportNotes([note, ...supportNotes].slice(0, 60));
    event.currentTarget.reset();
    setStatus("Internal support note saved locally.");
  }

  function resendSupportConfirmation() {
    if (!activeSupportRow) return;
    sendLabMessage(activeSupportRow.draft, "Confirmation");
    setStatus(`Confirmation resent to ${activeSupportRow.email || activeSupportRow.parent}.`);
  }

  function applySupportOverride() {
    if (!activeSupportRow) return;
    const nextDrafts = drafts.map((draft) => draft.id === activeSupportRow.id ? {
      ...draft,
      supportOverride: {
        reason: "Support console manual exception",
        appliedAt: new Date().toISOString(),
        appliedBy: activeRole,
      },
      status: draft.status === "Waitlist" ? "Payment reference pending" : draft.status,
      updatedAt: new Date().toISOString(),
    } : draft);
    persistDrafts(nextDrafts);
    setStatus("Support override recorded on the booking.");
  }

  function exportSupportCase() {
    if (!activeSupportRow) return;
    const lines = [
      "# Après Booking Lab Support Case",
      "",
      `Parent: ${activeSupportRow.parent}`,
      `Email: ${activeSupportRow.email}`,
      `Children: ${activeSupportRow.children}`,
      `Booking: ${activeSupportRow.draft.activity} at ${activeSupportRow.draft.site}`,
      `Status: ${activeSupportRow.draft.status}`,
      `Total: ${money(Number(activeSupportRow.draft.total || 0))}`,
      "",
      "## Tickets",
      ...supportTickets.filter((ticket) => ticket.bookingId === activeSupportRow.id).map((ticket) => `- ${ticket.status}: ${ticket.type} (${ticket.priority})`),
      "",
      "## Notes",
      ...activeSupportNotes.map((note) => `- ${note.author}: ${note.body}`),
      "",
      "## Messages",
      ...activeSupportMessages.map((message) => `- ${message.subject}: ${message.recipient}`),
    ];
    downloadTextFile("apres-booking-lab-support-case.md", lines.join("\n"));
  }

  function messageFor(draft, template) {
    if (template === "Payment reminder") {
      return `Hi ${draft.parentName || "there"}, your ${draft.activity} booking at ${draft.site} is reserved. Please complete payment or send your voucher/TFC reference so we can reconcile your place.`;
    }
    if (template === "Incident follow-up") {
      return `Hi ${draft.parentName || "there"}, we have added a care note for ${draft.children?.join(", ") || draft.childName}. A member of the team can talk this through at collection.`;
    }
    if (template === "Missing info") {
      return `Hi ${draft.parentName || "there"}, please check your booking details for ${draft.activity}. We still need complete collection, emergency or medical information before the session.`;
    }
    return `Hi ${draft.parentName || "there"}, your ${draft.activity} booking at ${draft.site} is confirmed for ${(draft.days || []).join(", ")}. Total: ${money(Number(draft.total || 0))}.`;
  }

  function sendLabMessage(draft, template) {
    const message = {
      id: `lab-message-${Date.now()}`,
      createdAt: new Date().toISOString(),
      template,
      recipient: draft.parentEmail || "parent@example.com",
      bookingId: draft.id,
      subject: `${template} · ${draft.activity}`,
      body: messageFor(draft, template),
    };
    persistMessages([message, ...messageLog].slice(0, 30));
  }

  function exportReport(kind) {
    if (kind === "occupancy") {
      const rows = [["Activity", "Site", "Type", "Booked sessions", "Capacity", "Fill %", "Waitlist", "Revenue"], ...occupancyRows.map((row) => [
        row.session.title,
        row.session.site,
        row.session.type,
        row.booked,
        row.capacity,
        row.fill,
        row.waitlist,
        row.revenue,
      ])];
      downloadTextFile("apres-booking-lab-occupancy.csv", rows.map((row) => row.map(csvEscape).join(",")).join("\n"), "text/csv");
      return;
    }
    if (kind === "finance") {
      const rows = [["Parent", "Site", "Activity", "Status", "Payment method", "Reference", "Total", "Credit"], ...financeRows.map((row) => [
        row.parent,
        row.site,
        row.activity,
        row.status,
        row.method,
        row.reference,
        row.total,
        row.credit,
      ])];
      downloadTextFile("apres-booking-lab-finance.csv", rows.map((row) => row.map(csvEscape).join(",")).join("\n"), "text/csv");
      return;
    }
    const rows = [["Children", "Site", "Activity", "Collector", "Emergency phone", "Flags", "Notes"], ...medicalRows.map((row) => [
      row.children,
      row.site,
      row.activity,
      row.collector,
      row.emergencyPhone,
      row.flags,
      row.notes,
    ])];
    downloadTextFile("apres-booking-lab-medical-summary.csv", rows.map((row) => row.map(csvEscape).join(",")).join("\n"), "text/csv");
  }

  function exportSettlementBatch() {
    const rows = [
      ["Parent", "Site", "Activity", "Payment method", "Reference", "Amount", "Credit", "Status", "Created"],
      ...referenceRows.map((row) => [
        row.parent,
        row.site,
        row.activity,
        row.method,
        row.reference || "Missing reference",
        row.total,
        row.credit,
        row.status,
        row.createdAt || "",
      ]),
    ];
    downloadTextFile("apres-booking-lab-settlement-batch.csv", rows.map((row) => row.map(csvEscape).join(",")).join("\n"), "text/csv");
  }

  function exportCreditLedger() {
    const rows = [
      ["Parent", "Email", "Site", "Activity", "Booking", "Type", "Reason", "Amount", "Status", "Created", "Resolved"],
      ...creditEvents.map((event) => [
        event.parentName,
        event.parentEmail,
        event.site,
        event.activity,
        event.bookingId,
        event.type || "Credit",
        event.reason || "",
        event.amount,
        event.status,
        event.createdAt || "",
        event.resolvedAt || "",
      ]),
    ];
    downloadTextFile("apres-booking-lab-credit-ledger.csv", rows.map((row) => row.map(csvEscape).join(",")).join("\n"), "text/csv");
  }

  function updateCreditEvent(bookingId, eventId, nextStatus, extras = {}) {
    const nextDrafts = drafts.map((draft) => {
      if (draft.id !== bookingId) return draft;
      return {
        ...draft,
        creditEvents: (draft.creditEvents || []).map((event, index) => {
          const currentId = event.id || `credit-${draft.id}-${index}`;
          return currentId === eventId ? {
            ...event,
            id: currentId,
            status: nextStatus,
            resolvedAt: ["Refunded", "Applied"].includes(nextStatus) ? new Date().toISOString() : event.resolvedAt,
            ...extras,
          } : event;
        }),
        updatedAt: new Date().toISOString(),
      };
    });
    persistDrafts(nextDrafts);
  }

  function markCreditRefunded(event) {
    updateCreditEvent(event.bookingId, event.eventId, "Refunded", { resolution: "Refunded to original payment route" });
    setStatus(`Credit marked refunded: ${money(event.amount)}.`);
  }

  function keepCreditOnAccount(event) {
    updateCreditEvent(event.bookingId, event.eventId, "Account credit", { resolution: "Held on parent account" });
    setStatus(`Credit kept on account: ${money(event.amount)}.`);
  }

  function applyCreditToOutstanding(event) {
    const target = drafts.find((draft) => (
      draft.id !== event.bookingId
      && draft.parentEmail === event.parentEmail
      && !["Prototype paid", "Cancelled"].includes(draft.status)
      && Number(draft.total || 0) > 0
    ));
    if (!target) {
      setStatus("No outstanding booking found for this parent credit.");
      return;
    }
    const appliedAmount = Math.min(event.amount, Number(target.total || 0));
    const nextDrafts = drafts.map((draft) => {
      if (draft.id === target.id) {
        const nextTotal = Math.max(0, Number(draft.total || 0) - appliedAmount);
        return {
          ...draft,
          total: nextTotal,
          status: nextTotal === 0 ? "Prototype paid" : draft.status,
          creditApplications: [
            ...(draft.creditApplications || []),
            { creditBookingId: event.bookingId, creditEventId: event.eventId, amount: appliedAmount, appliedAt: new Date().toISOString() },
          ],
          updatedAt: new Date().toISOString(),
        };
      }
      if (draft.id === event.bookingId) {
        return {
          ...draft,
          creditEvents: (draft.creditEvents || []).map((creditEvent, index) => {
            const currentId = creditEvent.id || `credit-${draft.id}-${index}`;
            return currentId === event.eventId ? {
              ...creditEvent,
              id: currentId,
              status: "Applied",
              appliedTo: target.id,
              appliedAmount,
              resolvedAt: new Date().toISOString(),
            } : creditEvent;
          }),
          updatedAt: new Date().toISOString(),
        };
      }
      return draft;
    });
    persistDrafts(nextDrafts);
    setStatus(`Applied ${money(appliedAmount)} credit to ${target.activity}.`);
  }

  function reconcileReferencePayments() {
    const ids = new Set(pendingWithReference.map((row) => row.id));
    if (!ids.size) {
      setStatus("No voucher, TFC or invoice payments have references ready to reconcile.");
      return;
    }
    const nextDrafts = drafts.map((draft) => ids.has(draft.id)
      ? { ...draft, status: "Prototype paid", reconciledAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      : draft);
    persistDrafts(nextDrafts);
    setStatus(`${ids.size} referenced payment${ids.size === 1 ? "" : "s"} reconciled locally.`);
  }

  function updateDraftStatus(id, nextStatus) {
    const nextDrafts = drafts.map((draft) => draft.id === id ? { ...draft, status: nextStatus, updatedAt: new Date().toISOString() } : draft);
    persistDrafts(nextDrafts);
  }

  function startParentAmendment(id) {
    const draft = drafts.find((item) => item.id === id);
    if (!draft) return;
    setAmendment({
      id: draft.id,
      sessionId: draft.sessionId,
      activity: draft.activity,
      site: draft.site,
      days: [...(draft.days || [])],
      children: [...(draft.children || (draft.childName ? [draft.childName] : []))],
      addOns: [...(draft.addOns || [])],
      paymentMethod: draft.paymentMethod || "card",
      paymentReference: draft.paymentReference || "",
      status: draft.status || "Amendment draft",
    });
    setStatus("Amendment editor opened for the selected booking.");
  }

  function updateAmendmentField(field, value) {
    setAmendment((current) => current ? { ...current, [field]: value } : current);
  }

  function toggleAmendmentDay(day) {
    setAmendment((current) => {
      if (!current) return current;
      const days = current.days || [];
      return { ...current, days: days.includes(day) ? days.filter((item) => item !== day) : [...days, day] };
    });
  }

  function toggleAmendmentChild(name) {
    setAmendment((current) => {
      if (!current) return current;
      const children = current.children || [];
      return { ...current, children: children.includes(name) ? children.filter((item) => item !== name) : [...children, name] };
    });
  }

  function toggleAmendmentAddOn(label) {
    setAmendment((current) => {
      if (!current) return current;
      const addOns = current.addOns || [];
      return { ...current, addOns: addOns.includes(label) ? addOns.filter((item) => item !== label) : [...addOns, label] };
    });
  }

  function saveParentAmendment() {
    if (!amendment || !amendmentSession) return;
    if (!amendment.days.length || !amendment.children.length) {
      setStatus("Amendment needs at least one day and one child.");
      return;
    }
    const nextStatus = amendment.paymentMethod === "card"
      ? "Prototype paid"
      : amendmentTotal > 0
        ? "Payment reference pending"
        : "Amended";
    const nextDrafts = drafts.map((draft) => draft.id === amendment.id ? {
      ...draft,
      days: amendment.days,
      children: amendment.children,
      childCount: amendment.children.length,
      childName: amendment.children[0] || draft.childName,
      addOns: amendment.addOns,
      paymentMethod: amendment.paymentMethod,
      paymentReference: amendment.paymentReference,
      status: nextStatus,
      total: amendmentTotal,
      amendedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      creditEvents: [
        ...(draft.creditEvents || []),
        ...(amendmentDelta < 0 ? [{
          id: `credit-${Date.now()}`,
          amount: Math.abs(amendmentDelta),
          createdAt: new Date().toISOString(),
          reason: "Amendment reduced booking value",
          type: "Amendment credit",
        }] : []),
      ],
      amendmentHistory: [
        ...(draft.amendmentHistory || []),
        {
          at: new Date().toISOString(),
          fromTotal: Number(draft.total || 0),
          toTotal: amendmentTotal,
          delta: amendmentTotal - Number(draft.total || 0),
          days: amendment.days,
          children: amendment.children,
          addOns: amendment.addOns,
          paymentMethod: amendment.paymentMethod,
        },
      ],
    } : draft);
    persistDrafts(nextDrafts);
    setConfirmation(nextDrafts.find((draft) => draft.id === amendment.id) || null);
    setAmendment(null);
    setStatus(amendmentDelta < 0
      ? `Booking amended in place. Credit created: ${money(Math.abs(amendmentDelta))}.`
      : `Booking amended in place. Additional amount: ${money(amendmentDelta)}.`);
  }

  function duplicateDraft(id) {
    const draft = drafts.find((item) => item.id === id);
    if (!draft) return;
    const copy = { ...draft, id: `lab-booking-${Date.now()}`, createdAt: new Date().toISOString(), status: "Amendment draft" };
    persistDrafts([copy, ...drafts].slice(0, 20));
  }

  function amendParentBooking(id) {
    startParentAmendment(id);
  }

  function cancelParentBooking(id) {
    const draft = drafts.find((item) => item.id === id);
    if (!draft) return;
    const creditAmount = draft.status === "Prototype paid" ? Number(draft.total || 0) : 0;
    const nextDrafts = drafts.map((item) => item.id === id ? {
      ...item,
      status: "Cancelled",
      cancelledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      creditEvents: [
        ...(item.creditEvents || []),
        ...(creditAmount > 0 ? [{
          id: `credit-${Date.now()}`,
          amount: creditAmount,
          createdAt: new Date().toISOString(),
          reason: `Cancelled under ${rules.cancellationHours}h policy`,
          type: "Cancellation credit",
        }] : []),
      ],
    } : item);
    persistDrafts(nextDrafts);
    setStatus(creditAmount > 0
      ? `Booking cancelled. Parent credit created: ${money(creditAmount)}.`
      : `Booking cancelled under the ${rules.cancellationHours}h cancellation policy.`);
  }

  function payParentBooking(id) {
    updateDraftStatus(id, "Prototype paid");
    setStatus("Prototype payment marked as received.");
  }

  function downloadReceipt(draft) {
    const receipt = [
      "Après School prototype receipt",
      `Receipt: ${draft.id}`,
      `Parent: ${draft.parentName || activeFamily.parentName}`,
      `Email: ${draft.parentEmail || activeFamily.email}`,
      `Activity: ${draft.activity}`,
      `Site: ${draft.site}`,
      `Dates: ${(draft.days || []).join(", ")}`,
      `Children: ${(draft.children || [draft.childName]).join(", ")}`,
      `Payment method: ${draft.paymentMethod || "card"}`,
      `Status: ${draft.status}`,
      `Total: ${money(Number(draft.total || 0))}`,
      "",
      "Prototype only. No live payment has been processed unless connected to a real payment provider.",
    ].join("\n");
    downloadTextFile(`apres-receipt-${draft.id}.txt`, receipt);
  }

  function createActivity(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const days = String(form.get("days") || "")
      .split(",")
      .map((day) => day.trim())
      .filter(Boolean);
    const activity = {
      id: `custom-${Date.now()}`,
      site: form.get("site") || "New site",
      area: form.get("area") || "Local",
      type: form.get("type") || "Wraparound",
      title: form.get("title") || "New activity",
      time: form.get("time") || "15:00-18:00",
      price: Number(form.get("price") || 0),
      age: form.get("age") || "Eligible children",
      capacity: Number(form.get("capacity") || 12),
      days: days.length ? days : ["Mon 8 Jun", "Tue 9 Jun", "Wed 10 Jun", "Thu 11 Jun", "Fri 12 Jun"],
      features: String(form.get("features") || "Draft activity")
        .split(",")
        .map((feature) => feature.trim())
        .filter(Boolean),
      custom: true,
    };
    const next = [activity, ...customSessions].slice(0, 12);
    setCustomSessions(next);
    localStorage.setItem("apres-booking-lab-activities", JSON.stringify(next));
    setActiveId(activity.id);
    setStatus("Prototype activity created and added to the parent booking flow.");
    event.currentTarget.reset();
  }

  function createLaunchPlan(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const days = String(form.get("days") || "")
      .split(",")
      .map((day) => day.trim())
      .filter(Boolean);
    const plan = {
      id: `launch-${Date.now()}`,
      createdAt: new Date().toISOString(),
      site: form.get("site") || "New site",
      area: form.get("area") || "",
      schoolContact: form.get("schoolContact") || "",
      activity: form.get("activity") || "After-school care",
      type: form.get("type") || "Wraparound",
      time: form.get("time") || "15:00-18:00",
      price: Number(form.get("price") || 0),
      capacity: Number(form.get("capacity") || 16),
      ratio: form.get("ratio") || "1:8",
      paymentMethods: Array.from(form.getAll("paymentMethods")),
      days: days.length ? days : ["Mon 8 Jun", "Tue 9 Jun", "Wed 10 Jun"],
      checklist: {
        safeguarding: Boolean(form.get("safeguarding")),
        registers: Boolean(form.get("registers")),
        payment: Boolean(form.get("payment")),
        comms: Boolean(form.get("comms")),
      },
      status: "Draft launch",
    };
    const activity = {
      id: `custom-${Date.now()}`,
      site: plan.site,
      area: plan.area,
      type: plan.type,
      title: plan.activity,
      time: plan.time,
      price: plan.price,
      age: plan.type === "Wraparound" ? `${plan.site} pupils` : "Open to eligible children",
      capacity: plan.capacity,
      days: plan.days,
      features: [`Ratio ${plan.ratio}`, `${plan.paymentMethods.length || 1} payment routes`, "Launch wizard"],
      custom: true,
    };
    const nextPlans = [plan, ...launchPlans].slice(0, 12);
    const nextSessions = [activity, ...customSessions].slice(0, 12);
    setLaunchPlans(nextPlans);
    setCustomSessions(nextSessions);
    localStorage.setItem("apres-booking-lab-launch-plans", JSON.stringify(nextPlans));
    localStorage.setItem("apres-booking-lab-activities", JSON.stringify(nextSessions));
    setActiveId(activity.id);
    setStatus("Launch plan created and activity added to the booking catalogue.");
    event.currentTarget.reset();
  }

  function exportSchemaNotes() {
    const lines = [
      "# Après Booking Lab Data Model",
      "",
      "## Entities",
      ...labDataEntities.flatMap(([name, description, relations]) => [
        `### ${name}`,
        description,
        `Related: ${relations}`,
        "",
      ]),
      "## Integrations",
      ...labIntegrations.map(([name, description]) => `- ${name}: ${description}`),
      "",
      "## Role Access Matrix",
      ...labRoleAccessMatrix.map(([role, data, actions]) => `- ${role}: ${data}. ${actions}`),
      "",
      "## API Contracts",
      ...labApiContracts.map(([method, path, role, purpose]) => `- ${method} ${path} (${role}): ${purpose}`),
      "",
      "## RLS Policies",
      ...labRlsPolicies.map(([table, policy]) => `- ${table}: ${policy}`),
      "",
      "## Core Flows",
      "- Family creates/reuses child profiles.",
      "- Parent books one or more sessions for one or more children.",
      "- Booking creates payment state, register rows and message events.",
      "- Staff update register rows with attendance, incident and collection events.",
      "- Admin reconciles payments, manages rules and exports reports.",
    ];
    downloadTextFile("apres-booking-lab-data-model.md", lines.join("\n"));
  }

  function exportReadinessPlan() {
    const lines = [
      "# Après Booking Lab Production Readiness",
      "",
      "## Gap Analysis",
      ...readinessItems.flatMap(([area, current, needed]) => [
        `### ${area}`,
        `Current: ${current}`,
        `Needed: ${needed}`,
        "",
      ]),
      "## Risk Register",
      ...readinessRisks.map(([level, risk, mitigation]) => `- ${level}: ${risk} — ${mitigation}`),
      "",
      "## Build Phases",
      ...readinessPhases.map(([phase, title, detail]) => `${phase}. ${title}: ${detail}`),
      "",
      "## Go / No-Go Checklist",
      "- Backend RLS tested with parent, staff, manager and admin roles.",
      "- Payment webhooks and reconciliation tested with failed/partial/refund cases.",
      "- Medical and incident access reviewed.",
      "- One-site pilot activity configured from Setup wizard assumptions.",
      "- Parent support scripts and rollback path agreed.",
    ];
    downloadTextFile("apres-booking-lab-production-readiness.md", lines.join("\n"));
  }

  function saveRules(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextRules = {
      cancellationHours: Number(form.get("cancellationHours") || defaultLabRules.cancellationHours),
      amendmentHours: Number(form.get("amendmentHours") || defaultLabRules.amendmentHours),
      paymentDueHours: Number(form.get("paymentDueHours") || defaultLabRules.paymentDueHours),
      siblingDiscountPercent: Number(form.get("siblingDiscountPercent") || 0),
      fullWeekDiscountPercent: Number(form.get("fullWeekDiscountPercent") || 0),
      promoCode: form.get("promoCode") || "",
      promoDiscountPercent: Number(form.get("promoDiscountPercent") || 0),
      autoWaitlistAtPercent: Number(form.get("autoWaitlistAtPercent") || 100),
      allowAdminOverride: Boolean(form.get("allowAdminOverride")),
      schoolOnlyStrict: Boolean(form.get("schoolOnlyStrict")),
      holidayYearMin: form.get("holidayYearMin") || "Reception",
      holidayYearMax: form.get("holidayYearMax") || "Year 6",
    };
    setRules(nextRules);
    localStorage.setItem("apres-booking-lab-rules", JSON.stringify(nextRules));
    setStatus("Rules saved locally and applied to the booking flow.");
  }

  function submitBooking(event) {
    event.preventDefault();
    if (!pickedDays.length) {
      setStatus("Choose at least one session before checkout.");
      return;
    }
    if (rulesBlocked) {
      setStatus("Booking blocked by the rules engine. Use an admin override or adjust the selected children/activity.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const booking = {
      id: `lab-booking-${Date.now()}`,
      createdAt: new Date().toISOString(),
      sessionId: activeSession.id,
      site: activeSession.site,
      activity: activeSession.title,
      days: pickedDays,
      children: selectedChildren.map((child) => child.name),
      childCount,
      addOns: availableAddOns.filter((item) => selectedAddOns.includes(item.id)).map((item) => item.label),
      total,
      paymentMethod,
      paymentReference: form.get("paymentReference"),
      promoCode: promoCode.trim().toUpperCase(),
      rulesSnapshot: rules,
      override: adminOverride ? { reason: overrideReason, appliedAt: new Date().toISOString() } : null,
      parentName: form.get("parentName"),
      parentEmail: form.get("parentEmail"),
      childName: form.get("childName"),
      collector: form.get("collector"),
      emergencyPhone: form.get("emergencyPhone"),
      medicalNotes: form.get("medicalNotes"),
      consents: {
        terms: Boolean(form.get("terms")),
        emergency: Boolean(form.get("emergencyConsent")),
        data: Boolean(form.get("dataConsent")),
      },
      status: paymentMethod === "card" && !isWaitlist ? "Prototype paid" : isWaitlist ? "Waitlist" : "Payment reference pending",
    };
    const nextDrafts = [booking, ...drafts].slice(0, 20);
    persistDrafts(nextDrafts);
    setConfirmation(booking);
    addAuditLog("Booking lab draft created", `${booking.parentName} drafted ${booking.activity} at ${booking.site}`);
    setStatus(isWaitlist
      ? "Prototype waitlist request saved because selected places exceed current capacity."
      : paymentMethod === "card"
        ? "Prototype booking saved. No real payment has been taken."
        : "Prototype booking saved with payment reconciliation pending.");
  }

  return (
    <section className="page-shell">
      <div className="section-heading narrow"><p className="eyebrow">Booking Lab</p><h1>A local prototype for an Après booking system.</h1></div>
      <section className="lab-hero">
        <div>
          <p className="eyebrow">Experimental only</p>
          <h2>One journey for wraparound care, camps, registers and payments.</h2>
          <p>Parents find the right place first, then choose sessions, add child details, review availability and complete checkout without bouncing between systems.</p>
          <div className="lab-hero-actions">
            <button className="button book large" type="button" onClick={() => document.getElementById("booking-lab-flow")?.scrollIntoView({ behavior: "smooth" })}>Build a Booking</button>
            <button className="button light" type="button" onClick={() => setPage("Bookings")}>Back to Live Routes</button>
          </div>
        </div>
        <aside>
          <strong>No live charge</strong>
          <span>Payment UI is modelled locally for product testing.</span>
          <span>Draft bookings save to this browser only.</span>
        </aside>
      </section>

      <section className="lab-view-tabs" aria-label="Booking lab views">
        {["Parent", "Family", "Operations", "Setup", "Pilot", "Payments", "Support", "Staffing", "Capacity", "Comms", "QA", "Data Model", "Readiness"].map((view) => (
          <button className={labView === view ? "active" : ""} disabled={!canView(view)} key={view} type="button" onClick={() => setLabView(view)}>{view}</button>
        ))}
      </section>

      <section className="lab-role-shell" aria-label="Role dashboards">
        <div className="lab-role-switcher">
          {Object.keys(roleDashboards).map((role) => (
            <button className={activeRole === role ? "active" : ""} key={role} type="button" onClick={() => chooseRole(role)}>{role}</button>
          ))}
        </div>
        <div className={`lab-role-dashboard role-${activeRole.toLowerCase()}`}>
          <div>
            <p className="eyebrow">Role dashboard</p>
            <h2>{activeRoleDashboard.title}</h2>
            <p>{activeRoleDashboard.text}</p>
          </div>
          <div className="lab-role-metrics">
            {activeRoleDashboard.metrics.map(([label, value]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
          <div className="lab-role-actions">
            {activeRoleDashboard.actions.map(([label, view]) => (
              <button key={label} type="button" onClick={() => runRoleAction(view)}>{label}</button>
            ))}
          </div>
        </div>
      </section>

      <section className="lab-permission-strip">
        <strong>{activeRole} permissions</strong>
        <span>{activeRole === "Manager" ? "Full prototype access" : `Allowed: ${rolePermissions[activeRole].actions.join(", ")}`}</span>
        <small>{activeRole === "Manager" ? "Manager can inspect parent, staff, finance and setup workflows." : "Locked controls stay visible only where useful for context."}</small>
      </section>

      <section className="lab-principles" aria-label="Prototype goals">
        {[
          ["Fast discovery", "Search by school, area, care type or camp instead of asking parents to know the platform."],
          ["Flexible sessions", "Support ad-hoc days, block weeks, breakfast, after-school and holiday camp patterns."],
          ["Operational data", "Booking details can feed registers, medical notes, authorised collectors and admin reporting."],
          ["Payment ready", "Model cards, Tax-Free Childcare and vouchers with reconciliation status from the start."],
        ].map(([title, text]) => (
          <article key={title}>
            <strong>{title}</strong>
            <p>{text}</p>
          </article>
        ))}
      </section>

      {labView === "Operations" && (
        <section className="lab-ops">
          <div className="lab-ops-metrics">
            <article><span>Draft bookings</span><strong>{drafts.length}</strong></article>
            <article><span>Confirmed places</span><strong>{opsConfirmed}</strong></article>
            <article><span>Children booked</span><strong>{opsChildren}</strong></article>
            <article><span>Prototype revenue</span><strong>{money(opsRevenue)}</strong></article>
            <article><span>Payments to reconcile</span><strong>{opsPaymentDue}</strong></article>
            <article><span>Incident notes</span><strong>{openIncidents}</strong></article>
          </div>
          {can("register") && <section className="lab-register-console">
            <div className="lab-register-head">
              <div>
                <p className="eyebrow">Daily register</p>
                <h2>{activeSession.site}</h2>
                <p>{activeSession.title} · {activeSession.time}</p>
              </div>
              <div className="lab-register-tools">
                <label>Register date<select value={registerDay} onChange={(event) => setRegisterDay(event.target.value)}>
                  {activeSession.days.map((day) => <option key={day}>{day}</option>)}
                </select></label>
                <div className="lab-register-mode" aria-label="Register display mode">
                  {["Cards", "List"].map((mode) => (
                    <button className={registerMode === mode ? "active" : ""} key={mode} type="button" onClick={() => setRegisterMode(mode)}>{mode}</button>
                  ))}
                </div>
                <button className="button light" type="button" onClick={seedDemoBooking}>Seed Demo</button>
                <button className="button book" type="button" onClick={exportDailyRegister} disabled={!registerRows.length}>Export Register</button>
              </div>
            </div>
            <div className="lab-register-stats">
              {registerCounts.map(([label, count]) => <span key={label}><strong>{count}</strong>{label}</span>)}
            </div>
            <section className="lab-staff-day-board">
              <div className="lab-staff-day-summary">
                <article><span>Completion</span><strong>{registerCompletion}%</strong><small>{checkedOutCount}/{registerRows.length || 0} checked out</small></article>
                <article><span>Care warnings</span><strong>{staffWarnings}</strong><small>Medical, collector or handover notes</small></article>
                <article><span>Active day</span><strong>{registerDay}</strong><small>{activeSession.time}</small></article>
              </div>
              <div className="lab-bulk-register-actions">
                <button type="button" onClick={() => bulkUpdateRegister("Checked in")} disabled={!registerRows.length}>Bulk Check-in</button>
                <button type="button" onClick={() => bulkUpdateRegister("Checked out")} disabled={!registerRows.length}>Bulk Check-out</button>
                <button type="button" onClick={() => bulkUpdateRegister("Absent")} disabled={!registerRows.length}>Mark All Absent</button>
              </div>
            </section>
            {registerMode === "Cards" ? (
              <div className="lab-staff-card-grid">
                {registerRows.map((row) => (
                  <article key={row.rowId} className={`status-${row.status.toLowerCase().replace(/\s+/g, "-")}`}>
                    <div className="lab-staff-card-top">
                      <div>
                        <strong>{row.name}</strong>
                        <span>{row.draft.parentName || "Parent"} · {row.draft.emergencyPhone || "No emergency phone"}</span>
                      </div>
                      <em>{row.status}</em>
                    </div>
                    <div className="lab-staff-warning-strip">
                      <span>{row.collector}</span>
                      <span>{row.flags.length ? row.flags.join(", ") : "No flags"}</span>
                      <span>{row.draft.medicalNotes || "No care notes"}</span>
                    </div>
                    <div className="lab-staff-card-actions">
                      {["Checked in", "Checked out", "Absent", "Late collection"].map((action) => (
                        <button key={action} type="button" onClick={() => updateRegisterRow(row.rowId, action)}>{action}</button>
                      ))}
                    </div>
                    <div className="lab-quick-incidents">
                      {["Medication given", "First aid", "Behaviour note", "Collector query"].map((note) => (
                        <button key={note} type="button" onClick={() => quickRegisterIncident(row.rowId, note)}>{note}</button>
                      ))}
                    </div>
                    <div className="lab-incident-note">
                      <input value={incidentDrafts[row.rowId] || ""} onChange={(event) => setIncidentDrafts((current) => ({ ...current, [row.rowId]: event.target.value }))} placeholder="Incident, medication or handover note" />
                      <button type="button" onClick={() => addRegisterNote(row.rowId)}>Add Note</button>
                    </div>
                    {row.note && <p className="lab-register-note">{row.note}</p>}
                  </article>
                ))}
                {!registerRows.length && (
                  <div className="lab-empty-register">
                    <strong>No children on this register yet.</strong>
                    <p>Complete a parent booking for this activity or use Seed Demo to test staff actions.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="lab-register-rows">
                {registerRows.map((row) => (
                  <article key={row.rowId} className={`status-${row.status.toLowerCase().replace(/\s+/g, "-")}`}>
                    <div className="lab-register-person">
                      <strong>{row.name}</strong>
                      <span>{row.draft.activity} · {row.draft.parentName || "Parent"} · {row.collector}</span>
                      <small>{row.flags.length ? row.flags.join(", ") : "No medical flags"} · {row.draft.medicalNotes || "No notes"}</small>
                    </div>
                    <div className="lab-register-status">
                      <strong>{row.status}</strong>
                      <span>{row.time || "Awaiting action"}</span>
                    </div>
                    <div className="lab-register-actions">
                      {["Checked in", "Checked out", "Absent", "Late collection"].map((action) => (
                        <button key={action} type="button" onClick={() => updateRegisterRow(row.rowId, action)}>{action}</button>
                      ))}
                    </div>
                    <div className="lab-incident-note">
                      <input value={incidentDrafts[row.rowId] || ""} onChange={(event) => setIncidentDrafts((current) => ({ ...current, [row.rowId]: event.target.value }))} placeholder="Incident, medication or handover note" />
                      <button type="button" onClick={() => addRegisterNote(row.rowId)}>Add Note</button>
                    </div>
                    {row.note && <p className="lab-register-note">{row.note}</p>}
                  </article>
                ))}
                {!registerRows.length && (
                  <div className="lab-empty-register">
                    <strong>No children on this register yet.</strong>
                    <p>Complete a parent booking for this activity or use Seed Demo to test staff actions.</p>
                  </div>
                )}
              </div>
            )}
          </section>}
          {can("manage") && <div className="lab-ops-grid">
            <article>
              <p className="eyebrow">Live register preview</p>
              <h2>{activeSession.site}</h2>
              <div className="lab-register-list">
                {drafts.filter((draft) => draft.sessionId === activeSession.id).slice(0, 6).map((draft) => (
                  <div key={draft.id}>
                    <strong>{draft.children?.join(", ") || draft.childName}</strong>
                    <span>{draft.days?.join(", ")}</span>
                    <small>{draft.medicalNotes || "No notes"} · {draft.collector || "Collector not set"}</small>
                  </div>
                ))}
                {!drafts.some((draft) => draft.sessionId === activeSession.id) && <p>No draft bookings for the selected activity yet.</p>}
              </div>
            </article>
            <article>
              <p className="eyebrow">Finance queue</p>
              <h2>Payment state</h2>
              <div className="lab-finance-list">
                {drafts.slice(0, 6).map((draft) => (
                  <div key={draft.id}>
                    <strong>{draft.parentName || "Parent"} · {money(Number(draft.total || 0))}</strong>
                    <span>{draft.status}</span>
                    <small>{draft.paymentMethod} {draft.paymentReference ? `· ${draft.paymentReference}` : ""}{draft.creditEvents?.length ? ` · credit ${money(draft.creditEvents.reduce((sum, event) => sum + Number(event.amount || 0), 0))}` : ""}</small>
                  </div>
                ))}
                {!drafts.length && <p>Complete a prototype booking to populate the finance queue.</p>}
              </div>
            </article>
          </div>}
          {can("finance") && <section className="lab-reconciliation-centre">
            <div className="lab-reconciliation-head">
              <div>
                <p className="eyebrow">Finance reconciliation</p>
                <h2>Card, TFC, voucher and invoice control</h2>
                <p>Track payment routes separately so parents can reserve quickly while operations still see the money trail.</p>
              </div>
              <div>
                <button type="button" onClick={exportSettlementBatch} disabled={!referenceRows.length}>Export Settlement Batch</button>
                <button type="button" onClick={exportCreditLedger} disabled={!creditEvents.length}>Export Credit Ledger</button>
                <button type="button" onClick={reconcileReferencePayments} disabled={!pendingWithReference.length}>Reconcile References</button>
              </div>
            </div>
            <div className="lab-reconciliation-cards">
              <article>
                <span>Referenced pending</span>
                <strong>{pendingWithReference.length}</strong>
                <small>{money(pendingWithReference.reduce((sum, row) => sum + row.total, 0))} ready to match</small>
              </article>
              <article>
                <span>Missing references</span>
                <strong>{pendingWithoutReference.length}</strong>
                <small>Trigger payment reminder comms</small>
              </article>
              <article>
                <span>Overdue references</span>
                <strong>{overdueReferenceRows.length}</strong>
                <small>Past {rules.paymentDueHours}h voucher/TFC window</small>
              </article>
              <article>
                <span>Reconciled value</span>
                <strong>{money(financeRows.filter((row) => row.status === "Prototype paid").reduce((sum, row) => sum + row.total, 0))}</strong>
                <small>Paid or locally reconciled</small>
              </article>
              <article>
                <span>Credit liability</span>
                <strong>{money(creditLiability)}</strong>
                <small>Credit owed to parent accounts</small>
              </article>
            </div>
            <div className="lab-payment-method-grid">
              {paymentMethodTotals.map((item) => (
                <article key={item.method}>
                  <strong>{item.method === "tfc" ? "Tax-Free Childcare" : item.method}</strong>
                  <span>{item.count} booking{item.count === 1 ? "" : "s"} · {money(item.total)}</span>
                  <div className="lab-mini-progress"><span style={{ width: `${item.count ? Math.round((item.paid / item.count) * 100) : 0}%` }} /></div>
                  <small>{item.paid} reconciled · {item.pending} pending</small>
                </article>
              ))}
            </div>
            <div className="lab-reference-queue">
              {referenceRows.slice(0, 6).map((row) => (
                <article key={row.id} className={row.reference ? "ready" : "missing"}>
                  <span>{row.method === "tfc" ? "TFC" : row.method}</span>
                  <strong>{row.parent} · {money(row.total)}</strong>
                  <p>{row.activity} · {row.site}</p>
                  <small>{row.reference || "Reference missing"} · {row.status}</small>
                </article>
              ))}
              {!referenceRows.length && <p>No voucher, Tax-Free Childcare or invoice payments are waiting for reconciliation.</p>}
            </div>
            <section className="lab-credit-ledger">
              <div className="lab-credit-ledger-head">
                <div>
                  <p className="eyebrow">Refund and credit ledger</p>
                  <h3>Track money owed back to parents.</h3>
                </div>
                <label>Status<select value={creditFilter} onChange={(event) => setCreditFilter(event.target.value)}>
                  {["Open", "Account credit", "Refunded", "Applied", "All"].map((item) => <option key={item}>{item}</option>)}
                </select></label>
              </div>
              <div className="lab-credit-ledger-rows">
                {filteredCreditEvents.map((event) => (
                  <article key={`${event.bookingId}-${event.eventId}`} className={event.status.toLowerCase().replace(/\s+/g, "-")}>
                    <div>
                      <span>{event.status}</span>
                      <strong>{event.parentName} · {money(event.amount)}</strong>
                      <p>{event.type || "Credit"} · {event.reason || "No reason recorded"}</p>
                      <small>{event.activity} · {event.site}</small>
                    </div>
                    <footer>
                      <button type="button" onClick={() => markCreditRefunded(event)} disabled={["Refunded", "Applied"].includes(event.status)}>Mark Refunded</button>
                      <button type="button" onClick={() => keepCreditOnAccount(event)} disabled={["Refunded", "Applied"].includes(event.status)}>Keep as Credit</button>
                      <button type="button" onClick={() => applyCreditToOutstanding(event)} disabled={["Refunded", "Applied"].includes(event.status)}>Apply to Balance</button>
                    </footer>
                  </article>
                ))}
                {!filteredCreditEvents.length && <p>No credit ledger entries match this filter.</p>}
              </div>
            </section>
          </section>}
          {activeRole !== "Manager" && !can("register") && !can("finance") && (
            <section className="lab-permission-empty">
              <strong>No tools enabled for this role in Operations.</strong>
              <p>Switch to Staff, Finance or Manager to use operational controls.</p>
            </section>
          )}
          {can("manage") && <div className="lab-manager-tools">
          <div className="lab-ops-grid">
            <article>
              <p className="eyebrow">Activity builder</p>
              <h2>Create a bookable activity</h2>
              <form className="lab-builder-form" onSubmit={createActivity}>
                <label>Activity name<input required name="title" placeholder="After-school care, camp or club" /></label>
                <label>Site<input required name="site" placeholder="School or venue" /></label>
                <label>Area<input name="area" placeholder="Area" /></label>
                <label>Type<select name="type"><option>Wraparound</option><option>Holiday Camp</option></select></label>
                <label>Time<input name="time" placeholder="15:00-18:00" /></label>
                <label>Price<input required min="0" step="0.01" type="number" name="price" placeholder="18.00" /></label>
                <label>Capacity<input required min="1" type="number" name="capacity" placeholder="16" /></label>
                <label>Age / eligibility<input name="age" placeholder="Open to all primary-age children" /></label>
                <label className="full">Dates<textarea name="days" rows="2" placeholder="Mon 8 Jun, Tue 9 Jun, Wed 10 Jun" /></label>
                <label className="full">Features<textarea name="features" rows="2" placeholder="Snack included, STEM activity, flexible collection" /></label>
                <button className="button book" type="submit">Add Activity</button>
              </form>
            </article>
            <article>
              <p className="eyebrow">Booking command centre</p>
              <h2>Amend, cancel, reconcile</h2>
              <div className="lab-command-list">
                {drafts.slice(0, 7).map((draft) => (
                  <div key={draft.id}>
                    <strong>{draft.parentName || "Parent"} · {draft.activity}</strong>
                    <span>{draft.site} · {draft.days?.length || 0} sessions · {draft.status}</span>
                    <small>{draft.children?.join(", ") || draft.childName} · {money(Number(draft.total || 0))}</small>
                    <div>
                      <button type="button" onClick={() => updateDraftStatus(draft.id, "Prototype paid")}>Paid</button>
                      <button type="button" onClick={() => duplicateDraft(draft.id)}>Amend</button>
                      <button type="button" onClick={() => updateDraftStatus(draft.id, "Cancelled")}>Cancel</button>
                    </div>
                  </div>
                ))}
                {!drafts.length && <p>Bookings will appear here after a parent journey is completed.</p>}
              </div>
            </article>
          </div>
          <section className="lab-rules-engine">
            <div className="lab-rules-head">
              <div>
                <p className="eyebrow">Rules engine</p>
                <h2>Booking controls, discounts and override policy</h2>
              </div>
              <div className="lab-rule-pills">
                {rulesSummary.map(([value, label]) => <span key={label}><strong>{value}</strong>{label}</span>)}
              </div>
            </div>
            <form className="lab-rules-form" onSubmit={saveRules}>
              <label>Cancellation window<input name="cancellationHours" type="number" min="0" defaultValue={rules.cancellationHours} /></label>
              <label>Amendment deadline<input name="amendmentHours" type="number" min="0" defaultValue={rules.amendmentHours} /></label>
              <label>Voucher/TFC deadline<input name="paymentDueHours" type="number" min="0" defaultValue={rules.paymentDueHours} /></label>
              <label>Sibling discount %<input name="siblingDiscountPercent" type="number" min="0" max="100" defaultValue={rules.siblingDiscountPercent} /></label>
              <label>Full-week discount %<input name="fullWeekDiscountPercent" type="number" min="0" max="100" defaultValue={rules.fullWeekDiscountPercent} /></label>
              <label>Promo code<input name="promoCode" defaultValue={rules.promoCode} /></label>
              <label>Promo discount %<input name="promoDiscountPercent" type="number" min="0" max="100" defaultValue={rules.promoDiscountPercent} /></label>
              <label>Auto-waitlist at %<input name="autoWaitlistAtPercent" type="number" min="1" defaultValue={rules.autoWaitlistAtPercent} /></label>
              <label>Holiday min year<select name="holidayYearMin" defaultValue={rules.holidayYearMin}>{schoolYears.map((year) => <option key={year}>{year}</option>)}</select></label>
              <label>Holiday max year<select name="holidayYearMax" defaultValue={rules.holidayYearMax}>{schoolYears.map((year) => <option key={year}>{year}</option>)}</select></label>
              <label className="lab-rule-toggle"><input name="schoolOnlyStrict" type="checkbox" defaultChecked={rules.schoolOnlyStrict} /> Strict school-only wraparound</label>
              <label className="lab-rule-toggle"><input name="allowAdminOverride" type="checkbox" defaultChecked={rules.allowAdminOverride} /> Allow admin override</label>
              <button className="button book" type="submit">Save Rules</button>
            </form>
            <section className="lab-rule-simulator">
              <div className="lab-rule-sim-head">
                <div>
                  <p className="eyebrow">Rules simulator</p>
                  <h3>Test a booking before changing policy.</h3>
                </div>
                <span>{simulatedIssues.length ? `${simulatedIssues.length} issue${simulatedIssues.length === 1 ? "" : "s"}` : "No rule issues"}</span>
              </div>
              <div className="lab-rule-sim-grid">
                <label>Care type<select value={ruleTest.careType} onChange={(event) => updateRuleTest("careType", event.target.value)}>
                  <option>Wraparound</option>
                  <option>Holiday Camp</option>
                </select></label>
                <label>Site<input value={ruleTest.site} onChange={(event) => updateRuleTest("site", event.target.value)} /></label>
                <label>Child school<input value={ruleTest.childSchool} onChange={(event) => updateRuleTest("childSchool", event.target.value)} /></label>
                <label>Child year<select value={ruleTest.childYear} onChange={(event) => updateRuleTest("childYear", event.target.value)}>
                  {schoolYears.map((year) => <option key={year}>{year}</option>)}
                </select></label>
                <label>Children<input min="1" type="number" value={ruleTest.childCount} onChange={(event) => updateRuleTest("childCount", Number(event.target.value))} /></label>
                <label>Days<input min="1" type="number" value={ruleTest.days} onChange={(event) => updateRuleTest("days", Number(event.target.value))} /></label>
                <label>Capacity<input min="1" type="number" value={ruleTest.capacity} onChange={(event) => updateRuleTest("capacity", Number(event.target.value))} /></label>
                <label>Already booked<input min="0" type="number" value={ruleTest.alreadyBooked} onChange={(event) => updateRuleTest("alreadyBooked", Number(event.target.value))} /></label>
                <label>Price<input min="0" step="0.01" type="number" value={ruleTest.price} onChange={(event) => updateRuleTest("price", Number(event.target.value))} /></label>
                <label>Payment<select value={ruleTest.paymentMethod} onChange={(event) => updateRuleTest("paymentMethod", event.target.value)}>
                  <option value="card">Card</option>
                  <option value="tfc">Tax-Free Childcare</option>
                  <option value="voucher">Childcare voucher</option>
                  <option value="invoice">Invoice</option>
                </select></label>
                <label>Promo<input value={ruleTest.promo} onChange={(event) => updateRuleTest("promo", event.target.value)} placeholder={rules.promoCode || "Code"} /></label>
                <label className="lab-rule-toggle"><input type="checkbox" checked={ruleTest.override} onChange={(event) => updateRuleTest("override", event.target.checked)} /> Test admin override</label>
              </div>
              <div className="lab-rule-sim-cards">
                {simulatorCards.map(([label, value, text]) => (
                  <article key={label} className={label === "Outcome" ? simulatedOutcome.toLowerCase().replace(/\s+/g, "-") : ""}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                    <small>{text}</small>
                  </article>
                ))}
              </div>
              <div className="lab-rule-sim-results">
                <div>
                  <strong>Rule trace</strong>
                  {simulatedIssues.length ? simulatedIssues.map((issue) => <span key={issue}>{issue}</span>) : <span>Eligibility, capacity and payment rules allow this test case.</span>}
                  {ruleTest.override && !rules.allowAdminOverride && <span>Override is selected but global admin override is disabled.</span>}
                  {ruleTest.override && rules.allowAdminOverride && simulatedIssues.length > 0 && <span>Admin override would allow this blocked eligibility case.</span>}
                </div>
                <div>
                  <strong>Discount trace</strong>
                  <span>Sibling: -{money(simulatedSiblingDiscount)}</span>
                  <span>Full week: -{money(simulatedWeekDiscount)}</span>
                  <span>Promo: -{money(simulatedPromoDiscount)}</span>
                </div>
              </div>
              <div className="lab-rule-sim-actions">
                <button type="button" onClick={saveCurrentRuleScenario}>Save Current Scenario</button>
                {ruleScenarioPresets.map(([name, test]) => (
                  <button key={name} type="button" onClick={() => setRuleTest(test)}>{name}</button>
                ))}
              </div>
              <section className="lab-rule-scenario-compare">
                <div>
                  <p className="eyebrow">Scenario comparison</p>
                  <h3>Saved policy test cases</h3>
                </div>
                <div className="lab-rule-scenario-grid">
                  {comparedRuleScenarios.map((scenario) => (
                    <article key={scenario.id} className={scenario.result.outcome.toLowerCase().replace(/\s+/g, "-")}>
                      <span>{scenario.name}</span>
                      <strong>{scenario.result.outcome}</strong>
                      <small>{scenario.test.careType} · {scenario.test.childYear} · {scenario.test.childCount} child{scenario.test.childCount === 1 ? "" : "ren"}</small>
                      <div>
                        <em>{money(scenario.result.total)}</em>
                        <em>{scenario.result.capacityPercent}% capacity</em>
                        <em>{scenario.result.issues.length} issue{scenario.result.issues.length === 1 ? "" : "s"}</em>
                      </div>
                      <footer>
                        <button type="button" onClick={() => loadRuleScenario(scenario)}>Load</button>
                        <button type="button" onClick={() => removeRuleScenario(scenario.id)}>Remove</button>
                      </footer>
                    </article>
                  ))}
                  {!comparedRuleScenarios.length && <p>Save the current simulator state or use a preset to create comparison cases.</p>}
                </div>
              </section>
            </section>
          </section>
          <section className="lab-comms-centre">
            <div className="lab-comms-head">
              <div>
                <p className="eyebrow">Comms centre</p>
                <h2>Confirmations, payment nudges and follow-ups</h2>
              </div>
              <span>{messageLog.length} local messages</span>
            </div>
            <div className="lab-comms-grid">
              <article>
                <h3>Send from a booking</h3>
                <div className="lab-comms-bookings">
                  {drafts.slice(0, 5).map((draft) => (
                    <div key={draft.id}>
                      <strong>{draft.parentName || "Parent"} · {draft.activity}</strong>
                      <span>{draft.parentEmail || "No email"} · {draft.status}</span>
                      <div>
                        {["Confirmation", "Payment reminder", "Missing info", "Incident follow-up"].map((template) => (
                          <button key={template} type="button" onClick={() => sendLabMessage(draft, template)}>{template}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {!drafts.length && <p>Complete or seed a booking to test message templates.</p>}
                </div>
              </article>
              <article>
                <h3>Message log</h3>
                <div className="lab-message-log">
                  {messageLog.slice(0, 6).map((message) => (
                    <div key={message.id}>
                      <strong>{message.subject}</strong>
                      <span>{message.recipient}</span>
                      <p>{message.body}</p>
                    </div>
                  ))}
                  {!messageLog.length && <p>No messages sent in this local prototype yet.</p>}
                </div>
              </article>
            </div>
          </section>
          <section className="lab-reporting-centre">
            <div className="lab-reporting-head">
              <div>
                <p className="eyebrow">Reports and exports</p>
                <h2>Occupancy, revenue, reconciliation and safeguarding summaries</h2>
              </div>
              <div>
                <button type="button" onClick={() => exportReport("occupancy")}>Export Occupancy</button>
                <button type="button" onClick={() => exportReport("finance")}>Export Finance</button>
                <button type="button" onClick={() => exportReport("medical")}>Export Medical</button>
              </div>
            </div>
            <div className="lab-report-cards">
              {reportCards.map(([label, value, text]) => (
                <article key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                  <small>{text}</small>
                </article>
              ))}
            </div>
            <div className="lab-report-grid">
              <article>
                <h3>Occupancy by activity</h3>
                <div className="lab-occupancy-list">
                  {occupancyRows.map((row) => (
                    <div key={row.session.id}>
                      <div>
                        <strong>{row.session.title}</strong>
                        <span>{row.session.site} · {row.booked}/{row.capacity} child sessions</span>
                      </div>
                      <div className="lab-bar"><span style={{ width: `${Math.min(100, row.fill)}%` }} /></div>
                      <small>{row.fill}% full · {row.waitlist} waitlist · {money(row.revenue)}</small>
                    </div>
                  ))}
                </div>
              </article>
              <article>
                <h3>Reconciliation queue</h3>
                <div className="lab-recon-list">
                  {financeRows.slice(0, 8).map((row, index) => (
                    <div key={`${row.parent}-${row.activity}-${index}`}>
                      <strong>{row.parent} · {money(row.total)}</strong>
                      <span>{row.activity} · {row.status}</span>
                      <small>{row.method}{row.reference ? ` · ${row.reference}` : " · no reference"}</small>
                    </div>
                  ))}
                  {!financeRows.length && <p>No finance rows yet.</p>}
                </div>
              </article>
              <article>
                <h3>Medical and safeguarding summary</h3>
                <div className="lab-medical-list">
                  {medicalRows.slice(0, 8).map((row, index) => (
                    <div key={`${row.children}-${index}`}>
                      <strong>{row.children}</strong>
                      <span>{row.site} · {row.collector || "Collector not set"}</span>
                      <small>{row.flags || "No profile flags"} · {row.notes || "No notes"}</small>
                    </div>
                  ))}
                  {!medicalRows.length && <p>No medical or safeguarding notes yet.</p>}
                </div>
              </article>
            </div>
          </section>
          <section className="lab-activity-table">
            <div>
              <p className="eyebrow">Product catalogue</p>
              <h2>Bookable activities</h2>
            </div>
            <div className="lab-activity-rows">
              {sessions.map((session) => (
                <article key={session.id}>
                  <strong>{session.title}</strong>
                  <span>{session.site} · {session.area} · {session.type}</span>
                  <small>{session.days.length} dates · {session.capacity} places · {money(Number(session.price))}</small>
                </article>
              ))}
            </div>
          </section>
          </div>}
        </section>
      )}

      {labView === "Family" && (
        <section className="lab-family-centre">
          <div className="lab-family-head">
            <div>
              <p className="eyebrow">Family accounts</p>
              <h2>Reusable parent and child records</h2>
              <p>Saved locally for this prototype so bookings can reuse child details, collectors, medical plans and consent history.</p>
            </div>
            <label>Active family<select value={activeFamilyId} onChange={(event) => loadFamily(event.target.value)}>
              {families.map((family) => <option key={family.id} value={family.id}>{family.parentName} · {family.email}</option>)}
            </select></label>
          </div>
          <div className="lab-family-grid">
            <article className="lab-family-card">
              <p className="eyebrow">Profile</p>
              <h3>{activeFamily.parentName}</h3>
              <span>{activeFamily.email}</span>
              <span>{activeFamily.phone}</span>
              <strong>Emergency contact</strong>
              <p>{activeFamily.emergencyContact || "Not recorded"}</p>
              <strong>Authorised collectors</strong>
              <div className="lab-family-tags">{(activeFamily.collectors || []).map((collector) => <span key={collector}>{collector}</span>)}</div>
            </article>
            <article className="lab-family-card">
              <p className="eyebrow">Children</p>
              <div className="lab-family-children">
                {(activeFamily.children || []).map((child) => (
                  <div key={child.id}>
                    <strong>{child.name}</strong>
                    <span>{child.year} · {child.school}</span>
                    <small>{child.flags?.length ? child.flags.join(", ") : "No flags"} · {child.consent}</small>
                    <p>{child.medicalPlan || "No medical plan recorded."}</p>
                  </div>
                ))}
              </div>
            </article>
            <article className="lab-family-card">
              <p className="eyebrow">Consent history</p>
              <div className="lab-family-timeline">
                {(activeFamily.consentHistory || []).map((entry) => <span key={entry}>{entry}</span>)}
              </div>
            </article>
          </div>
          <form className="lab-family-form" onSubmit={createFamily}>
            <div>
              <p className="eyebrow">Create family</p>
              <h3>Add a reusable record</h3>
            </div>
            <label>Parent name<input required name="parentName" placeholder="Parent or carer" /></label>
            <label>Email<input required type="email" name="email" /></label>
            <label>Phone<input name="phone" /></label>
            <label>Emergency contact<input name="emergencyContact" /></label>
            <label className="full">Authorised collectors<textarea name="collectors" rows="2" placeholder="Name one, Name two" /></label>
            <label>Child name<input required name="childName" /></label>
            <label>Child year<select name="childYear">{schoolYears.map((year) => <option key={year}>{year}</option>)}</select></label>
            <label>Child school<input name="childSchool" /></label>
            <label>Photo consent<select name="photoConsent"><option>Photo consent off</option><option>Photo consent on</option></select></label>
            <label className="full">Medical flags<textarea name="childFlags" rows="2" placeholder="Nut allergy, Asthma inhaler" /></label>
            <label className="full">Medical plan<textarea name="medicalPlan" rows="3" placeholder="Medication location, triggers, actions and parent instructions." /></label>
            <button className="button book" type="submit">Save Family</button>
          </form>
        </section>
      )}

      {labView === "Setup" && (
        <section className="lab-setup-centre">
          <div className="lab-setup-hero">
            <div>
              <p className="eyebrow">Setup wizard</p>
              <h2>Launch a site without rebuilding the system.</h2>
              <p>Create the operational shape first, then turn it into a bookable activity, rules context and launch checklist.</p>
            </div>
            <div className="lab-setup-stats">
              <span><strong>{launchPlans.length}</strong>Launch plans</span>
              <span><strong>{customSessions.length}</strong>Custom activities</span>
              <span><strong>{sessions.length}</strong>Total catalogue</span>
            </div>
          </div>
          <form className="lab-setup-form" onSubmit={createLaunchPlan}>
            <section>
              <p className="eyebrow">1. Site</p>
              <label>Site name<input required name="site" placeholder="School or venue" /></label>
              <label>Area<input name="area" placeholder="Town or borough" /></label>
              <label>School contact<input name="schoolContact" placeholder="Business manager, DSL or office contact" /></label>
            </section>
            <section>
              <p className="eyebrow">2. Activity</p>
              <label>Activity name<input required name="activity" placeholder="After-school care, holiday camp, STEM club" /></label>
              <label>Type<select name="type"><option>Wraparound</option><option>Holiday Camp</option></select></label>
              <label>Session time<input name="time" placeholder="15:00-18:00" /></label>
              <label className="full">Dates<textarea name="days" rows="2" placeholder="Mon 8 Jun, Tue 9 Jun, Wed 10 Jun" /></label>
            </section>
            <section>
              <p className="eyebrow">3. Commercials</p>
              <label>Price<input required min="0" step="0.01" type="number" name="price" placeholder="18.00" /></label>
              <label>Capacity<input required min="1" type="number" name="capacity" placeholder="24" /></label>
              <label>Ratio assumption<select name="ratio"><option>1:8</option><option>1:10</option><option>1:12</option><option>1:15</option></select></label>
              <div className="lab-setup-checks">
                {["Card", "Tax-Free Childcare", "Childcare voucher"].map((method) => (
                  <label key={method}><input type="checkbox" name="paymentMethods" value={method} defaultChecked={method === "Card"} />{method}</label>
                ))}
              </div>
            </section>
            <section>
              <p className="eyebrow">4. Launch checklist</p>
              <div className="lab-setup-checks">
                <label><input type="checkbox" name="safeguarding" /> Safeguarding docs ready</label>
                <label><input type="checkbox" name="registers" /> Register template checked</label>
                <label><input type="checkbox" name="payment" /> Payment route checked</label>
                <label><input type="checkbox" name="comms" /> Parent comms drafted</label>
              </div>
              <button className="button book" type="submit">Create Launch Plan</button>
            </section>
          </form>
          <section className="lab-launch-list">
            <div>
              <p className="eyebrow">Launch plans</p>
              <h2>Draft site launches</h2>
            </div>
            <div>
              {launchPlans.map((plan) => {
                const checklistCount = Object.values(plan.checklist || {}).filter(Boolean).length;
                return (
                  <article key={plan.id}>
                    <strong>{plan.site}</strong>
                    <span>{plan.activity} · {plan.area || "Area TBC"} · {plan.status}</span>
                    <small>{money(plan.price)} · {plan.capacity} places · ratio {plan.ratio} · {checklistCount}/4 launch checks</small>
                  </article>
                );
              })}
              {!launchPlans.length && <p>No launch plans yet. Create one above to add it to the catalogue.</p>}
            </div>
          </section>
        </section>
      )}

      {labView === "Pilot" && (
        <section className="lab-pilot-centre">
          <div className="lab-pilot-hero">
            <div>
              <p className="eyebrow">Pilot Mode</p>
              <h2>Run a full rehearsal before deciding whether to deploy.</h2>
              <p>Seed parent bookings, invite families, rehearse registers, reconcile payments and produce a go/no-go report from one local control panel.</p>
            </div>
            <div className={`lab-pilot-verdict verdict-${pilotGoNoGo.toLowerCase().replace(/\s+/g, "-")}`}>
              <span>{pilotReadyCount}/{pilotChecklist.length} checks</span>
              <strong>{pilotGoNoGo}</strong>
              <small>{pilotGoNoGo === "Go" ? "The pilot journey is complete." : "Use the actions below to close launch gaps."}</small>
            </div>
          </div>
          <div className="lab-pilot-toolbar">
            <label>Pilot activity<select value={pilotSession.id} onChange={(event) => setPilotSessionId(event.target.value)}>
              {sessions.map((session) => <option key={session.id} value={session.id}>{session.site} · {session.title}</option>)}
            </select></label>
            <button type="button" onClick={seedPilotLaunch}>Seed Pilot</button>
            <button type="button" onClick={sendPilotInvites}>Send Invites</button>
            <button type="button" onClick={runPilotRegister}>Run Register</button>
            <button type="button" onClick={reconcilePilotPayments}>Reconcile</button>
            <button type="button" onClick={exportPilotReport}>Export Report</button>
          </div>
          <div className="lab-pilot-metrics">
            {[
              ["Bookings", String(pilotDrafts.length), "Family bookings in this rehearsal"],
              ["Projected fill", `${pilotFill}%`, `${pilotChildSessions}/${pilotCapacity} child sessions`],
              ["Revenue", money(pilotRevenue), "Local prototype value"],
              ["Pending payments", String(pilotPending), "Rows still needing finance action"],
              ["Register touched", `${pilotRegisterTouched}/${pilotRegisterRows.length}`, "Attendance rows rehearsed"],
              ["Messages", String(pilotMessages.length), "Invite and booking comms"],
            ].map(([label, value, text]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{text}</small>
              </article>
            ))}
          </div>
          <section className="lab-pilot-grid">
            <article>
              <div>
                <p className="eyebrow">Launch checklist</p>
                <h3>Operational readiness</h3>
              </div>
              <div className="lab-pilot-checks">
                {pilotChecklist.map(([label, ready, detail]) => (
                  <div className={ready ? "ready" : "open"} key={label}>
                    <strong>{label}</strong>
                    <span>{ready ? "Ready" : "Open"}</span>
                    <p>{detail}</p>
                  </div>
                ))}
              </div>
            </article>
            <article>
              <div>
                <p className="eyebrow">Parent cohort</p>
                <h3>Bookings in rehearsal</h3>
              </div>
              <div className="lab-pilot-bookings">
                {pilotDrafts.slice(0, 10).map((draft) => (
                  <div key={draft.id}>
                    <strong>{draft.parentName}</strong>
                    <span>{draft.children?.join(", ") || draft.childName} · {(draft.days || []).join(", ")}</span>
                    <small>{draft.status} · {draft.paymentMethod} · {money(Number(draft.total || 0))}</small>
                  </div>
                ))}
                {!pilotDrafts.length && <p>No pilot bookings yet. Seed the pilot to create a realistic launch cohort.</p>}
              </div>
            </article>
          </section>
          <section className="lab-pilot-grid">
            <article>
              <div>
                <p className="eyebrow">Register rehearsal</p>
                <h3>{pilotSession.days[0]} staff view</h3>
              </div>
              <div className="lab-pilot-register">
                {pilotRegisterRows.slice(0, 12).map((row) => (
                  <div key={row.rowId}>
                    <strong>{row.name}</strong>
                    <span>{row.event.status || "Booked"} · {row.draft.collector || "Collector not set"}</span>
                    <small>{row.event.note || row.draft.medicalNotes || "No handover note"}</small>
                  </div>
                ))}
                {!pilotRegisterRows.length && <p>The register will populate after pilot bookings are seeded.</p>}
              </div>
            </article>
            <article>
              <div>
                <p className="eyebrow">Finance rehearsal</p>
                <h3>Payment routes under test</h3>
              </div>
              <div className="lab-pilot-finance">
                {["card", "tfc", "voucher", "invoice"].map((method) => {
                  const rows = pilotDrafts.filter((draft) => draft.paymentMethod === method);
                  const value = rows.reduce((sum, draft) => sum + Number(draft.total || 0), 0);
                  return (
                    <div key={method}>
                      <strong>{method === "tfc" ? "Tax-Free Childcare" : method}</strong>
                      <span>{rows.length} booking{rows.length === 1 ? "" : "s"} · {money(value)}</span>
                      <small>{rows.filter((draft) => draft.status === "Prototype paid").length} reconciled</small>
                    </div>
                  );
                })}
              </div>
            </article>
          </section>
        </section>
      )}

      {labView === "Payments" && (
        <section className="lab-payments-sandbox">
          <div className="lab-payments-hero">
            <div>
              <p className="eyebrow">Payments Sandbox</p>
              <h2>Stress-test cards, TFC, vouchers, refunds and receipts.</h2>
              <p>Use local booking rows to rehearse payment states before a live provider is connected. Nothing here charges a real parent.</p>
            </div>
            <button type="button" onClick={ensurePaymentRows}>Seed Payment Rows</button>
          </div>
          <div className="lab-payment-sandbox-cards">
            {paymentSandboxCards.map(([label, value, text]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{text}</small>
              </article>
            ))}
          </div>
          <section className="lab-payment-workbench">
            <article>
              <div>
                <p className="eyebrow">Payment queue</p>
                <h3>Booking payment states</h3>
              </div>
              <div className="lab-payment-queue">
                {paymentSandboxRows.map((row) => (
                  <button className={activePaymentRow?.id === row.id ? "active" : ""} key={row.id} type="button" onClick={() => setActivePaymentId(row.id)}>
                    <span>{row.label} · {row.risk} risk</span>
                    <strong>{row.parent}</strong>
                    <small>{row.activity} · {row.status} · {money(row.total)}</small>
                  </button>
                ))}
                {!paymentSandboxRows.length && <p>No payment rows yet. Seed the sandbox or complete a booking.</p>}
              </div>
            </article>
            <article>
              <div>
                <p className="eyebrow">Scenario controls</p>
                <h3>{activePaymentRow ? activePaymentRow.parent : "No payment selected"}</h3>
              </div>
              {activePaymentRow ? (
                <>
                  <div className={`lab-payment-intent intent-${activePaymentRow.intent}`}>
                    <span>{activePaymentRow.label}</span>
                    <strong>{activePaymentRow.intent}</strong>
                    <small>{activePaymentRow.reference || "No reference recorded"} · {money(activePaymentRow.total)}</small>
                  </div>
                  <div className="lab-payment-actions">
                    <button type="button" onClick={() => simulateCardAction(activePaymentRow.id, "success")}>Card Success</button>
                    <button type="button" onClick={() => simulateCardAction(activePaymentRow.id, "action")}>Require SCA</button>
                    <button type="button" onClick={() => simulateCardAction(activePaymentRow.id, "failed")}>Fail Card</button>
                    <button type="button" onClick={() => matchReferencePayment(activePaymentRow.id)}>Match Reference</button>
                    <button type="button" onClick={() => createPartialRefund(activePaymentRow.id)}>Partial Refund</button>
                    <button type="button" onClick={() => sendPaymentReceipt(activePaymentRow.id)}>Receipt</button>
                  </div>
                  <div className="lab-payment-parent-copy">
                    <strong>Parent-facing status</strong>
                    <p>{activePaymentRow.status === "Prototype paid"
                      ? "Payment received. Receipt available in the parent portal."
                      : activePaymentRow.status === "Payment failed"
                        ? "Payment failed. Parent should retry card or choose another route."
                        : activePaymentRow.status === "Partially refunded"
                          ? "Partial refund or account credit created and awaiting finance resolution."
                          : "Place reserved while payment reference or card action is completed."}</p>
                  </div>
                </>
              ) : (
                <p>Select or seed a payment row to run sandbox scenarios.</p>
              )}
            </article>
          </section>
          <section className="lab-payment-audit">
            <div>
              <p className="eyebrow">Payment audit</p>
              <h3>Timeline and generated receipts</h3>
            </div>
            <div className="lab-payment-audit-grid">
              <article>
                <strong>Selected payment timeline</strong>
                {(drafts.find((draft) => draft.id === activePaymentRow?.id)?.paymentTimeline || []).map((event, index) => (
                  <span key={`${event.label}-${index}`}>{event.label} · {new Date(event.at).toLocaleString("en-GB")}</span>
                ))}
                {!(drafts.find((draft) => draft.id === activePaymentRow?.id)?.paymentTimeline || []).length && <p>No sandbox events recorded for this payment yet.</p>}
              </article>
              <article>
                <strong>Recent payment messages</strong>
                {messageLog.filter((message) => message.template === "Payment receipt" || message.template === "Payment reminder").slice(0, 6).map((message) => (
                  <span key={message.id}>{message.subject} · {message.recipient}</span>
                ))}
                {!messageLog.some((message) => message.template === "Payment receipt" || message.template === "Payment reminder") && <p>No payment receipts or reminders generated yet.</p>}
              </article>
            </div>
          </section>
        </section>
      )}

      {labView === "Support" && (
        <section className="lab-support-console">
          <div className="lab-support-hero">
            <div>
              <p className="eyebrow">Admin Support Console</p>
              <h2>Find a parent, understand the case, and fix it quickly.</h2>
              <p>Search bookings, review messages, open tickets, add internal notes, resend confirmations and record admin overrides from one local desk.</p>
            </div>
            <button type="button" onClick={ensureSupportRows}>Seed Support Cases</button>
          </div>
          <div className="lab-support-cards">
            {supportCards.map(([label, value, text]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{text}</small>
              </article>
            ))}
          </div>
          <section className="lab-support-workbench">
            <article>
              <div>
                <p className="eyebrow">Case finder</p>
                <h3>Parent, child or booking search</h3>
              </div>
              <label>Search<input value={supportQuery} onChange={(event) => setSupportQuery(event.target.value)} placeholder="Parent, child, email, activity or status" /></label>
              <div className="lab-support-results">
                {filteredSupportRows.map((row) => (
                  <button className={activeSupportRow?.id === row.id ? "active" : ""} key={row.id} type="button" onClick={() => setActiveSupportId(row.id)}>
                    <span>{row.email || "No email"} · {row.draft.status}</span>
                    <strong>{row.parent}</strong>
                    <small>{row.children || "Child not recorded"} · {row.draft.activity}</small>
                  </button>
                ))}
                {!filteredSupportRows.length && <p>No matching support cases yet.</p>}
              </div>
            </article>
            <article>
              <div>
                <p className="eyebrow">Case summary</p>
                <h3>{activeSupportRow ? activeSupportRow.parent : "No case selected"}</h3>
              </div>
              {activeSupportRow ? (
                <>
                  <div className="lab-support-summary">
                    <div><span>Booking</span><strong>{activeSupportRow.draft.activity}</strong><small>{activeSupportRow.draft.site} · {(activeSupportRow.draft.days || []).join(", ")}</small></div>
                    <div><span>Children</span><strong>{activeSupportRow.children || "Not recorded"}</strong><small>{activeSupportRow.draft.medicalNotes || "No care notes"}</small></div>
                    <div><span>Payment</span><strong>{activeSupportRow.draft.status}</strong><small>{activeSupportRow.draft.paymentMethod} · {money(Number(activeSupportRow.draft.total || 0))}</small></div>
                    <div><span>Collector</span><strong>{activeSupportRow.draft.collector || "Not set"}</strong><small>{activeSupportRow.draft.emergencyPhone || "No emergency phone"}</small></div>
                  </div>
                  <div className="lab-support-actions">
                    <button type="button" onClick={resendSupportConfirmation}>Resend Confirmation</button>
                    <button type="button" onClick={() => createSupportTicket("Parent query")}>Open Query</button>
                    <button type="button" onClick={() => createSupportTicket("Safeguarding note")}>Safeguarding Note</button>
                    <button type="button" onClick={applySupportOverride}>Apply Override</button>
                    <button type="button" onClick={exportSupportCase}>Export Case</button>
                  </div>
                  <form className="lab-support-note-form" onSubmit={addSupportNote}>
                    <label>Internal note<textarea name="supportNote" rows="3" placeholder="Record what happened, who approved it, and any follow-up needed." /></label>
                    <button type="submit">Save Note</button>
                  </form>
                </>
              ) : (
                <p>Seed or complete a booking to begin handling support cases.</p>
              )}
            </article>
          </section>
          <section className="lab-support-timeline">
            <article>
              <div>
                <p className="eyebrow">Open tickets</p>
                <h3>Support queue</h3>
              </div>
              <div className="lab-support-ticket-list">
                {activeSupportTickets.map((ticket) => (
                  <div key={ticket.id}>
                    <strong>{ticket.type}</strong>
                    <span>{ticket.priority} priority · {ticket.status}</span>
                    <small>{new Date(ticket.createdAt).toLocaleString("en-GB")}</small>
                    <button type="button" onClick={() => resolveSupportTicket(ticket.id)}>Resolve</button>
                  </div>
                ))}
                {!activeSupportTickets.length && <p>No open tickets for the selected case.</p>}
              </div>
            </article>
            <article>
              <div>
                <p className="eyebrow">Internal notes</p>
                <h3>Admin trail</h3>
              </div>
              <div className="lab-support-note-list">
                {activeSupportNotes.map((note) => (
                  <div key={note.id}>
                    <strong>{note.author}</strong>
                    <p>{note.body}</p>
                    <small>{new Date(note.createdAt).toLocaleString("en-GB")}</small>
                  </div>
                ))}
                {!activeSupportNotes.length && <p>No internal notes for the selected case.</p>}
              </div>
            </article>
            <article>
              <div>
                <p className="eyebrow">Parent comms</p>
                <h3>Messages</h3>
              </div>
              <div className="lab-support-message-list">
                {activeSupportMessages.slice(0, 8).map((message) => (
                  <div key={message.id}>
                    <strong>{message.subject}</strong>
                    <span>{message.recipient}</span>
                    <p>{message.body}</p>
                  </div>
                ))}
                {!activeSupportMessages.length && <p>No messages attached to this case yet.</p>}
              </div>
            </article>
          </section>
        </section>
      )}

      {labView === "Staffing" && (
        <section className="lab-staffing-planner">
          <div className="lab-staffing-hero">
            <div>
              <p className="eyebrow">Staff Scheduling & Ratios</p>
              <h2>Test rota cover before bookings become operational pressure.</h2>
              <p>Model child numbers against staff ratios, qualified leads, first-aid cover, absences and site fit for each session day.</p>
            </div>
            <div className={staffingOpenGaps ? "lab-staffing-verdict gap" : "lab-staffing-verdict covered"}>
              <span>{coveredStaffingRows}/{staffingRows.length} days covered</span>
              <strong>{staffingOpenGaps ? `${staffingOpenGaps} gaps` : "Covered"}</strong>
              <small>{staffingOpenGaps ? "Review ratio, lead or first-aid gaps." : "Selected activity has rota cover."}</small>
            </div>
          </div>
          <div className="lab-staffing-toolbar">
            <label>Activity<select value={staffingSession.id} onChange={(event) => setStaffingSessionId(event.target.value)}>
              {sessions.map((session) => <option key={session.id} value={session.id}>{session.site} · {session.title}</option>)}
            </select></label>
            <button type="button" onClick={seedStaffingPlan}>Seed Rota</button>
            <button type="button" onClick={exportStaffingPlan}>Export Staffing</button>
          </div>
          <div className="lab-staffing-cards">
            {staffingCards.map(([label, value, text]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{text}</small>
              </article>
            ))}
          </div>
          <section className="lab-staffing-grid">
            <article>
              <div>
                <p className="eyebrow">Daily cover</p>
                <h3>{staffingSession.site}</h3>
              </div>
              <div className="lab-staffing-days">
                {staffingRows.map((row) => (
                  <div className={row.covered ? "covered" : "gap"} key={row.day}>
                    <header>
                      <strong>{row.day}</strong>
                      <span>{row.covered ? "Covered" : "Gap"}</span>
                    </header>
                    <p>{row.children} children · needs {row.required} staff · {row.assignments.length} assigned</p>
                    <small>{row.qualified ? `${row.qualified} qualified lead${row.qualified === 1 ? "" : "s"}` : "No qualified lead"} · {row.firstAid ? "First aid covered" : "First aid gap"}{row.absent.length ? ` · ${row.absent.length} absent` : ""}</small>
                    <div>
                      {row.assignments.map((assignment) => {
                        const staff = labStaffRoster.find((item) => item.id === assignment.staffId);
                        return (
                          <button key={assignment.id} type="button" onClick={() => markStaffAbsent(row.day, assignment.staffId)}>
                            {staff?.name || assignment.staffId}<small>{assignment.role} · mark {assignment.status === "Absent" ? "present" : "absent"}</small>
                          </button>
                        );
                      })}
                      {!row.assignments.length && <em>No staff assigned</em>}
                    </div>
                  </div>
                ))}
              </div>
            </article>
            <article>
              <div>
                <p className="eyebrow">Roster</p>
                <h3>Assign staff to selected activity</h3>
              </div>
              <div className="lab-staff-roster">
                {labStaffRoster.map((staff) => {
                  const load = staffLoadRows.find((row) => row.staff.id === staff.id);
                  return (
                    <div key={staff.id}>
                      <header>
                        <strong>{staff.name}</strong>
                        <span>{load?.assigned || 0}/{staff.maxSessions}</span>
                      </header>
                      <p>{staff.role} · {staff.qualified ? "Qualified" : "Unqualified"} · {staff.firstAid ? "First aid" : "No first aid"}</p>
                      <small>{staff.sites.join(", ")}</small>
                      <div className="lab-staff-roster-days">
                        {staffingSession.days.map((day) => {
                          const assigned = staffAssignments.some((assignment) => assignment.sessionId === staffingSession.id && assignment.day === day && assignment.staffId === staff.id);
                          return <button className={assigned ? "active" : ""} key={day} type="button" onClick={() => toggleStaffAssignment(day, staff.id)}>{day.split(" ")[0]}</button>;
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          </section>
        </section>
      )}

      {labView === "Capacity" && (
        <section className="lab-capacity-manager">
          <div className="lab-capacity-hero">
            <div>
              <p className="eyebrow">Waitlist & Capacity Manager</p>
              <h2>Open spaces, promote families and keep capacity honest.</h2>
              <p>Model day-by-day capacity, see waitlist pressure, send parent offers and move children into live booking states when space opens.</p>
            </div>
            <div className={capacityOverbookedDays ? "lab-capacity-verdict overbooked" : "lab-capacity-verdict"}>
              <span>{capacityTotalSpaces} open spaces</span>
              <strong>{capacityWaitlistChildren} waiting</strong>
              <small>{capacityOverbookedDays ? `${capacityOverbookedDays} day${capacityOverbookedDays === 1 ? "" : "s"} overbooked` : "No overbooked days"}</small>
            </div>
          </div>
          <div className="lab-capacity-toolbar">
            <label>Activity<select value={capacitySession.id} onChange={(event) => setCapacitySessionId(event.target.value)}>
              {sessions.map((session) => <option key={session.id} value={session.id}>{session.site} · {session.title}</option>)}
            </select></label>
            <button type="button" onClick={seedWaitlistDemand}>Seed Waitlist</button>
            <button type="button" onClick={exportCapacityPlan}>Export Capacity</button>
          </div>
          <div className="lab-capacity-cards">
            {capacityCards.map(([label, value, text]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{text}</small>
              </article>
            ))}
          </div>
          <section className="lab-capacity-grid">
            <article>
              <div>
                <p className="eyebrow">Daily capacity</p>
                <h3>{capacitySession.site}</h3>
              </div>
              <div className="lab-capacity-days">
                {capacityRows.map((row) => (
                  <div className={row.overbooked ? "overbooked" : row.spaces ? "open" : "full"} key={row.day}>
                    <header>
                      <strong>{row.day}</strong>
                      <span>{row.overbooked ? "Overbooked" : row.spaces ? `${row.spaces} open` : "Full"}</span>
                    </header>
                    <p>{row.confirmed}/{row.capacity} confirmed · {row.waitlist} waiting · {row.fill}% fill</p>
                    <div className="lab-capacity-bar"><span style={{ width: `${Math.min(120, row.capacity ? (row.confirmed / row.capacity) * 100 : 0)}%` }} /></div>
                    <footer>
                      <button type="button" onClick={() => updateDayCapacity(row.day, -1)}>- Capacity</button>
                      <button type="button" onClick={() => updateDayCapacity(row.day, 1)}>+ Capacity</button>
                    </footer>
                  </div>
                ))}
              </div>
            </article>
            <article>
              <div>
                <p className="eyebrow">Waitlist queue</p>
                <h3>Families waiting for space</h3>
              </div>
              <div className="lab-waitlist-queue">
                {waitlistDrafts.map((draft, index) => (
                  <div key={draft.id}>
                    <header>
                      <strong>{draft.parentName || "Parent"}</strong>
                      <span>#{draft.waitlistRank || index + 1}</span>
                    </header>
                    <p>{draft.children?.join(", ") || draft.childName} · {(draft.days || []).join(", ")}</p>
                    <small>{draft.parentEmail || "No email"} · {money(Number(draft.total || 0))}</small>
                    <footer>
                      <button type="button" onClick={() => sendWaitlistOffer(draft)}>Send Offer</button>
                      <button type="button" onClick={() => promoteWaitlistBooking(draft.id)}>Promote</button>
                    </footer>
                  </div>
                ))}
                {!waitlistDrafts.length && <p>No waitlist bookings for this activity. Seed demand or create an over-capacity parent checkout.</p>}
              </div>
            </article>
          </section>
          <section className="lab-capacity-offers">
            <div>
              <p className="eyebrow">Offer history</p>
              <h3>Local waitlist messages</h3>
            </div>
            <div>
              {messageLog.filter((message) => message.template === "Waitlist offer").slice(0, 8).map((message) => (
                <article key={message.id}>
                  <strong>{message.subject}</strong>
                  <span>{message.recipient}</span>
                  <p>{message.body}</p>
                </article>
              ))}
              {!messageLog.some((message) => message.template === "Waitlist offer") && <p>No waitlist offers sent yet.</p>}
            </div>
          </section>
        </section>
      )}

      {labView === "Comms" && (
        <section className="lab-comms-studio">
          <div className="lab-comms-studio-hero">
            <div>
              <p className="eyebrow">Notifications & Templates Studio</p>
              <h2>Design parent comms before the system starts sending them.</h2>
              <p>Edit confirmation, payment, waitlist, incident and launch templates with booking variables, then send local previews into the parent message history.</p>
            </div>
            <div className="lab-comms-token-card">
              <span>Variables</span>
              <strong>{"{parent} {activity} {site}"}</strong>
              <small>{"Also: {days}, {children}, {total}, {reference}, {deadline}"}</small>
            </div>
          </div>
          <div className="lab-comms-stats">
            {templateStats.map(([label, value, text]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{text}</small>
              </article>
            ))}
          </div>
          <section className="lab-template-workbench">
            <article>
              <div>
                <p className="eyebrow">Template library</p>
                <h3>Message types</h3>
              </div>
              <div className="lab-template-list">
                {messageTemplates.map((template) => (
                  <button className={activeTemplate.id === template.id ? "active" : ""} key={template.id} type="button" onClick={() => setActiveTemplateId(template.id)}>
                    <span>{template.channel} · {template.trigger}</span>
                    <strong>{template.name}</strong>
                    <small>{template.subject}</small>
                  </button>
                ))}
              </div>
              <div className="lab-template-library-actions">
                <button type="button" onClick={duplicateTemplate}>Duplicate</button>
                <button type="button" onClick={resetTemplates}>Reset Defaults</button>
              </div>
            </article>
            <article>
              <div>
                <p className="eyebrow">Editor</p>
                <h3>{activeTemplate.name}</h3>
              </div>
              <form className="lab-template-form" onSubmit={saveTemplate}>
                <label>Name<input name="name" defaultValue={activeTemplate.name} key={`${activeTemplate.id}-name`} /></label>
                <label>Channel<select name="channel" defaultValue={activeTemplate.channel} key={`${activeTemplate.id}-channel`}>
                  <option>Email</option>
                  <option>SMS</option>
                  <option>Email/SMS</option>
                </select></label>
                <label>Trigger<input name="trigger" defaultValue={activeTemplate.trigger} key={`${activeTemplate.id}-trigger`} /></label>
                <label className="full">Subject<input name="subject" defaultValue={activeTemplate.subject} key={`${activeTemplate.id}-subject`} /></label>
                <label className="full">Body<textarea name="body" rows="7" defaultValue={activeTemplate.body} key={`${activeTemplate.id}-body`} /></label>
                <button type="submit">Save Template</button>
                <button type="button" onClick={sendTemplatePreview}>Send Preview</button>
              </form>
            </article>
          </section>
          <section className="lab-template-preview-grid">
            <article>
              <div>
                <p className="eyebrow">Preview</p>
                <h3>{templatePreviewDraft.parentName || "Parent"}</h3>
              </div>
              <div className="lab-template-preview">
                <strong>{renderTemplateText(activeTemplate.subject)}</strong>
                <p>{renderTemplateText(activeTemplate.body)}</p>
                <small>Previewing against {templatePreviewDraft.activity} · {(templatePreviewDraft.days || []).join(", ")}</small>
              </div>
            </article>
            <article>
              <div>
                <p className="eyebrow">Recent comms</p>
                <h3>Local message log</h3>
              </div>
              <div className="lab-template-message-log">
                {messageLog.slice(0, 8).map((message) => (
                  <div key={message.id}>
                    <strong>{message.subject}</strong>
                    <span>{message.template} · {message.recipient}</span>
                    <p>{message.body}</p>
                  </div>
                ))}
                {!messageLog.length && <p>No local messages generated yet.</p>}
              </div>
            </article>
          </section>
        </section>
      )}

      {labView === "QA" && (
        <section className="lab-parent-qa">
          <div className="lab-parent-qa-hero">
            <div>
              <p className="eyebrow">Parent Experience QA</p>
              <h2>Score the parent journey before parents feel the pain.</h2>
              <p>Review search, session choice, child details, rule clarity, payment friction, support risk, comms coverage and mobile readiness in one product QA panel.</p>
            </div>
            <div className={`lab-parent-qa-score risk-${parentQaRisk.toLowerCase()}`}>
              <span>{parentQaRisk} risk</span>
              <strong>{parentQaScore}%</strong>
              <small>{parentQaChecks.filter(([, pass]) => pass).length}/{parentQaChecks.length} checks passing</small>
            </div>
          </div>
          <div className="lab-parent-qa-cards">
            {parentQaCards.map(([label, value, text]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{text}</small>
              </article>
            ))}
          </div>
          <section className="lab-parent-qa-grid">
            <article>
              <div>
                <p className="eyebrow">Journey checks</p>
                <h3>Where the flow is clear or risky</h3>
              </div>
              <div className="lab-parent-qa-checks">
                {parentQaChecks.map(([label, pass, detail, guidance]) => (
                  <div className={pass ? "pass" : "fail"} key={label}>
                    <header>
                      <strong>{label}</strong>
                      <span>{pass ? "Pass" : "Review"}</span>
                    </header>
                    <p>{detail}</p>
                    <small>{guidance}</small>
                  </div>
                ))}
              </div>
            </article>
            <article>
              <div>
                <p className="eyebrow">Friction signals</p>
                <h3>Operational clues that parents may struggle</h3>
              </div>
              <div className="lab-parent-qa-friction">
                {parentQaFrictionRows.map(([label, value, text]) => (
                  <div key={label}>
                    <strong>{value}</strong>
                    <span>{label}</span>
                    <p>{text}</p>
                  </div>
                ))}
              </div>
              <div className="lab-parent-qa-recommendations">
                <strong>Recommended next fixes</strong>
                {(parentQaChecks.filter(([, pass]) => !pass).length ? parentQaChecks.filter(([, pass]) => !pass) : parentQaChecks.slice(0, 3)).slice(0, 4).map(([label,, detail, guidance]) => (
                  <p key={label}><span>{label}</span>{guidance} Current signal: {detail}.</p>
                ))}
              </div>
            </article>
          </section>
          <section className="lab-parent-qa-snapshot">
            <div>
              <p className="eyebrow">Current parent snapshot</p>
              <h3>{activeFamily.parentName}</h3>
            </div>
            <div>
              <article><span>Search</span><strong>{careType} · {area}</strong><small>{query || "No keyword"} · {filteredSessions.length} result{filteredSessions.length === 1 ? "" : "s"}</small></article>
              <article><span>Booking</span><strong>{activeSession.site}</strong><small>{activeSession.title} · {pickedDays.join(", ") || "No days selected"}</small></article>
              <article><span>Payment</span><strong>{paymentMethod}</strong><small>{money(total)} current basket · {isWaitlist ? "waitlist likely" : "capacity visible"}</small></article>
              <article><span>Support</span><strong>{supportTickets.filter((ticket) => ticket.status !== "Resolved").length} open</strong><small>{messageLog.length} local message{messageLog.length === 1 ? "" : "s"}</small></article>
            </div>
          </section>
        </section>
      )}

      {labView === "Data Model" && <DataModelLab onExport={exportSchemaNotes} />}

      {labView === "Readiness" && <ReadinessLab onExport={exportReadinessPlan} />}

      {labView === "Parent" && <section className="booking-lab-flow" id="booking-lab-flow">
        <div className="lab-search-panel">
          <div className="lab-panel-heading">
            <p className="eyebrow">Find care</p>
            <h2>Start with what the parent knows.</h2>
          </div>
          <div className="lab-controls">
            <label>Care type<select value={careType} onChange={(event) => setCareType(event.target.value)}>
              <option>All</option>
              <option>Wraparound</option>
              <option>Holiday Camp</option>
            </select></label>
            <label>Area<select value={area} onChange={(event) => setArea(event.target.value)}>
              <option>All</option>
              {[...new Set(sessions.map((session) => session.area))].map((item) => <option key={item}>{item}</option>)}
            </select></label>
            <label className="lab-search-input">Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="School, camp or activity" /></label>
          </div>
          <div className="lab-session-list">
            {filteredSessions.map((session) => (
              <button className={activeSession.id === session.id ? "active" : ""} key={session.id} type="button" onClick={() => chooseSession(session)}>
                <span>{session.type}</span>
                <strong>{session.site}</strong>
                <small>{session.title} · {session.time}</small>
                <em>{session.capacity} places · {session.age}</em>
              </button>
            ))}
          </div>
          <div className="lab-mini-basket">
            <span>Basket</span>
            <strong>{pickedDays.length} sessions · {childCount} child{childCount === 1 ? "" : "ren"}</strong>
            <small>{isWaitlist ? "Waitlist likely" : `${remainingSpaces} spaces visible for selected activity`}</small>
          </div>
        </div>

        <div className="lab-booking-panel">
          <section className="lab-parent-portal">
            <div className="lab-parent-portal-head">
              <div>
                <p className="eyebrow">Parent portal</p>
                <h2>{activeFamily.parentName}</h2>
                <p>{activeFamily.email} · {activeFamily.phone || "No phone recorded"}</p>
              </div>
              <button className="button light" type="button" onClick={() => setLabView("Family")}>Edit Family Records</button>
            </div>
            <div className="lab-parent-portal-cards">
              {parentPortalCards.map(([label, value, text]) => (
                <article key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                  <small>{text}</small>
                </article>
              ))}
            </div>
            <div className="lab-parent-portal-grid">
              <article>
                <h3>Upcoming bookings</h3>
                <div className="lab-parent-bookings">
                  {activeFamilyBookings.slice(0, 5).map((draft) => (
                    <div key={draft.id}>
                      <strong>{draft.activity}</strong>
                      <span>{draft.site} · {(draft.days || []).join(", ")}</span>
                      <small>{draft.status} · {money(Number(draft.total || 0))}{draft.creditEvents?.length ? ` · credit ${money(draft.creditEvents.reduce((sum, event) => sum + Number(event.amount || 0), 0))}` : ""}</small>
                      <div>
                        <button type="button" onClick={() => amendParentBooking(draft.id)}>Amend</button>
                        <button type="button" onClick={() => cancelParentBooking(draft.id)}>Cancel</button>
                        {draft.status !== "Prototype paid" && <button type="button" onClick={() => payParentBooking(draft.id)}>Pay</button>}
                        <button type="button" onClick={() => downloadReceipt(draft)}>Receipt</button>
                      </div>
                    </div>
                  ))}
                  {!activeFamilyBookings.length && <p>No upcoming prototype bookings for this family yet.</p>}
                </div>
              </article>
              <article>
                <h3>Message inbox</h3>
                <div className="lab-parent-inbox">
                  {familyMessages.slice(0, 5).map((message) => (
                    <div key={message.id}>
                      <strong>{message.subject}</strong>
                      <span>{message.recipient}</span>
                      <p>{message.body}</p>
                    </div>
                  ))}
                  {!familyMessages.length && <p>No local messages for this family yet.</p>}
                </div>
              </article>
            </div>
          </section>
          <div className="lab-parent-wallet">
            <article>
              <span>Parent account</span>
              <strong>{activeFamily.parentName}</strong>
              <small>{activeFamily.email} · {drafts.length} saved booking{drafts.length === 1 ? "" : "s"}</small>
            </article>
            <article>
              <span>Payment wallet</span>
              <strong>Card · TFC · Vouchers</strong>
              <small>Built for live payment plus reconciliation paths.</small>
            </article>
            <article>
              <span>Promo</span>
              <strong>{promoCode.trim().toUpperCase() === "APRES10" ? "APRES10 applied" : "Try APRES10"}</strong>
              <small>Prototype code for discount testing.</small>
            </article>
            <article>
              <span>Credit balance</span>
              <strong>{money(familyCreditBalance)}</strong>
              <small>Created by local cancellations and cheaper amendments.</small>
            </article>
          </div>
          {amendment && amendmentSession && (
            <section className="lab-amendment-panel">
              <div className="lab-amendment-head">
                <div>
                  <p className="eyebrow">Amend booking</p>
                  <h2>{amendment.activity}</h2>
                  <p>{amendment.site} · updates save back to the original booking.</p>
                </div>
                <button type="button" onClick={() => setAmendment(null)}>Close</button>
              </div>
              <div className="lab-amendment-grid">
                <article>
                  <span>Days</span>
                  <div className="lab-amendment-picks">
                    {amendmentSession.days.map((day) => (
                      <button className={amendmentDays.includes(day) ? "active" : ""} key={day} type="button" onClick={() => toggleAmendmentDay(day)}>{day}</button>
                    ))}
                  </div>
                </article>
                <article>
                  <span>Children</span>
                  <div className="lab-amendment-picks">
                    {allChildProfiles.map((child) => (
                      <button className={amendmentChildren.includes(child.name) ? "active" : ""} key={child.id} type="button" onClick={() => toggleAmendmentChild(child.name)}>
                        {child.name}<small>{child.year}</small>
                      </button>
                    ))}
                  </div>
                </article>
                <article>
                  <span>Extras</span>
                  <div className="lab-amendment-picks">
                    {amendmentAddOns.map((item) => (
                      <button className={amendment.addOns.includes(item.label) ? "active" : ""} key={item.id} type="button" onClick={() => toggleAmendmentAddOn(item.label)}>
                        {item.label}<small>{money(item.price)}</small>
                      </button>
                    ))}
                  </div>
                </article>
                <article>
                  <span>Payment state</span>
                  <label>Route<select value={amendment.paymentMethod} onChange={(event) => updateAmendmentField("paymentMethod", event.target.value)}>
                    <option value="card">Card</option>
                    <option value="tfc">Tax-Free Childcare</option>
                    <option value="voucher">Childcare voucher</option>
                    <option value="invoice">Invoice</option>
                  </select></label>
                  {amendment.paymentMethod !== "card" && <label>Reference<input value={amendment.paymentReference} onChange={(event) => updateAmendmentField("paymentReference", event.target.value)} placeholder="Voucher, TFC or parent note" /></label>}
                </article>
              </div>
              <div className="lab-amendment-summary">
                <div><span>Original</span><strong>{money(Number(originalAmendmentDraft?.total || 0))}</strong></div>
                <div><span>New total</span><strong>{money(amendmentTotal)}</strong></div>
                <div><span>Difference</span><strong>{amendmentDelta >= 0 ? "+" : ""}{money(amendmentDelta)}</strong></div>
                <div><span>Credit/Due</span><strong>{amendmentDelta < 0 ? `${money(Math.abs(amendmentDelta))} credit` : `${money(amendmentDelta)} due`}</strong></div>
                <div><span>Status after save</span><strong>{amendment.paymentMethod === "card" ? "Prototype paid" : "Payment pending"}</strong></div>
                <button type="button" onClick={saveParentAmendment}>Save Amendment</button>
              </div>
            </section>
          )}
          <div className="lab-selected-head">
            <div>
              <p className="eyebrow">Selected activity</p>
              <h2>{activeSession.title}</h2>
              <p>{activeSession.site} · {activeSession.area} · {activeSession.time}</p>
            </div>
            <strong>{money(activeSession.price)}<span>per child/session</span></strong>
          </div>
          <div className="lab-feature-row">
            {activeSession.features.map((feature) => <span key={feature}>{feature}</span>)}
          </div>
          <div className="lab-mode-row">
            {["Ad-hoc", "Full week", "Same day weekly"].map((mode) => (
              <button className={bookingMode === mode ? "active" : ""} key={mode} type="button" onClick={() => applyBookingMode(mode)}>{mode}</button>
            ))}
          </div>
          <div className={rulesBlocked ? "lab-rule-panel blocked" : "lab-rule-panel"}>
            <div>
              <strong>{rulesBlocked ? "Rules check failed" : "Rules check passed"}</strong>
              <span>{activeSession.type === "Wraparound" ? "School-only eligibility" : `${rules.holidayYearMin} to ${rules.holidayYearMax}`}</span>
            </div>
            <div>
              {eligibilityIssues.length ? eligibilityIssues.map((issue) => <span key={issue}>{issue}</span>) : <span>Selected children match the current rules.</span>}
            </div>
            {rules.allowAdminOverride && eligibilityIssues.length > 0 && (
              <label className="lab-override-line">
                <input type="checkbox" checked={adminOverride} onChange={(event) => setAdminOverride(event.target.checked)} />
                Admin override
                <select value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)}>
                  {overrideReasons.map((reason) => <option key={reason}>{reason}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="lab-day-grid" aria-label="Choose sessions">
            {activeSession.days.map((day) => (
              <button className={pickedDays.includes(day) ? "active" : ""} key={day} type="button" onClick={() => toggleDay(day)}>
                <strong>{day}</strong>
                <span>{remainingSpaces} places left</span>
              </button>
            ))}
          </div>
          {isWaitlist && <div className="lab-capacity-warning">Selected children exceed visible capacity. Checkout will create a waitlist request instead of a confirmed booking.</div>}

          <form className="lab-checkout" onSubmit={submitBooking}>
            <div className="lab-checkout-header">
              <div>
                <p className="eyebrow">Checkout</p>
                <h3>{checkoutStep}</h3>
              </div>
              <strong>{Math.round(checkoutProgress)}%</strong>
            </div>
            <div className="lab-stepper" aria-label="Checkout steps">
              {checkoutSteps.map((step, index) => (
                <button className={stageClass(step)} key={step} type="button" onClick={() => setCheckoutStep(step)}>
                  <span>{index + 1}</span>
                  {step}
                </button>
              ))}
            </div>
            <div className="lab-progress-track"><span style={{ width: `${checkoutProgress}%` }} /></div>
            {status && <div className={status.includes("Choose") ? "form-status warn" : "form-status success"}>{status}</div>}
            {confirmation && (
              <div className="lab-confirmation">
                <strong>{confirmation.status === "Waitlist" ? "Waitlist request saved" : "Booking draft saved"}</strong>
                <span>{confirmation.children?.join(", ")} · {confirmation.days?.length} sessions · {money(confirmation.total)}</span>
              </div>
            )}
            <section className={`lab-checkout-stage ${stageClass("Children")}`}>
              <div className="lab-stage-heading">
                <span>1</span>
                <div>
                  <h3>Choose children</h3>
                  <p>Use saved profiles or add a guest child before continuing.</p>
                </div>
              </div>
              <div className="lab-child-picker">
              <div>
                <span>Children</span>
                <strong>{childCount} selected</strong>
              </div>
              <div className="lab-child-chips">
                {allChildProfiles.map((child) => (
                  <button className={selectedChildIds.includes(child.id) ? "active" : ""} key={child.id} type="button" onClick={() => toggleChild(child.id)}>
                    <strong>{child.name}</strong>
                    <small>{child.year} · {child.school}</small>
                  </button>
                ))}
              </div>
              <div className="lab-guest-child">
                <input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Add another child" />
                <button className="button light" type="button" onClick={addGuestChild}>Add</button>
              </div>
              <div className="lab-child-flags">
                {selectedChildren.flatMap((child) => child.flags.map((flag) => `${child.name}: ${flag}`)).map((flag) => <span key={flag}>{flag}</span>)}
                {!selectedChildren.some((child) => child.flags.length) && <span>No child flags selected</span>}
              </div>
              </div>
              <div className="lab-stage-actions"><button type="button" onClick={() => moveCheckoutStep(1)}>Next: Extras</button></div>
            </section>
            <section className={`lab-checkout-stage ${stageClass("Extras")}`}>
              <div className="lab-stage-heading">
                <span>2</span>
                <div>
                  <h3>Add extras</h3>
                  <p>Optional items stay tied to each child session.</p>
                </div>
              </div>
              <div className="lab-addons">
                <span>Optional extras</span>
                <div>
                  {availableAddOns.map((item) => (
                    <button className={selectedAddOns.includes(item.id) ? "active" : ""} key={item.id} type="button" onClick={() => toggleAddOn(item.id)}>
                      {item.label}<strong>{money(item.price)}</strong>
                    </button>
                  ))}
                </div>
              </div>
              <div className="lab-stage-actions">
                <button type="button" onClick={() => moveCheckoutStep(-1)}>Back</button>
                <button type="button" onClick={() => moveCheckoutStep(1)}>Next: Details</button>
              </div>
            </section>
            <section className={`lab-checkout-stage ${stageClass("Details")}`}>
              <div className="lab-stage-heading">
                <span>3</span>
                <div>
                  <h3>Parent and care details</h3>
                  <p>These details feed confirmations, emergency contacts and registers.</p>
                </div>
              </div>
              <div className="lab-form-grid">
                <label>Parent name<input required name="parentName" placeholder="Parent or carer name" /></label>
                <label>Email<input required type="email" name="parentEmail" placeholder="name@example.com" /></label>
                <label>Lead child name<input required name="childName" placeholder="First child name" defaultValue={selectedChildren[0]?.name || ""} /></label>
                <label>School year<select name="schoolYear"><option>Reception</option><option>Year 1</option><option>Year 2</option><option>Year 3</option><option>Year 4</option><option>Year 5</option><option>Year 6</option></select></label>
                <label>Emergency phone<input required name="emergencyPhone" placeholder="Mobile number" /></label>
                <label>Authorised collector<input required name="collector" placeholder="Named collector" /></label>
                <label className="full">Medical, allergy or collection notes<textarea name="medicalNotes" rows="3" placeholder="Anything staff need visible on the register." /></label>
              </div>
              <div className="lab-stage-actions">
                <button type="button" onClick={() => moveCheckoutStep(-1)}>Back</button>
                <button type="button" onClick={() => moveCheckoutStep(1)}>Next: Payment</button>
              </div>
            </section>
            <section className={`lab-checkout-stage ${stageClass("Payment")}`}>
              <div className="lab-stage-heading">
                <span>4</span>
                <div>
                  <h3>Payment route</h3>
                  <p>Take card payment now, or reserve while TFC and vouchers are reconciled.</p>
                </div>
              </div>
              <div className="lab-payment-options">
                {labPaymentOptions.map(([value, label, text]) => (
                  <label className={paymentMethod === value ? "active" : ""} key={value}>
                    <input type="radio" name="paymentMethod" value={value} checked={paymentMethod === value} onChange={(event) => setPaymentMethod(event.target.value)} />
                    <strong>{label}</strong>
                    <span>{text}</span>
                  </label>
                ))}
              </div>
              {paymentMethod !== "card" && <label className="lab-payment-reference">Payment reference<input name="paymentReference" placeholder="Voucher provider, TFC code or parent note" /></label>}
              <label className="lab-payment-reference">Promo code<input value={promoCode} onChange={(event) => setPromoCode(event.target.value)} placeholder="APRES10" /></label>
              <div className="lab-stage-actions">
                <button type="button" onClick={() => moveCheckoutStep(-1)}>Back</button>
                <button type="button" onClick={() => moveCheckoutStep(1)}>Next: Review</button>
              </div>
            </section>
            <section className={`lab-checkout-stage ${stageClass("Review")}`}>
              <div className="lab-stage-heading">
                <span>5</span>
                <div>
                  <h3>Review and confirm</h3>
                  <p>Check price, policies and required consents before saving the booking locally.</p>
                </div>
              </div>
              <div className="lab-review-grid">
                <div className="lab-total-card">
                  <div><span>Sessions</span><strong>{pickedDays.length}</strong></div>
                  <div><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
                  <div><span>Add-ons</span><strong>{money(addOnTotal)}</strong></div>
                  <div><span>Discounts</span><strong>-{money(siblingDiscount + weeklyDiscount + promoDiscount)}</strong></div>
                  <div className="total"><span>Total today</span><strong>{money(total)}</strong></div>
                </div>
                <aside className="lab-review-rail">
                  {checkoutSummary.map(([label, value]) => (
                    <div key={label}><span>{label}</span><strong>{value}</strong></div>
                  ))}
                </aside>
              </div>
              <div className="lab-consents">
                <label><input required type="checkbox" name="terms" /> Booking terms accepted</label>
                <label><input required type="checkbox" name="emergencyConsent" /> Emergency care consent</label>
                <label><input required type="checkbox" name="dataConsent" /> Store child data for registers</label>
              </div>
              <div className="lab-deadline-strip">
                <span>Cancel up to {rules.cancellationHours}h before</span>
                <span>Amend up to {rules.amendmentHours}h before</span>
                <span>Voucher/TFC due within {rules.paymentDueHours}h</span>
              </div>
              <div className="lab-stage-actions final">
                <button type="button" onClick={() => moveCheckoutStep(-1)}>Back</button>
                <button className="button book large" type="submit">{isWaitlist ? "Join Waitlist" : paymentMethod === "card" ? "Prototype Pay Now" : "Reserve Place"}</button>
              </div>
            </section>
          </form>
          <section className="lab-parent-history">
            <div>
              <p className="eyebrow">Parent history</p>
              <h2>Recent local bookings</h2>
            </div>
            <div>
              {drafts.slice(0, 4).map((draft) => (
                <article key={draft.id}>
                  <strong>{draft.activity}</strong>
                  <span>{draft.site} · {draft.days?.length || 0} sessions · {draft.status}</span>
                  <small>{money(Number(draft.total || 0))}</small>
                </article>
              ))}
              {!drafts.length && <p>No prototype bookings saved yet.</p>}
            </div>
          </section>
        </div>
      </section>}
    </section>
  );
}
