export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const functionsUrl = clean(process.env.SUPABASE_FUNCTIONS_URL) ||
    (clean(process.env.SUPABASE_PROJECT_REF) ? `https://${clean(process.env.SUPABASE_PROJECT_REF)}.functions.supabase.co` : "") ||
    functionsUrlFromSupabaseUrl(process.env.VITE_SUPABASE_URL);

  if (!functionsUrl) {
    response.status(500).json({ error: "Supabase functions URL is not configured" });
    return;
  }

  const rawBody = await readRawBody(request);
  const upstream = await fetch(`${functionsUrl.replace(/\/$/, "")}/ponchopay-callback/webhook`, {
    method: "POST",
    headers: forwardedHeaders(request),
    body: rawBody,
  });

  const text = await upstream.text();
  response.status(upstream.status);
  response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
  response.send(text);
}

function forwardedHeaders(request) {
  const headers = {
    "content-type": request.headers["content-type"] || "application/json",
  };
  for (const name of ["signature", "x-ponchopay-signature", "x-signature", "x-webhook-signature"]) {
    const value = request.headers[name];
    if (value) headers[name] = Array.isArray(value) ? value.join(",") : value;
  }
  return headers;
}

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function functionsUrlFromSupabaseUrl(value) {
  const supabaseUrl = clean(value);
  if (!supabaseUrl) return "";
  try {
    const url = new URL(supabaseUrl);
    if (!url.hostname.endsWith(".supabase.co")) return "";
    url.hostname = url.hostname.replace(/\.supabase\.co$/, ".functions.supabase.co");
    return url.origin;
  } catch {
    return "";
  }
}
