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
  from?: string;
  sentBy?: string | null;
  metadata?: Record<string, unknown>;
  attachments?: Array<{
    filename: string;
    content: string;
  }>;
};

type BookingEmailHtmlOptions = {
  title?: string;
  preheader?: string;
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
const brandBlue = "#314bb8";
const brandNavy = "#25304f";
const brandOrange = "#f4aa3d";
const actionBlue = "#4f6de8";

export async function sendBookingEmail(supabase: SupabaseLike, input: BookingEmailInput) {
  const recipientEmail = stringValue(input.recipientEmail).toLowerCase();
  if (!recipientEmail) throw new Error("Email recipient is required.");
  const emailFrom = stringValue(input.from) || resendFrom;

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
          from: emailFrom,
          to: [recipientEmail],
          reply_to: resendReplyTo,
          subject: input.subject,
          text: input.text,
          ...(input.html ? { html: input.html } : {}),
          ...(input.attachments?.length ? { attachments: input.attachments } : {}),
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
        from: emailFrom,
        replyTo: resendReplyTo,
        attachments: (input.attachments || []).map((attachment) => attachment.filename),
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

export function paragraphsToHtml(lines: string[], options: BookingEmailHtmlOptions = {}) {
  const cleanedLines = lines
    .map((line) => line.trim())
    .filter(Boolean);
  const actionLine = cleanedLines.find((line) =>
    /^(Secure payment link:|Sign in here:|Create or sign in here:|Parent portal:)/i.test(line)
  ) || "";
  const actionUrl = firstUrl(actionLine);
  const title = stringValue(options.title) || emailTitleFromLines(cleanedLines);
  const preheader = stringValue(options.preheader) || emailPreheaderFromLines(cleanedLines);
  const content = cleanedLines
    .map((line, index) => lineToEmailHtml(line, index, actionUrl))
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light only">
  </head>
  <body style="margin:0;padding:0;background:#eef3ff;font-family:Arial,Helvetica,sans-serif;color:${brandNavy};-webkit-text-size-adjust:100%;text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#eef3ff;padding:26px 10px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;background:#ffffff;border:1px solid #dbe5ff;border-radius:24px;overflow:hidden;box-shadow:0 18px 48px rgba(37,48,79,0.14);">
            <tr>
              <td style="background:#ffffff;padding:22px 24px 18px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td valign="middle">
                      <span style="display:block;color:${brandBlue};font-size:23px;line-height:1.05;font-weight:900;">Après School</span>
                      <span style="display:block;margin-top:5px;color:#c47708;font-size:12px;line-height:1.2;letter-spacing:1.1px;font-weight:900;">Let's Learn and Play</span>
                    </td>
                    <td valign="middle" align="right">
                      <span style="display:inline-block;padding:9px 13px;background:#f4f6ff;border-radius:999px;color:${brandNavy};font-size:13px;line-height:1.2;font-weight:800;">Family booking</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="height:6px;background:${brandOrange};font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:30px 24px 8px;">
                <p style="margin:0 0 9px;font-size:12px;line-height:1.35;letter-spacing:1px;text-transform:uppercase;color:#b96e00;font-weight:900;">Après School Bookings</p>
                <h1 style="margin:0 0 20px;font-size:27px;line-height:1.2;color:${brandNavy};font-weight:900;">${escapeHtml(title)}</h1>
                ${content}
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fbff;border:1px solid #e3ebff;border-radius:18px;">
                  <tr>
                    <td style="padding:16px 18px;">
                      <p style="margin:0 0 6px;font-size:14px;line-height:1.5;color:${brandNavy};font-weight:900;">Need help?</p>
                      <p style="margin:0;font-size:14px;line-height:1.55;color:#66708a;">Reply to this email or contact <a href="mailto:${escapeHtml(resendReplyTo)}" style="color:${brandBlue};font-weight:800;text-decoration:none;">${escapeHtml(resendReplyTo)}</a>.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background:${brandNavy};padding:20px 24px;">
                <p style="margin:0 0 5px;font-size:15px;line-height:1.45;color:#ffffff;font-weight:900;">Après School</p>
                <p style="margin:0;font-size:13px;line-height:1.5;color:#dce5ff;">Wraparound care, holiday clubs and school partnerships.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function lineToEmailHtml(line: string, index: number, actionUrl: string) {
  const escaped = escapeHtml(line);
  if (index === 0 && /^Hi\b/i.test(line)) {
    return `<p style="margin:0 0 18px;font-size:18px;line-height:1.45;color:${brandNavy};font-weight:800;">${escaped}</p>`;
  }
  if (/^Passcode:/i.test(line)) {
    const code = line.split(":").slice(1).join(":").trim();
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px;background:#f7f9ff;border:1px solid #dbe5ff;border-radius:18px;"><tr><td align="center" style="padding:18px 14px;"><p style="margin:0 0 8px;font-size:12px;line-height:1.35;letter-spacing:1px;text-transform:uppercase;color:${brandBlue};font-weight:900;">Passcode</p><p style="margin:0;font-size:34px;line-height:1.1;letter-spacing:6px;color:${brandNavy};font-weight:900;">${escapeHtml(code)}</p></td></tr></table>`;
  }
  if (/^Reference:|^Total:|^Due today:|^Sessions:|^Invoice:|^Receipt:|^Amount paid:|^Amount protected:|^Additional amount:|^Removed value:|^Outstanding balance:|^Reason:/i.test(line)) {
    const [label, ...rest] = line.split(":");
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 8px;background:#f7f9ff;border:1px solid #e3ebff;border-radius:14px;"><tr><td style="padding:12px 14px;"><p style="margin:0;font-size:15px;line-height:1.45;color:${brandNavy};"><strong style="color:${brandBlue};">${escapeHtml(label)}:</strong>${escapeHtml(rest.join(":"))}</p></td></tr></table>`;
  }
  if (/^(Secure payment link:|Sign in here:|Create or sign in here:|Parent portal:)/i.test(line) && actionUrl) {
    const isPayment = /^Secure payment link:/i.test(line);
    const label = isPayment ? "Complete secure payment" : "Open parent portal";
    const prefix = line.split(":")[0] || (isPayment ? "Secure payment link" : "Parent portal");
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0 20px;"><tr><td align="center" style="border-radius:999px;background:${actionBlue};"><a href="${escapeHtml(actionUrl)}" style="display:block;padding:15px 22px;color:#ffffff;text-decoration:none;font-size:17px;line-height:1.35;font-weight:900;border-radius:999px;">${escapeHtml(label)}</a></td></tr></table><p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#66708a;word-break:break-word;">If the button does not work, use this secure link:<br><a href="${escapeHtml(actionUrl)}" style="color:${brandBlue};font-weight:800;">${escapeHtml(actionUrl)}</a></p>`;
  }
  if (/^Important:/i.test(line)) {
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0 16px;background:#fff7ed;border:1px solid #f7d7a2;border-radius:16px;"><tr><td style="padding:14px 16px;"><p style="margin:0;font-size:14px;line-height:1.55;color:${brandNavy};"><strong>Important:</strong>${escaped.replace(/^Important:/i, "")}</p></td></tr></table>`;
  }
  if (/^Thank you,|^Après School$/i.test(line)) {
    return `<p style="margin:0 0 8px;font-size:15px;line-height:1.5;color:${brandNavy};font-weight:800;">${escaped}</p>`;
  }
  return `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${brandNavy};">${escaped}</p>`;
}

function firstUrl(value: string) {
  return value.match(/https?:\/\/\S+/)?.[0]?.replace(/[),.;]+$/, "") || "";
}

function emailTitleFromLines(lines: string[]) {
  const invoice = lines.find((line) => /^Invoice:/i.test(line))?.split(":").slice(1).join(":").trim();
  if (lines.some((line) => /^Secure payment link:/i.test(line))) return "Complete your secure checkout";
  if (lines.some((line) => /booking is confirmed/i.test(line))) return "Your booking is confirmed";
  if (lines.some((line) => /guarantee has been saved/i.test(line))) return "Card guarantee saved";
  if (lines.some((line) => /cancelled/i.test(line))) return "Booking cancellation recorded";
  if (lines.some((line) => /updated/i.test(line))) return "Booking updated";
  return invoice ? `Booking update for ${invoice}` : "Booking update";
}

function emailPreheaderFromLines(lines: string[]) {
  return lines.find((line) => !/^Hi\b/i.test(line) && !/^Reference:|^Total:|^Due today:|^Secure payment link:/i.test(line)) || "Your Après School booking update.";
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
