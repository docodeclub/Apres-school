export default function handler(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const query = request.query || {};
  const params = new URLSearchParams();
  const copyParam = (source, target = source) => {
    const value = query[source];
    if (Array.isArray(value)) {
      value.filter(Boolean).forEach((item) => params.append(target, item));
      return;
    }
    if (typeof value === "string" && value.trim()) params.set(target, value.trim());
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

  const destination = state === "cancelled" || state === "failed" ? "/booking/cancel" : "/booking/success";
  const encodedParams = params.toString();
  const location = `${destination}?${encodedParams}#${encodedParams}`;
  response.setHeader("Cache-Control", "no-store");
  response.redirect(302, location);
}
