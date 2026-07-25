export const config = {
  matcher: "/launch-booking",
};

const placeholderValue = /^\s*(?:\{|%7b).*(?:\}|%7d)\s*$/i;

async function returnFields(request) {
  const contentType = request.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      const value = await request.json();
      return value && typeof value === "object" ? value : {};
    }
    if (contentType.includes("form")) {
      return Object.fromEntries(await request.formData());
    }
    const value = await request.text();
    return value ? Object.fromEntries(new URLSearchParams(value)) : {};
  } catch {
    return {};
  }
}

export default async function middleware(request) {
  if (request.method !== "POST") return;

  const url = new URL(request.url);
  const body = await returnFields(request);
  const firstRealValue = (...keys) => {
    for (const key of keys) {
      const value = String(url.searchParams.get(key) || body[key] || "").trim();
      if (value && !placeholderValue.test(value)) return value;
    }
    return "";
  };

  const reference = firstRealValue("reference", "bookingReference", "booking_reference");
  const invoice = firstRealValue("invoice", "invoiceId", "externalInvoiceId");
  const paymentId = firstRealValue("id", "payment_id", "paymentId", "ponchoPaymentId");
  const stateValue = firstRealValue("payment", "status", "state").toLowerCase();
  const state = stateValue.includes("cancel")
    ? "cancelled"
    : stateValue === "failed"
      ? "failed"
      : "pending";

  url.search = "";
  if (reference) url.searchParams.set("reference", reference);
  if (invoice) url.searchParams.set("invoice", invoice);
  if (paymentId) url.searchParams.set("id", paymentId);
  url.searchParams.set("payment", state);

  return new Response(null, {
    status: 303,
    headers: {
      "Cache-Control": "no-store",
      Location: url.toString(),
    },
  });
}
