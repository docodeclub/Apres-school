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
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const iterations = 120000;
const maxFailedAttempts = 5;
const lockMinutes = 5;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const actor = await getActor(request.headers.get("Authorization") || "");
    if (!actor?.id || !actor.email) return json({ error: "Sign in to manage Pay privacy" }, 401);

    const body = await request.json().catch(() => ({}));
    const action = stringValue(body?.action);
    const existing = await getPinRecord(actor.id);

    if (action === "status") {
      return json({
        hasPin: Boolean(existing),
        lockedUntil: futureIso(existing?.locked_until),
      });
    }

    if (action === "set") {
      const pin = validatePin(body?.pin);
      if (existing) return json({ error: "A Pay privacy PIN is already set" }, 409);
      await savePin(actor.id, pin);
      return json({ hasPin: true, configured: true });
    }

    if (action === "verify") {
      if (!existing) return json({ hasPin: false, verified: true });
      const pin = validatePin(body?.pin);
      const result = await verifyPin(existing, pin);
      if (result.locked) {
        return json({
          error: "Too many incorrect attempts. Try again in five minutes or reset with your password.",
          lockedUntil: result.lockedUntil,
        }, 429);
      }
      if (!result.verified) return json({ error: "That PIN is not correct", verified: false }, 401);
      return json({ hasPin: true, verified: true });
    }

    if (action === "change") {
      if (!existing) return json({ error: "No Pay privacy PIN is currently set" }, 404);
      const currentPin = validatePin(body?.currentPin);
      const newPin = validatePin(body?.newPin);
      const result = await verifyPin(existing, currentPin);
      if (result.locked) {
        return json({
          error: "Too many incorrect attempts. Try again in five minutes or reset with your password.",
          lockedUntil: result.lockedUntil,
        }, 429);
      }
      if (!result.verified) return json({ error: "The current PIN is not correct" }, 401);
      await savePin(actor.id, newPin);
      return json({ hasPin: true, changed: true });
    }

    if (action === "reset") {
      const password = stringValue(body?.password);
      const newPin = validatePin(body?.newPin);
      if (!password) return json({ error: "Enter your account password" }, 400);
      await verifyPassword(actor.id, actor.email, password);
      await savePin(actor.id, newPin);
      return json({ hasPin: true, reset: true });
    }

    if (action === "remove") {
      const password = stringValue(body?.password);
      if (!password) return json({ error: "Enter your account password" }, 400);
      await verifyPassword(actor.id, actor.email, password);
      const { error } = await supabase
        .from("staff_pay_privacy_pins")
        .delete()
        .eq("profile_id", actor.id);
      if (error) throw error;
      return json({ hasPin: false, removed: true });
    }

    return json({ error: "Unsupported Pay privacy action" }, 400);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Unable to manage Pay privacy";
    const status = /password is not correct/i.test(message) ? 401 : 500;
    return json({ error: message }, status);
  }
});

async function getActor(authHeader: string) {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email || "" };
}

async function getPinRecord(profileId: string) {
  const { data, error } = await supabase
    .from("staff_pay_privacy_pins")
    .select("profile_id, pin_salt, pin_hash, hash_iterations, failed_attempts, locked_until")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function savePin(profileId: string, pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPin(pin, salt, iterations);
  const { error } = await supabase
    .from("staff_pay_privacy_pins")
    .upsert({
      profile_id: profileId,
      pin_salt: bytesToHex(salt),
      pin_hash: hash,
      hash_iterations: iterations,
      failed_attempts: 0,
      locked_until: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "profile_id" });
  if (error) throw error;
}

async function verifyPin(record: {
  profile_id: string;
  pin_salt: string;
  pin_hash: string;
  hash_iterations: number;
  failed_attempts: number;
  locked_until?: string | null;
}, pin: string) {
  const lockedUntil = futureIso(record.locked_until);
  if (lockedUntil) return { verified: false, locked: true, lockedUntil };

  const candidate = await hashPin(pin, hexToBytes(record.pin_salt), Number(record.hash_iterations || iterations));
  const verified = constantTimeEqual(candidate, record.pin_hash);
  const failedAttempts = verified ? 0 : Number(record.failed_attempts || 0) + 1;
  const nextLockedUntil = !verified && failedAttempts >= maxFailedAttempts
    ? new Date(Date.now() + lockMinutes * 60 * 1000).toISOString()
    : null;
  const { error } = await supabase
    .from("staff_pay_privacy_pins")
    .update({
      failed_attempts: nextLockedUntil ? 0 : failedAttempts,
      locked_until: nextLockedUntil,
      updated_at: new Date().toISOString(),
    })
    .eq("profile_id", record.profile_id);
  if (error) throw error;
  return {
    verified,
    locked: Boolean(nextLockedUntil),
    lockedUntil: nextLockedUntil,
  };
}

async function verifyPassword(userId: string, email: string, password: string) {
  const verifier = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await verifier.auth.signInWithPassword({ email, password });
  if (error || data.user?.id !== userId) {
    throw new Error("Your account password is not correct");
  }
}

async function hashPin(pin: string, salt: Uint8Array, rounds: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt,
    iterations: rounds,
  }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

function validatePin(value: unknown) {
  const pin = stringValue(value);
  if (!/^\d{4}$/.test(pin)) throw new Error("PIN must contain exactly four digits");
  return pin;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string) {
  const pairs = value.match(/.{1,2}/g) || [];
  return new Uint8Array(pairs.map((pair) => Number.parseInt(pair, 16)));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function futureIso(value?: string | null) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now() ? new Date(timestamp).toISOString() : "";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
