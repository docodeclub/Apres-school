import { hasSupabaseConfig, supabase } from "./supabaseClient.js";

export function bookingSystemConfigured() {
  return Boolean(hasSupabaseConfig && supabase);
}

export async function getParentAuthSession() {
  assertSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session || null;
}

export async function fetchCurrentProfile() {
  assertSupabase();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const userId = sessionData.session?.user?.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, active")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function signInParentAccount({ email, password } = {}) {
  assertSupabase();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Parent email is required.");
  if (!password) throw new Error("Password is required.");
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signOutParentAccount() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function manageParentAccountAccess(payload = {}) {
  assertSupabase();
  const { data, error } = await supabase.functions.invoke("manage-parent-account", {
    body: payload,
  });
  if (error) {
    const detail = await readFunctionError(error);
    throw new Error(detail || error.message || "Parent account action failed.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function registerParentAccount(payload = {}) {
  assertSupabase();
  const { data, error } = await supabase.functions.invoke("register-parent-account", {
    body: payload,
  });
  if (error) {
    const detail = await readFunctionError(error);
    throw new Error(detail || error.message || "Parent registration failed.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function inviteParentAccountHolder({ parentAccountId, email, fullName } = {}) {
  assertSupabase();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!parentAccountId) throw new Error("Parent account is required.");
  if (!normalizedEmail) throw new Error("Second account holder email is required.");

  const loginUrl = typeof window !== "undefined"
    ? `${window.location.origin}/launch-booking`
    : undefined;
  const { data, error } = await supabase.functions.invoke("manage-parent-account", {
    body: {
      action: "invite-holder",
      parentAccountId,
      email: normalizedEmail,
      fullName: fullName || "",
      loginUrl,
    },
  });
  if (error) {
    const detail = await readFunctionError(error);
    throw new Error(detail || error.message || "Second account holder invite failed.");
  }
  if (data?.error) throw new Error(data.error);
  return data?.holder || data;
}

export async function removeParentAccountHolder(holderId) {
  assertSupabase();
  if (!holderId) throw new Error("Second account holder is required.");
  const { data, error } = await supabase.functions.invoke("manage-parent-account", {
    body: {
      action: "remove-holder",
      holderId,
    },
  });
  if (error) {
    const detail = await readFunctionError(error);
    throw new Error(detail || error.message || "Second account holder removal failed.");
  }
  if (data?.error) throw new Error(data.error);
  return data?.holder || data;
}

export async function fetchBookableSessions({ from = new Date(), limit = 120 } = {}) {
  assertSupabase();
  const fromIso = from instanceof Date ? from.toISOString() : new Date(from).toISOString();
  const { data, error } = await supabase
    .from("sessions")
    .select(`
      id,
      starts_at,
      ends_at,
      capacity,
      status,
      booking_label,
      parent_bookable,
      price,
      payment_route,
      cancellation_hours,
      amendment_hours,
      booking_cutoff_hours,
      eligibility,
      programmes(
        id,
        name,
        category,
        locations(id, name, area)
      ),
      session_blocks(
        id,
        label,
        starts_at,
        ends_at,
        price,
        capacity,
        parent_bookable,
        sort_order
      )
    `)
    .eq("parent_bookable", true)
    .gte("starts_at", fromIso)
    .order("starts_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data || []).map(mapBookableSession);
}

export async function fetchParentAccount() {
  assertSupabase();
  const user = await currentUser();
  const missingLinkedHolderTableCodes = ["42P01", "42703", "PGRST200", "PGRST205"];
  const parentAccountBaseSelect = `
    id,
    profile_id,
    full_name,
    email,
    phone,
    billing_address,
    emergency_contact,
    child_profiles(
      id,
      full_name,
      preferred_name,
      date_of_birth,
      school_name,
      year_group,
      medical_notes,
      allergy_notes,
      dietary_notes,
      authorised_collectors,
      consents,
      flags,
      active
    )
  `;
  const parentAccountSelect = `
    ${parentAccountBaseSelect},
    parent_account_holders(
      id,
      email,
      full_name,
      role,
      status,
      invited_at,
      accepted_at,
      permissions
    )
  `;
  let { data, error } = await supabase
    .from("parent_accounts")
    .select(parentAccountSelect)
    .or(`profile_id.eq.${user.id},email.eq.${user.email}`)
    .maybeSingle();

  if (error && missingLinkedHolderTableCodes.includes(error.code)) {
    const fallback = await supabase
      .from("parent_accounts")
      .select(parentAccountBaseSelect)
      .or(`profile_id.eq.${user.id},email.eq.${user.email}`)
      .maybeSingle();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  if (data) return mapParentAccount({ ...data, account_holder_role: "primary" });

  const { data: holder, error: holderError } = await supabase
    .from("parent_account_holders")
    .select(`
      id,
      role,
      status,
      parent_accounts(${parentAccountBaseSelect})
    `)
    .or(`profile_id.eq.${user.id},email.eq.${user.email}`)
    .neq("status", "removed")
    .limit(1)
    .maybeSingle();

  if (holderError) {
    if (missingLinkedHolderTableCodes.includes(holderError.code)) return null;
    throw holderError;
  }

  return holder?.parent_accounts
    ? mapParentAccount({
      ...holder.parent_accounts,
      account_holder_role: holder.role || "secondary",
      account_holder_status: holder.status || "active",
    })
    : null;
}

export async function fetchParentBookingLedger({ limit = 80 } = {}) {
  assertSupabase();
  await currentUser();

  const { data: invoices, error: invoiceError } = await supabase
    .from("booking_invoices")
    .select(`
      id,
      booking_id,
      parent_id,
      parent_email,
      provider_payment_id,
      provider_reference,
      total_amount,
      paid_amount,
      refunded_amount,
      balance,
      currency,
      payment_status,
      parent_portal_status,
      receipt_status,
      finance_status,
      last_provider_event_id,
      metadata,
      created_at,
      updated_at,
      booking_receipts(
        id,
        receipt_number,
        amount,
        currency,
        delivery_status,
        issued_at,
        payment_id,
        provider_reference,
        provider_event_id,
        metadata
      ),
      booking_payment_admin_actions(
        id,
        action,
        status,
        actor_email,
        actor_role,
        parent_email,
        provider_reference,
        message_log_id,
        note,
        metadata,
        created_at
      ),
      ponchopay_checkout_sessions(
        id,
        provider_payment_id,
        provider_checkout_url,
        provider_reference,
        amount,
        currency,
        payment_method,
        payment_plan,
        status,
        error_message,
        expires_at,
        created_at,
        updated_at
      )
    `)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (invoiceError) throw invoiceError;

  const { data: bookings, error: bookingError } = await supabase
    .from("bookings")
    .select(`
      id,
      booking_reference,
      invoice_id,
      parent_email,
      parent_name,
      status,
      payment_method,
      payment_plan,
      payment_route,
      total_amount,
      due_today,
      outstanding_balance,
      cancellation_deadline,
      amendment_deadline,
      metadata,
      created_at,
      updated_at,
      booking_items(
        id,
        child_name,
        site_name,
        programme_name,
        session_label,
        starts_at,
        ends_at,
        quantity,
        unit_amount,
        line_total,
        status,
        metadata
      )
    `)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (bookingError) throw bookingError;

  return {
    invoices: (invoices || []).map(mapParentInvoice),
    bookings: (bookings || []).map(mapParentLedgerBooking),
    fetchedAt: new Date().toISOString(),
  };
}

export async function upsertParentAccount(parent) {
  assertSupabase();
  const user = await currentUser();
  const email = String(parent?.email || user.email || "").trim().toLowerCase();
  if (!email) throw new Error("Parent email is required.");

  const payload = {
    profile_id: user.id,
    full_name: parent?.fullName || parent?.full_name || user.user_metadata?.full_name || email,
    email,
    phone: parent?.phone || null,
    billing_address: parent?.billingAddress || parent?.billing_address || {},
    emergency_contact: parent?.emergencyContact || parent?.emergency_contact || {},
    marketing_preferences: parent?.marketingPreferences || parent?.marketing_preferences || {},
  };

  const { data, error } = await supabase
    .from("parent_accounts")
    .upsert(payload, { onConflict: "email" })
    .select("id, profile_id, full_name, email, phone, billing_address, emergency_contact")
    .single();

  if (error) throw error;
  return mapParentAccount(data);
}

export async function createChildProfile(child = {}) {
  assertSupabase();
  const parentAccount = await fetchParentAccount();
  if (!parentAccount?.id) throw new Error("Create or sign in to a parent account before adding a child.");

  const payload = {
    parent_account_id: parentAccount.id,
    full_name: child.fullName || child.full_name || child.name || "Child",
    preferred_name: child.preferredName || child.preferred_name || child.firstName || null,
    date_of_birth: child.dateOfBirth || child.date_of_birth || child.dob || null,
    school_name: child.schoolName || child.school_name || child.school || null,
    year_group: child.yearGroup || child.year_group || child.classroom || child.year || null,
    medical_notes: child.medicalNotes || child.medical_notes || "",
    allergy_notes: child.allergyNotes || child.allergy_notes || "",
    dietary_notes: child.dietaryNotes || child.dietary_notes || "",
    authorised_collectors: child.authorisedCollectors || child.authorised_collectors || [],
    consents: child.consents || {},
    flags: child.flags || [],
    active: child.active !== false,
  };

  const { data, error } = await supabase
    .from("child_profiles")
    .insert(payload)
    .select(`
      id,
      full_name,
      preferred_name,
      date_of_birth,
      school_name,
      year_group,
      medical_notes,
      allergy_notes,
      dietary_notes,
      authorised_collectors,
      consents,
      flags,
      active
    `)
    .single();

  if (error) throw error;
  return mapChildProfile(data);
}

export async function createParentBooking(request) {
  assertSupabase();
  const items = normaliseBookingItems(request.items || []);
  if (!items.length) throw new Error("Choose at least one session before booking.");
  const clientRequestId = request.clientRequestId || request.metadata?.clientRequestId || request.metadata?.localDraftId || "";

  const { data, error } = await supabase.functions.invoke("create-parent-booking", {
    body: {
      parent: request.parent || {},
      booking: request.booking || {},
      clientRequestId,
      paymentMethod: request.paymentMethod || "card",
      paymentPlan: request.paymentPlan || "pay_now",
      paymentRoute: request.paymentRoute || items[0]?.paymentRoute || "ponchopay_card_voucher",
      depositAmount: request.depositAmount || 0,
      cancellationHours: request.cancellationHours ?? 24,
      amendmentHours: request.amendmentHours ?? 24,
      source: request.source || "parent_portal",
      successUrl: request.successUrl,
      cancelUrl: request.cancelUrl,
      metadata: {
        ...(request.metadata || {}),
        clientRequestId,
      },
      items: items.map((item) => ({
        childId: item.childId,
        childName: item.childName,
        sessionBlockId: item.sessionBlockId,
        labSessionId: item.labSessionId,
        sessionDate: item.sessionDate,
        sessionLabel: item.sessionLabel,
        quantity: item.quantity,
        metadata: item.metadata || {},
      })),
    },
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function createPonchoPayCheckout(payload) {
  assertSupabase();
  const { data, error } = await supabase.functions.invoke("ponchopay-create-checkout", {
    body: payload,
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function cancelParentBooking({ bookingId, reason = "" } = {}) {
  assertSupabase();
  if (!bookingId) throw new Error("Choose a booking to cancel.");
  const { data, error } = await supabase.functions.invoke("update-parent-booking", {
    body: {
      action: "cancel",
      bookingId,
      reason,
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function removeParentBookingItems({ bookingId, bookingItemIds = [], reason = "" } = {}) {
  assertSupabase();
  const ids = Array.isArray(bookingItemIds) ? bookingItemIds.filter(Boolean) : [];
  if (!bookingId) throw new Error("Choose a booking to amend.");
  if (!ids.length) throw new Error("Choose at least one session to remove.");
  const { data, error } = await supabase.functions.invoke("update-parent-booking", {
    body: {
      action: "remove_items",
      bookingId,
      bookingItemIds: ids,
      reason,
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function addParentBookingItems({ bookingId, items = [], reason = "" } = {}) {
  assertSupabase();
  const normalisedItems = normaliseBookingItems(items);
  if (!bookingId) throw new Error("Choose a booking to amend.");
  if (!normalisedItems.length) throw new Error("Choose at least one session to add.");
  const { data, error } = await supabase.functions.invoke("update-parent-booking", {
    body: {
      action: "add_items",
      bookingId,
      items: normalisedItems.map((item) => ({
        childId: item.childId,
        childName: item.childName,
        sessionBlockId: item.sessionBlockId,
        labSessionId: item.labSessionId,
        sessionDate: item.sessionDate,
        sessionLabel: item.sessionLabel,
        quantity: item.quantity,
        metadata: item.metadata || {},
      })),
      reason,
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function updateLivePaymentAdminAction({ invoiceId, action, note = "", amount = null, reason = "", metadata = {} } = {}) {
  assertSupabase();
  if (!invoiceId) throw new Error("Choose an invoice first.");
  if (!action) throw new Error("Choose a payment action.");
  const { data, error } = await supabase.functions.invoke("update-parent-booking", {
    body: {
      action,
      invoiceId,
      note,
      amount,
      reason,
      metadata,
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function upsertLiveBookingSessionSetup(setup = {}) {
  assertSupabase();
  const payload = {
    school: String(setup.school || "").trim(),
    dateFrom: setup.dateFrom,
    dateTo: setup.dateTo,
    sessionLabel: String(setup.sessionLabel || "").trim(),
    timeWindow: String(setup.timeWindow || "").trim(),
    price: setup.price,
    capacity: setup.capacity,
    eligibility: String(setup.eligibility || "").trim(),
    paymentRoute: String(setup.paymentRoute || "").trim(),
    cancellationHours: setup.cancellationHours,
    applySimilar: setup.applySimilar !== false,
    applyScope: setup.applySimilar === false ? "single_session_range" : "matching_session_name",
  };
  if (!payload.school) throw new Error("School is required.");
  if (!payload.dateFrom || !payload.dateTo) throw new Error("Choose a date range.");
  const { data, error } = await supabase.rpc("admin_upsert_booking_session_setup", {
    p_setup: payload,
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function upsertLiveBookingSessionOverride(override = {}) {
  assertSupabase();
  const status = String(override.status || "").trim();
  const payload = {
    school: String(override.school || "").trim(),
    sessionDate: override.sessionDate,
    sessionLabel: String(override.sessionLabel || "").trim(),
    timeWindow: String(override.timeWindow || "").trim(),
    price: override.price,
    capacity: override.capacity,
    status,
    parentBookable: override.parentBookable !== false && !["closed", "cancelled", "full"].includes(status),
    eligibility: String(override.eligibility || "").trim(),
    paymentRoute: String(override.paymentRoute || "").trim(),
    cancellationHours: override.cancellationHours,
    notes: String(override.notes || "").trim(),
  };
  if (!payload.school) throw new Error("School is required.");
  if (!payload.sessionDate) throw new Error("Choose the day to override.");
  const { data, error } = await supabase.rpc("admin_upsert_booking_session_override", {
    p_override: payload,
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

function mapBookableSession(row) {
  const programme = row.programmes || {};
  const location = programme.locations || {};
  return {
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    capacity: row.capacity,
    status: row.status,
    label: row.booking_label || programme.name || "Session",
    price: Number(row.price || 0),
    paymentRoute: row.payment_route,
    cancellationHours: row.cancellation_hours,
    amendmentHours: row.amendment_hours,
    eligibility: row.eligibility || {},
    programme: {
      id: programme.id,
      name: programme.name,
      category: programme.category,
    },
    site: {
      id: location.id,
      name: location.name,
      area: location.area,
    },
    blocks: (row.session_blocks || [])
      .filter((block) => block.parent_bookable !== false)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      .map((block) => ({
        id: block.id,
        label: block.label,
        startsAt: block.starts_at,
        endsAt: block.ends_at,
        price: Number(block.price || row.price || 0),
        capacity: block.capacity ?? row.capacity,
      })),
  };
}

function mapParentAccount(row) {
  return {
    id: row.id,
    profileId: row.profile_id,
    accountHolderRole: row.account_holder_role || "primary",
    accountHolderStatus: row.account_holder_status || "active",
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    billingAddress: row.billing_address || {},
    emergencyContact: row.emergency_contact || {},
    linkedAccountHolders: (row.parent_account_holders || []).map((holder) => ({
      id: holder.id,
      email: holder.email,
      fullName: holder.full_name,
      role: holder.role || "secondary",
      status: holder.status || "invited",
      invitedAt: holder.invited_at,
      acceptedAt: holder.accepted_at,
      permissions: holder.permissions || {},
    })),
    children: (row.child_profiles || []).map(mapChildProfile),
  };
}

function mapChildProfile(child) {
  return {
    id: child.id,
    fullName: child.full_name,
    preferredName: child.preferred_name,
    dateOfBirth: child.date_of_birth,
    schoolName: child.school_name,
    yearGroup: child.year_group,
    medicalNotes: child.medical_notes,
    allergyNotes: child.allergy_notes,
    dietaryNotes: child.dietary_notes,
    authorisedCollectors: child.authorised_collectors || [],
    consents: child.consents || {},
    flags: child.flags || [],
    active: child.active,
  };
}

function mapParentInvoice(row) {
  return {
    id: row.id,
    bookingId: row.booking_id,
    parentId: row.parent_id,
    parentEmail: row.parent_email,
    providerPaymentId: row.provider_payment_id,
    providerReference: row.provider_reference,
    totalAmount: Number(row.total_amount || 0),
    paidAmount: Number(row.paid_amount || 0),
    refundedAmount: Number(row.refunded_amount || 0),
    balance: Number(row.balance || 0),
    currency: row.currency || "GBP",
    paymentStatus: row.payment_status,
    parentPortalStatus: row.parent_portal_status,
    receiptStatus: row.receipt_status,
    financeStatus: row.finance_status,
    lastProviderEventId: row.last_provider_event_id,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    receipts: asArray(row.booking_receipts).map((receipt) => ({
      id: receipt.id,
      receiptNumber: receipt.receipt_number,
      amount: Number(receipt.amount || 0),
      currency: receipt.currency || "GBP",
      deliveryStatus: receipt.delivery_status,
      issuedAt: receipt.issued_at,
      paymentId: receipt.payment_id,
      providerReference: receipt.provider_reference,
      providerEventId: receipt.provider_event_id,
      metadata: receipt.metadata || {},
    })),
    adminActions: asArray(row.booking_payment_admin_actions).map((action) => ({
      id: action.id,
      action: action.action,
      status: action.status,
      actorEmail: action.actor_email,
      actorRole: action.actor_role,
      parentEmail: action.parent_email,
      providerReference: action.provider_reference,
      messageLogId: action.message_log_id,
      note: action.note,
      metadata: action.metadata || {},
      createdAt: action.created_at,
    })),
    checkoutSessions: asArray(row.ponchopay_checkout_sessions).map((session) => ({
      id: session.id,
      providerPaymentId: session.provider_payment_id,
      checkoutUrl: session.provider_checkout_url,
      providerReference: session.provider_reference,
      amount: Number(session.amount || 0),
      currency: session.currency || "GBP",
      paymentMethod: session.payment_method,
      paymentPlan: session.payment_plan,
      status: session.status,
      errorMessage: session.error_message,
      expiresAt: session.expires_at,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
    })),
  };
}

function mapParentLedgerBooking(row) {
  return {
    id: row.id,
    bookingReference: row.booking_reference,
    invoiceId: row.invoice_id,
    parentEmail: row.parent_email,
    parentName: row.parent_name,
    status: row.status,
    paymentMethod: row.payment_method,
    paymentPlan: row.payment_plan,
    paymentRoute: row.payment_route,
    totalAmount: Number(row.total_amount || 0),
    dueToday: Number(row.due_today || 0),
    outstandingBalance: Number(row.outstanding_balance || 0),
    cancellationDeadline: row.cancellation_deadline,
    amendmentDeadline: row.amendment_deadline,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: asArray(row.booking_items).map((item) => ({
      id: item.id,
      childName: item.child_name,
      siteName: item.site_name,
      programmeName: item.programme_name,
      sessionLabel: item.session_label,
      startsAt: item.starts_at,
      endsAt: item.ends_at,
      quantity: Number(item.quantity || 0),
      unitAmount: Number(item.unit_amount || 0),
      lineTotal: Number(item.line_total || 0),
      status: item.status,
      metadata: item.metadata || {},
    })),
  };
}

function normaliseBookingItems(items) {
  return items.map((item) => ({
    childId: item.childId || item.child_id || null,
    childName: item.childName || item.child_name || "",
    sessionId: item.sessionId || item.session_id || "",
    sessionBlockId: item.sessionBlockId || item.session_block_id || null,
    labSessionId: item.labSessionId || item.lab_session_id || item.metadata?.labSessionId || "",
    sessionDate: item.sessionDate || item.session_date || item.metadata?.sessionDate || "",
    siteName: item.siteName || item.site_name || "",
    programmeName: item.programmeName || item.programme_name || "",
    sessionLabel: required(item.sessionLabel || item.session_label || item.metadata?.labBlockLabel, "Session label"),
    startsAt: item.startsAt || item.starts_at || "",
    endsAt: item.endsAt || item.ends_at || "",
    quantity: Math.max(1, Number(item.quantity || 1)),
    unitAmount: roundMoney(Number(item.unitAmount ?? item.unit_amount ?? 0)),
    paymentRoute: item.paymentRoute || item.payment_route || "ponchopay_card_voucher",
    capacitySnapshot: item.capacitySnapshot || item.capacity_snapshot || {},
    metadata: item.metadata || {},
    status: item.status || "reserved",
  }));
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return [value];
}

async function readFunctionError(error) {
  const context = error?.context;
  if (!context || typeof context.json !== "function") return "";
  try {
    const body = await context.json();
    return body?.error || body?.message || "";
  } catch {
    return "";
  }
}

async function currentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data?.user) throw new Error("Sign in before booking.");
  return data.user;
}

function assertSupabase() {
  if (!bookingSystemConfigured()) throw new Error("Supabase is not configured.");
}

function required(value, label) {
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}
