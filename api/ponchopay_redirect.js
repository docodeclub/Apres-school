const placeholderValue = /^\s*(?:\{|%7b).*(?:\}|%7d)\s*$/i;

function normaliseBody(body) {
  if (!body) return {};
  if (typeof body === "object" && !Buffer.isBuffer(body)) return body;
  const raw = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // PonchoPay may submit its return as a regular HTML form.
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

export default function handler(request, response) {
  if (!["GET", "HEAD", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, HEAD, POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const query = { ...normaliseBody(request.body), ...(request.query || {}) };
  const params = new URLSearchParams();
  const copyParam = (source, target = source) => {
    const value = query[source];
    if (Array.isArray(value)) {
      value.filter((item) => item && !placeholderValue.test(String(item))).forEach((item) => params.append(target, item));
      return;
    }
    if (typeof value === "string" && value.trim() && !placeholderValue.test(value)) params.set(target, value.trim());
  };

  copyParam("reference");
  copyParam("bookingReference", "reference");
  copyParam("booking_reference", "reference");
  copyParam("invoice");
  copyParam("invoiceId", "invoice");
  copyParam("externalInvoiceId", "invoice");
  copyParam("id");
  copyParam("payment_id", "id");
  copyParam("paymentId", "id");
  copyParam("ponchoPaymentId", "id");

  const rawState = String(query.payment || query.status || query.state || "").toLowerCase();
  const state = rawState.includes("cancel")
    ? "cancelled"
    : rawState === "failed"
      ? "failed"
      : rawState === "pending"
        ? "pending"
        : "complete";
  params.set("payment", state);

  const encodedParams = params.toString();
  const location = `/launch-booking?${encodedParams}`;
  response.setHeader("Cache-Control", "no-store");
  response.redirect(request.method === "POST" ? 303 : 302, location);
}
