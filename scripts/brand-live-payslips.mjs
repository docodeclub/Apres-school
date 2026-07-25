#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const PROJECT_REF = "djkfuftbtfthjpezvjuu";
const BUCKET = "staff-hr-files";
const BRAND_VERSION = "apres-payslip-v2-official-footer";
const serviceKey = process.env.APRES_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;
const confirm = process.argv.includes("--confirm");
const force = process.argv.includes("--force");
const allStaff = process.argv.includes("--all");
const staffArgIndex = process.argv.indexOf("--staff");
const previewArgIndex = process.argv.indexOf("--preview-output");
const staffQuery = staffArgIndex >= 0 ? String(process.argv[staffArgIndex + 1] || "").trim() : "";
const previewOutput = previewArgIndex >= 0 ? String(process.argv[previewArgIndex + 1] || "").trim() : "";
const python = process.env.PAYSLIP_PYTHON || "python3";

if (!serviceKey) fail("Set APRES_SERVICE_ROLE_KEY before running this migration.");
if (!staffQuery && !allStaff) fail("Choose --all or a staff member with --staff \"Name\".");

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: records, error: recordsError } = await supabase
  .from("staff_hr_files")
  .select(`
    id,
    title,
    issue_date,
    storage_path,
    source_storage_path,
    document_brand_version,
    branded_at,
    staff_record_id,
    hr_file_categories(name),
    staff_records!staff_hr_files_staff_record_id_fkey(
      id,
      preferred_name,
      profiles!staff_records_profile_id_fkey(full_name, email)
    )
  `)
  .eq("status", "active")
  .is("archived_at", null)
  .order("issue_date");

if (recordsError) fail(`Could not load payslip records: ${recordsError.message}`);

const requested = staffQuery.toLowerCase();
const payslips = (records || []).filter((record) => {
  const category = one(record.hr_file_categories);
  const staff = one(record.staff_records);
  const profile = one(staff?.profiles);
  const name = String(profile?.full_name || staff?.preferred_name || "").toLowerCase();
  return category?.name === "Payslip"
    && (allStaff || name.includes(requested))
    && record.storage_path
    && (force || record.document_brand_version !== BRAND_VERSION);
});

if (!payslips.length) {
  console.log(allStaff ? "No unbranded active payslips found." : `No unbranded active payslips found for "${staffQuery}".`);
  process.exit(0);
}

console.log(`${confirm ? "Live replacement" : "Dry run"} for ${allStaff ? "all remaining staff" : staffQuery}`);
console.log(`Payslips selected: ${payslips.length}`);

