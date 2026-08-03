type AdminClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

function clientAddress(request: Request) {
  return (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown")
    .split(",")[0]
    .trim();
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((part) => part.toString(16).padStart(2, "0")).join("");
}

export async function enforcePublicRateLimit(
  admin: AdminClient,
  request: Request,
  scope: string,
  options: { limit: number; windowSeconds: number; identity?: string },
) {
  const subject = options.identity ? `${clientAddress(request)}:${options.identity}` : clientAddress(request);
  const { data, error } = await admin.rpc("consume_public_api_rate_limit", {
    p_scope: scope,
    p_subject_hash: await sha256(subject),
    p_limit: options.limit,
    p_window_seconds: options.windowSeconds,
  });
  if (error) throw new Error(`Rate-limit check failed: ${error.message || "unknown error"}`);
  return data === true;
}
