type SupabaseLike = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => {
      select: (columns: string) => {
        single: () => Promise<{ data: Record<string, unknown> | null; error: { message?: string } | null }>;
      };
    };
  };
};

type BookingEmailInput = {
  recipientEmail: string;
  recipientName?: string;
  emailType: string;
  subject: string;
  text: string;
  html?: string;
  sentBy?: string | null;
  metadata?: Record<string, unknown>;
};

const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
const resendFrom =
  Deno.env.get("APRES_BOOKING_EMAIL_FROM") ??
  Deno.env.get("APRES_EMAIL_FROM") ??
  Deno.env.get("RESEND_FROM") ??
  "Après School <hello@apres-school.co.uk>";
const resendReplyTo =
  Deno.env.get("APRES_REPLY_TO") ??
  Deno.env.get("RESEND_REPLY_TO") ??
  "hello@apres-school.co.uk";

export async function sendBookingEmail(supabase: SupabaseLike, input: BookingEmailInput) {
  const recipientEmail = stringValue(input.recipientEmail).toLowerCase();
  if (!recipientEmail) throw new Error("Email recipient is required.");

  let status = "queued_without_provider";
  let providerMessageId = "";
  let errorMessage = "";

  if (resendApiKey) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: resendFrom,
          to: [recipientEmail],
          reply_to: resendReplyTo,
          subject: input.subject,
          text: input.text,
          ...(input.html ? { html: input.html } : {}),
        }),
      });

      if (!response.ok) {
        const detail = await safeResponseText(response);
        throw new Error(`Resend email failed with ${response.status}${detail ? `: ${detail}` : ""}`);
      }

      const result = await response.json().catch(() => null);
      providerMessageId = typeof result?.id === "string" ? result.id : "";
      status = "sent";
    } catch (error) {
      status = "failed";
      errorMessage = error instanceof Error ? error.message : "Email provider failed";
      console.error(errorMessage);
    }
  }

  const { data, error } = await supabase
    .from("email_logs")
    .insert({
      recipient_email: recipientEmail,
      recipient_name: stringValue(input.recipientName) || null,
      email_type: input.emailType,
      subject: input.subject,
      status,
      provider: "resend",
      provider_message_id: providerMessageId || null,
      error_message: errorMessage || null,
      sent_by: input.sentBy || null,
      metadata: {
        ...(input.metadata || {}),
        body: input.text,
        from: resendFrom,
        replyTo: resendReplyTo,
      },
      sent_at: status === "sent" ? new Date().toISOString() : null,
    })
    .select("id, status, provider_message_id, error_message, created_at, sent_at")
    .single();

  if (error) throw new Error(`Email log failed: ${error.message || "unknown error"}`);
  return data;
}

export function escapeHtml(value: unknown) {
  return stringValue(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function paragraphsToHtml(lines: string[]) {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}

async function safeResponseText(response: Response) {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return "";
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
