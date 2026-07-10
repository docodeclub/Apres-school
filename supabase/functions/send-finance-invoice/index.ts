import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey =
  Deno.env.get("APRES_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";
const resendApiKey = Deno.env.get("RESEND_API_KEY");
const resendFrom =
  Deno.env.get("APRES_FINANCE_EMAIL_FROM") ??
  Deno.env.get("RESEND_FROM") ??
  "Après School Finance <hello@apres-school.co.uk>";
const resendReplyTo =
  Deno.env.get("APRES_FINANCE_REPLY_TO") ??
  Deno.env.get("APRES_REPLY_TO") ??
  Deno.env.get("RESEND_REPLY_TO") ??
  "hello@apres-school.co.uk";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const actor = await getActor(request.headers.get("Authorization") || "");
    if (!actor || !["admin", "superadmin"].includes(String(actor.role || "").toLowerCase())) {
      return json({ error: "Not authorised to send finance invoices" }, 403);
    }

    const financeAccess = await hasFinanceAccess(actor);
    if (!financeAccess) return json({ error: "Finance access is not enabled for this account" }, 403);

    const payload = normalizePayload(await request.json());
    const validationError = validatePayload(payload);
    if (validationError) return json({ error: validationError }, 400);

    const invoice = await loadInvoice(payload.invoiceId);
    if (!invoice.invoice_number) return json({ error: "Approve and number this invoice before emailing it." }, 400);

    const customer = relatedCustomer(invoice);
    const recipient = payload.to || customer?.accounts_email || "";
    if (!recipient.includes("@")) return json({ error: "The customer does not have a valid accounts email." }, 400);

    const subject = payload.subject || `Invoice ${invoice.invoice_number} from Après School`;
    const body = payload.body || buildDefaultBody(invoice);
    const sentAt = new Date().toISOString();
    let emailed = false;
    let providerMessageId = "";
    let emailError = "";

    if (resendApiKey) {
      try {
        providerMessageId = await sendEmail({
          to: recipient,
          cc: payload.cc,
          bcc: payload.bcc,
          subject,
          body,
          pdfBase64: payload.pdfBase64,
          pdfFilename: payload.pdfFilename || `apres-invoice-${invoice.invoice_number}.pdf`,
        });
        emailed = true;
      } catch (error) {
        emailError = error instanceof Error ? error.message : "Resend email failed";
        console.error(emailError);
      }
    }

    const emailStatus = emailed ? "sent" : resendApiKey ? "failed" : "queued_without_provider";
    await supabase.from("finance_invoice_emails").insert({
      invoice_id: invoice.id,
      recipient,
      cc: payload.cc.join(", "),
      bcc: payload.bcc.join(", "),
      subject,
      body,
      sent_by: actor.id,
      sent_at: emailed ? sentAt : null,
      status: emailStatus,
      provider_message_id: providerMessageId || null,
      metadata: {
        provider: "resend",
        attachmentFilename: payload.pdfFilename || `apres-invoice-${invoice.invoice_number}.pdf`,
        error: emailError,
      },
    });

    await logEmail({
      recipientEmail: recipient,
      recipientName: customer?.accounts_contact || customer?.customer_name || "",
      subject,
      status: emailStatus,
      providerMessageId,
      errorMessage: emailError,
      sentBy: actor.id,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        customerId: invoice.customer_id,
        cc: payload.cc,
        bcc: payload.bcc,
      },
    });

    if (emailed) {
      await supabase
        .from("finance_invoices")
        .update({
          status: invoice.status === "paid" ? invoice.status : "sent",
          sent_by: actor.id,
          sent_at: sentAt,
          updated_at: sentAt,
        })
        .eq("id", invoice.id);
    }

    await supabase.from("finance_audit_events").insert({
      invoice_id: invoice.id,
      customer_id: invoice.customer_id,
      actor_id: actor.id,
      action: emailed ? "Invoice emailed" : "Invoice email queued",
      detail: `${invoice.invoice_number} to ${recipient}`,
      metadata: { cc: payload.cc, bcc: payload.bcc, emailStatus, emailError },
    });

    await supabase.from("audit_log").insert({
      actor_id: actor.id,
      action: emailed ? "finance_invoice_emailed" : "finance_invoice_email_not_sent",
      table_name: "finance_invoices",
      record_id: invoice.id,
      metadata: {
        detail: `${invoice.invoice_number} to ${recipient}`,
        module: "School Finance",
        emailStatus,
        emailError,
      },
    });

    return json({ emailed, emailStatus, emailError, providerMessageId, recipient });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unable to send finance invoice" }, 500);
  }
});

