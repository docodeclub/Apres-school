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
const brandLogoUrl =
  Deno.env.get("APRES_BRAND_LOGO_URL") ??
  "https://www.apres-school.co.uk/assets/apres-school-text.png";
const brandBlue = "#314bb8";
const brandNavy = "#25304f";
const brandOrange = "#f4aa3d";
const brandGreen = "#2f7d4b";

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
  const cleanedLines = lines
    .map((line) => line.trim())
    .filter(Boolean);
  const paymentUrl = firstUrl(cleanedLines.find((line) => /^Secure payment link:/i.test(line)) || "");
  const content = cleanedLines
    .map((line, index) => lineToEmailHtml(line, index, paymentUrl))
    .join("");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f6ff;font-family:Arial,Helvetica,sans-serif;color:${brandNavy};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6ff;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #dfe6ff;border-radius:24px;overflow:hidden;box-shadow:0 16px 44px rgba(37,48,79,0.12);">
            <tr>
              <td style="background:${brandBlue};padding:22px 26px;">
                <img src="${escapeHtml(brandLogoUrl)}" alt="Après School" width="142" style="display:block;border:0;background:#ffffff;border-radius:16px;padding:10px;max-width:142px;height:auto;">
              </td>
            </tr>
            <tr>
              <td style="height:6px;background:${brandOrange};font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:28px 26px 18px;">
                ${content}
              </td>
            </tr>
            <tr>
              <td style="background:#f8fbff;padding:18px 26px;border-top:1px solid #e8edff;">
                <p style="margin:0 0 6px;font-size:14px;line-height:1.5;color:${brandNavy};font-weight:800;">Après School</p>
                <p style="margin:0;font-size:13px;line-height:1.5;color:#66708a;">Wraparound care, holiday clubs and school partnerships.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function lineToEmailHtml(line: string, index: number, paymentUrl: string) {
  const escaped = escapeHtml(line);
  if (index === 0 && /^Hi\b/i.test(line)) {
    return `<p style="margin:0 0 18px;font-size:18px;line-height:1.45;color:${brandNavy};font-weight:800;">${escaped}</p>`;
  }
  if (/^Reference:|^Total:|^Due today:|^Sessions:/i.test(line)) {
    const [label, ...rest] = line.split(":");
    return `<p style="margin:0 0 10px;font-size:15px;line-height:1.5;color:${brandNavy};"><strong style="color:${brandBlue};">${escapeHtml(label)}:</strong>${escapeHtml(rest.join(":"))}</p>`;
  }
  if (/^Secure payment link:/i.test(line) && paymentUrl) {
    return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0 20px;"><tr><td style="border-radius:999px;background:${brandGreen};"><a href="${escapeHtml(paymentUrl)}" style="display:inline-block;padding:14px 22px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:900;border-radius:999px;">Complete secure payment</a></td></tr></table><p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#66708a;word-break:break-word;">Secure payment link: <a href="${escapeHtml(paymentUrl)}" style="color:${brandBlue};">${escapeHtml(paymentUrl)}</a></p>`;
  }
  if (/^Important:/i.test(line)) {
    return `<p style="margin:20px 0 16px;padding:14px 16px;border-radius:16px;background:#fff7ed;border:1px solid #f7d7a2;font-size:14px;line-height:1.55;color:${brandNavy};"><strong>Important:</strong>${escaped.replace(/^Important:/i, "")}</p>`;
  }
  if (/^Thank you,|^Après School$/i.test(line)) {
    return `<p style="margin:0 0 8px;font-size:15px;line-height:1.5;color:${brandNavy};font-weight:800;">${escaped}</p>`;
  }
  return `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${brandNavy};">${escaped}</p>`;
}

function firstUrl(value: string) {
  return value.match(/https?:\/\/\S+/)?.[0]?.replace(/[),.;]+$/, "") || "";
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