const prepared = [];
const conversionFailures = [];
let previewWritten = false;
for (const record of payslips) {
  const staff = one(record.staff_records);
  const profile = one(staff?.profiles);
  const staffName = profile?.full_name || staff?.preferred_name || staffQuery;
  const originalStoragePath = record.source_storage_path || record.storage_path;
  const temporarySource = path.join(os.tmpdir(), `apres-source-${randomUUID()}.pdf`);
  const temporaryBranded = path.join(os.tmpdir(), `apres-branded-${randomUUID()}.pdf`);
  try {
    const { data: sourceBlob, error: downloadError } = await supabase.storage
      .from(BUCKET)
      .download(originalStoragePath);
    if (downloadError) throw downloadError;
    const sourceBytes = new Uint8Array(await sourceBlob.arrayBuffer());
    await writeFile(temporarySource, sourceBytes);

    const conversion = spawnSync(
      python,
      ["scripts/brand_payslip.py", temporarySource, temporaryBranded, "--json"],
      { cwd: process.cwd(), encoding: "utf8", maxBuffer: 1024 * 1024 * 4 },
    );
    if (conversion.status !== 0) {
      throw new Error(cleanProcessError(conversion.stderr || conversion.stdout || "Conversion failed"));
    }

    const extracted = parseConverterJson(conversion.stdout);
    const brandedBytes = new Uint8Array(await readFile(temporaryBranded));
    const validation = await validateReplacement(sourceBytes, brandedBytes, extracted);
    if (!validation.ok) throw new Error(validation.error);

    if (previewOutput && !previewWritten) {
      await writeFile(previewOutput, brandedBytes);
      previewWritten = true;
      console.log(`Preview: ${previewOutput}`);
    }

    prepared.push({
      record,
      staffName,
      originalStoragePath,
      brandedBytes,
      checksum: sha256(brandedBytes),
      processDate: extracted.process_date,
    });
    console.log(`READY ${record.issue_date?.slice(0, 7) || extracted.process_date} - ${record.title || "Payslip"}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    conversionFailures.push({ staffName, title: record.title || record.id, message });
    console.log(`SKIPPED ${record.issue_date?.slice(0, 7) || "unknown period"} - ${staffName} - ${record.title || "Payslip"}: ${message}`);
  } finally {
    await Promise.all([
      rm(temporarySource, { force: true }),
      rm(temporaryBranded, { force: true }),
    ]);
  }
}

if (!confirm) {
  console.log(`Dry run complete. ${prepared.length} payslip${prepared.length === 1 ? "" : "s"} passed document validation.`);
  if (conversionFailures.length) console.log(`${conversionFailures.length} non-standard document${conversionFailures.length === 1 ? "" : "s"} require separate review.`);
  process.exit(0);
}

let replaced = 0;
for (const item of prepared) {
  const period = String(item.processDate || item.record.issue_date || "payslip").replaceAll("/", "-");
  const brandedStoragePath = `${item.record.staff_record_id}/branded/${period}-${Date.now()}-${randomUUID().slice(0, 8)}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(brandedStoragePath, item.brandedBytes, {
      cacheControl: "3600",
      contentType: "application/pdf",
      upsert: false,
    });
  if (uploadError) fail(`Upload failed for ${item.record.title}: ${uploadError.message}`);

  try {
    const { data: uploadedBlob, error: verifyDownloadError } = await supabase.storage
      .from(BUCKET)
      .download(brandedStoragePath);
    if (verifyDownloadError) throw verifyDownloadError;
    const uploadedBytes = new Uint8Array(await uploadedBlob.arrayBuffer());
    if (sha256(uploadedBytes) !== item.checksum) throw new Error("Uploaded PDF checksum did not match the verified document");

    const { error: updateError } = await supabase
      .from("staff_hr_files")
      .update({
        source_storage_path: item.originalStoragePath,
        storage_path: brandedStoragePath,
        document_brand_version: BRAND_VERSION,
        branded_at: new Date().toISOString(),
      })
      .eq("id", item.record.id);
    if (updateError) throw updateError;
    if (item.record.storage_path !== item.originalStoragePath && item.record.storage_path !== brandedStoragePath) {
      await supabase.storage.from(BUCKET).remove([item.record.storage_path]);
    }
    replaced += 1;
    console.log(`REPLACED ${item.record.issue_date?.slice(0, 7) || item.processDate} - ${item.record.title || "Payslip"}`);
  } catch (error) {
    await supabase.storage.from(BUCKET).remove([brandedStoragePath]);
    fail(`Live replacement failed for ${item.record.title}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`Complete. Replaced ${replaced}/${prepared.length} verified payslips. Original PDFs remain in private storage.`);
if (conversionFailures.length) console.log(`Left ${conversionFailures.length} non-standard document${conversionFailures.length === 1 ? "" : "s"} unchanged for separate review.`);

async function validateReplacement(sourceBytes, brandedBytes, extracted) {
  const [source, branded] = await Promise.all([pdfText(sourceBytes), pdfText(brandedBytes)]);
  const sourceNumbers = decimalValues(source.text);
  const brandedNumbers = decimalValues(branded.text);
  if (JSON.stringify(sourceNumbers) !== JSON.stringify(brandedNumbers)) {
    return { ok: false, error: "The branded PDF did not preserve every decimal payroll value" };
  }
  const requiredText = [
    "Après School",
    "PAYSLIP",
    extracted.employee_name,
    extracted.process_date,
    extracted.ni_number,
    extracted.net_pay,
    "Total Gross Pay",
  ].filter(Boolean);
  const missing = requiredText.filter((value) => !branded.text.includes(value));
  if (missing.length) return { ok: false, error: `The branded PDF is missing required fields: ${missing.join(", ")}` };
  if (branded.pages !== 1) return { ok: false, error: "The branded PDF must contain exactly one page" };
  if (Math.abs(branded.width - 595.276) > 2 || Math.abs(branded.height - 419.528) > 2) {
    return { ok: false, error: `Unexpected branded PDF dimensions ${branded.width.toFixed(1)} x ${branded.height.toFixed(1)}` };
  }
  return { ok: true };
}

async function pdfText(bytes) {
  const document = await getDocument({ data: new Uint8Array(bytes), disableWorker: true, verbosity: 0 }).promise;
  const lines = [];
  let firstWidth = 0;
  let firstHeight = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    if (pageNumber === 1) {
      firstWidth = viewport.width;
      firstHeight = viewport.height;
    }
    const content = await page.getTextContent();
    const rows = new Map();
    for (const item of content.items || []) {
      const value = String(item.str || "").trim();
      if (!value) continue;
      const y = Math.round(Number(item.transform?.[5] || 0));
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push(item);
    }
    for (const [, items] of Array.from(rows.entries()).sort((left, right) => right[0] - left[0])) {
      lines.push(items
        .sort((left, right) => Number(left.transform?.[4] || 0) - Number(right.transform?.[4] || 0))
        .map((item) => String(item.str || "").trim())
        .filter(Boolean)
        .join(" "));
    }
  }
  return { text: lines.join("\n"), pages: document.numPages, width: firstWidth, height: firstHeight };
}

function decimalValues(text) {
  return (String(text).match(/(?<!\d)-?[\d,]+\.\d{2,4}(?!\d)/g) || []).sort();
}

function parseConverterJson(output) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Converter did not return extracted payslip data");
  return JSON.parse(output.slice(start, end + 1));
}

function cleanProcessError(value) {
  return String(value).trim().split("\n").slice(-3).join(" ");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function one(value) {
  return Array.isArray(value) ? value[0] : value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