async function getActor(authHeader: string) {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, full_name, email")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  return profile;
}

async function hasFinanceAccess(actor: { id: string; role?: string }) {
  if (String(actor.role || "").toLowerCase() === "superadmin") return true;
  const { data, error } = await supabase
    .from("finance_permissions")
    .select("id")
    .eq("profile_id", actor.id)
    .eq("permission", "finance_admin")
    .limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

async function loadInvoice(invoiceId: string) {
  const { data, error } = await supabase
    .from("finance_invoices")
    .select("id, customer_id, invoice_number, status, total, balance_due, finance_customers(customer_name, accounts_contact, accounts_email)")
    .eq("id", invoiceId)
    .single();
  if (error) throw error;
  return data;
}

async function sendEmail(entry: {
  to: string;
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  pdfBase64: string;
  pdfFilename: string;
}) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: resendFrom,
      to: [entry.to],
      cc: entry.cc.length ? entry.cc : undefined,
      bcc: entry.bcc.length ? entry.bcc : undefined,
      reply_to: resendReplyTo,
      subject: entry.subject,
      text: entry.body,
      attachments: [
        {
          filename: entry.pdfFilename,
          content: entry.pdfBase64,
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await safeResponseText(response);
    throw new Error(`Resend email failed with ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  const result = await response.json().catch(() => null);
  return typeof result?.id === "string" ? result.id : "";
}

async function logEmail(entry: {
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  status: string;
  providerMessageId?: string;
  errorMessage?: string;
  sentBy?: string;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await supabase.from("email_logs").insert({
    recipient_email: entry.recipientEmail,
    recipient_name: entry.recipientName || null,
    email_type: "finance_invoice",
    subject: entry.subject,
    status: entry.status,
    provider: "resend",
    provider_message_id: entry.providerMessageId || null,
    error_message: entry.errorMessage || null,
    sent_by: entry.sentBy || null,
    metadata: entry.metadata || {},
    sent_at: entry.status === "sent" ? new Date().toISOString() : null,
  });
  if (error) console.error(`Email log failed: ${error.message}`);
}

async function safeResponseText(response: Response) {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return "";
  }
}

function relatedCustomer(invoice: Record<string, unknown>) {
  const relation = invoice.finance_customers as
    | { customer_name?: string; accounts_contact?: string; accounts_email?: string }
    | { customer_name?: string; accounts_contact?: string; accounts_email?: string }[]
    | null
    | undefined;
  return Array.isArray(relation) ? relation[0] || null : relation || null;
}

function buildDefaultBody(invoice: Record<string, unknown>) {
  const customer = relatedCustomer(invoice);
  return [
    `Dear ${customer?.customer_name || "Accounts team"},`,
    "",
    `Please find attached invoice ${invoice.invoice_number}.`,
    "",
    "Payment details are included on the invoice. Please use the invoice number as the payment reference.",
    "",
    "Thank you,",
    "Après School Finance",
  ].join("\n");
}

function normalizePayload(payload: Record<string, unknown>) {
  return {
    invoiceId: stringValue(payload.invoiceId),
    to: stringValue(payload.to || payload.toEmail).toLowerCase(),
    cc: stringList(payload.cc),
    bcc: stringList(payload.bcc),
    subject: stringValue(payload.subject),
    body: stringValue(payload.body),
    pdfBase64: stringValue(payload.pdfBase64),
    pdfFilename: stringValue(payload.pdfFilename),
  };
}

function validatePayload(payload: ReturnType<typeof normalizePayload>) {
  if (!payload.invoiceId) return "Invoice ID is required";
  if (!payload.pdfBase64) return "Invoice PDF attachment is required";
  return null;
}

function stringList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => stringValue(item)).filter(Boolean);
  return stringValue(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
