type StaffEmailDetail = {
  label: string;
  value: string;
  monospace?: boolean;
};

type StaffEmailInput = {
  preheader: string;
  eyebrow?: string;
  title: string;
  greeting: string;
  paragraphs: string[];
  portalLabel?: string;
  footerText?: string;
  action?: {
    label: string;
    url: string;
  };
  details?: StaffEmailDetail[];
  contentHtml?: string;
  notice?: string;
  celebrationImage?: {
    src: string;
    alt: string;
    label?: string;
  };
};

const brandBlue = "#314bb8";
const brandNavy = "#25304f";
const brandOrange = "#f4aa3d";
const actionBlue = "#4f6de8";
const runtimeEnv = (globalThis as any).Deno?.env;
const replyTo =
  runtimeEnv?.get("APRES_REPLY_TO") ??
  runtimeEnv?.get("RESEND_REPLY_TO") ??
  "hello@apres-school.co.uk";

export function buildStaffEmailHtml(input: StaffEmailInput) {
  const paragraphs = input.paragraphs
    .filter(Boolean)
    .map((paragraph) => `<p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:${brandNavy};">${escapeHtml(paragraph)}</p>`)
    .join("");
  const details = input.details?.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:4px 0 22px;background:#f7f9ff;border:1px solid #dbe5ff;border-radius:16px;">
        ${input.details.map((detail, index) => `<tr>
          <td style="padding:${index === 0 ? "16px" : "0 16px 16px"};">
            <p style="margin:0 0 5px;font-size:12px;line-height:1.35;letter-spacing:0.8px;text-transform:uppercase;color:${brandBlue};font-weight:900;">${escapeHtml(detail.label)}</p>
            <p style="margin:0;font-size:${detail.monospace ? "18px" : "15px"};line-height:1.5;color:${brandNavy};font-weight:800;${detail.monospace ? "font-family:Consolas,Monaco,monospace;letter-spacing:0.4px;" : ""}word-break:break-word;">${escapeHtml(detail.value)}</p>
          </td>
        </tr>`).join("")}
      </table>`
    : "";
  const action = input.action?.url
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0 18px;">
        <tr>
          <td align="center" style="border-radius:999px;background:${actionBlue};">
            <a href="${escapeHtml(input.action.url)}" style="display:block;padding:15px 22px;color:#ffffff;text-decoration:none;font-size:17px;line-height:1.35;font-weight:900;border-radius:999px;">${escapeHtml(input.action.label)}</a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 20px;font-size:13px;line-height:1.5;color:#66708a;word-break:break-word;">If the button does not work, use this secure link:<br><a href="${escapeHtml(input.action.url)}" style="color:${brandBlue};font-weight:800;">${escapeHtml(input.action.url)}</a></p>`
    : "";
  const notice = input.notice
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:4px 0 22px;background:#fff7ed;border:1px solid #f7d7a2;border-radius:16px;">
        <tr>
          <td style="padding:14px 16px;">
            <p style="margin:0;font-size:14px;line-height:1.55;color:${brandNavy};"><strong>Important:</strong> ${escapeHtml(input.notice)}</p>
          </td>
        </tr>
      </table>`
    : "";
  const celebrationImage = input.celebrationImage?.src
    ? `<tr>
              <td
                align="center"
                background="${escapeHtml(input.celebrationImage.src)}"
                role="img"
                aria-label="${escapeHtml(input.celebrationImage.alt)}"
                style="background-color:#fffaf2;background-image:url('${escapeHtml(input.celebrationImage.src)}');background-position:center;background-repeat:no-repeat;background-size:cover;padding:72px 20px;"
              >
                <span style="display:inline-block;padding:13px 22px;background:${brandNavy};border:2px solid ${brandOrange};border-radius:999px;color:#ffffff;font-size:18px;line-height:1.2;letter-spacing:2px;text-transform:uppercase;font-weight:900;box-shadow:0 8px 22px rgba(37,48,79,0.22);">
                  ${escapeHtml(input.celebrationImage.label || "Badge awarded")}
                </span>
              </td>
            </tr>`
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light only">
  </head>
  <body style="margin:0;padding:0;background:#eef3ff;font-family:Arial,Helvetica,sans-serif;color:${brandNavy};-webkit-text-size-adjust:100%;text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.preheader)}</div>
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
                      <span style="display:inline-block;padding:9px 13px;background:#f4f6ff;border-radius:999px;color:${brandNavy};font-size:13px;line-height:1.2;font-weight:800;">${escapeHtml(input.portalLabel || "Staff platform")}</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="height:6px;background:${brandOrange};font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            ${celebrationImage}
            <tr>
              <td style="padding:30px 24px 8px;">
                <p style="margin:0 0 9px;font-size:12px;line-height:1.35;letter-spacing:1px;text-transform:uppercase;color:#b96e00;font-weight:900;">${escapeHtml(input.eyebrow || "Après School Staff")}</p>
                <h1 style="margin:0 0 20px;font-size:27px;line-height:1.2;color:${brandNavy};font-weight:900;">${escapeHtml(input.title)}</h1>
                <p style="margin:0 0 20px;font-size:18px;line-height:1.45;color:${brandNavy};font-weight:800;">${escapeHtml(input.greeting)}</p>
                ${paragraphs}
                ${details}
                ${input.contentHtml || ""}
                ${action}
                ${notice}
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fbff;border:1px solid #e3ebff;border-radius:18px;">
                  <tr>
                    <td style="padding:16px 18px;">
                      <p style="margin:0 0 6px;font-size:14px;line-height:1.5;color:${brandNavy};font-weight:900;">Need help?</p>
                      <p style="margin:0;font-size:14px;line-height:1.55;color:#66708a;">Reply to this email or contact <a href="mailto:${escapeHtml(replyTo)}" style="color:${brandBlue};font-weight:800;text-decoration:none;">${escapeHtml(replyTo)}</a>.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background:${brandNavy};padding:20px 24px;">
                <p style="margin:0 0 5px;font-size:15px;line-height:1.45;color:#ffffff;font-weight:900;">Après School</p>
                <p style="margin:0;font-size:13px;line-height:1.5;color:#dce5ff;">${escapeHtml(input.footerText || "Secure staff access for HR, pay, documents and operations.")}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
