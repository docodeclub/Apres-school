#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const PROJECT_REF = "djkfuftbtfthjpezvjuu";
const BUCKET = "staff-hr-files";
const serviceKey = process.env.APRES_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;
const confirm = process.argv.includes("--confirm");

if (!serviceKey) {
  console.error("Set APRES_SERVICE_ROLE_KEY before running this backfill.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function money(value) {
  return `£${Number(value).toFixed(2)}`;
}

async function extractPayslipPayData(bytes) {
  const document = await getDocument({ data: new Uint8Array(bytes), disableWorker: true, verbosity: 0 }).promise;
  const lines = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const rows = new Map();
    for (const item of content.items || []) {
      const text = String(item.str || "").trim();
      if (!text) continue;
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

  const text = lines.join("\n");
  let grossMatch = text.match(/Total\s+Gross\s+Pay\s+(-?[\d,]+\.\d{2})/i);
  let netMatch = text.match(/Net\s+Pay\s+(-?[\d,]+\.\d{2})/i);
  if (!netMatch) {
    const netLineIndex = lines.findIndex((line) => /Net\s+Pay/i.test(line));
    const nearbyValues = netLineIndex >= 0
      ? [lines[netLineIndex], lines[netLineIndex - 1], lines[netLineIndex + 1]]
          .filter(Boolean)
          .join(" ")
          .match(/-?[\d,]+\.\d{2}/g) || []
      : [];
    if (nearbyValues.length) netMatch = [nearbyValues.at(-1), nearbyValues.at(-1)];
  }
  if ((!grossMatch || !netMatch) && /Payment\s+Summary/i.test(text)) {
    const employeeLine = lines.find((line) => /^\d+\s+(?!Employees\b)/i.test(line) && (line.match(/-?[\d,]+\.\d{2}/g) || []).length >= 2);
    const values = employeeLine?.match(/-?[\d,]+\.\d{2}/g) || [];
    if (values.length >= 2) {
      grossMatch = [values[0], values[0]];
      netMatch = [values.at(-1), values.at(-1)];
    }
  }
  const processDateMatch = text.match(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/);
  if (!grossMatch || !netMatch || !processDateMatch) {
    throw new Error("Gross pay, net pay or process date could not be read.");
  }
  return {
    grossPay: Number(grossMatch[1].replace(/,/g, "")),
    netPay: Number(netMatch[1].replace(/,/g, "")),
    processDate: `${processDateMatch[3]}-${processDateMatch[2]}-${processDateMatch[1]}`,
  };
}

const { data: files, error: filesError } = await supabase
  .from("staff_hr_files")
  .select(`
    id,
    title,
    issue_date,
    storage_path,
    hr_file_categories(name),
    staff_records!staff_hr_files_staff_record_id_fkey(
      preferred_name,
      profiles!staff_records_profile_id_fkey(full_name, email)
    )
  `)
  .eq("status", "active")
  .is("archived_at", null)
  .order("issue_date");

if (filesError) {
  console.error(`Could not load HR files: ${filesError.message}`);
  process.exit(1);
}

const payslips = files.filter((file) => {
  const category = Array.isArray(file.hr_file_categories) ? file.hr_file_categories[0] : file.hr_file_categories;
  return category?.name === "Payslip" && file.storage_path;
});

const extracted = [];
const failures = [];
for (const file of payslips) {
  const staff = Array.isArray(file.staff_records) ? file.staff_records[0] : file.staff_records;
  const profile = Array.isArray(staff?.profiles) ? staff.profiles[0] : staff?.profiles;
  const staffName = profile?.full_name || staff?.preferred_name || "Unknown staff";
  try {
    const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(file.storage_path);
    if (downloadError) throw downloadError;
    const pay = await extractPayslipPayData(await blob.arrayBuffer());
    const issuePeriod = String(file.issue_date || "").slice(0, 7);
    const processPeriod = pay.processDate.slice(0, 7);
    if (issuePeriod && issuePeriod !== processPeriod) {
      throw new Error(`PDF is dated ${processPeriod}, but the record is filed under ${issuePeriod}.`);
    }
    extracted.push({ file, staffName, ...pay });
  } catch (error) {
    failures.push({
      title: file.title,
      staffName,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log(`Payslip pay-value ${confirm ? "backfill" : "audit"}`);
console.log(`Payslips checked: ${payslips.length}`);
for (const item of extracted) {
  console.log(`OK ${item.file.issue_date.slice(0, 7)} · ${item.staffName} · gross ${money(item.grossPay)} · net ${money(item.netPay)}`);
}
if (failures.length) {
  console.error("\nUnresolved payslips:");
  for (const failure of failures) {
    console.error(`- ${failure.staffName} · ${failure.title}: ${failure.error}`);
  }
  process.exit(1);
}

if (!confirm) {
  console.log(`\nDry-run complete. ${extracted.length} payslips are ready to backfill.`);
  process.exit(0);
}

let updated = 0;
for (const item of extracted) {
  const { error } = await supabase
    .from("staff_hr_files")
    .update({
      payslip_gross_pay: item.grossPay,
      payslip_net_pay: item.netPay,
      payslip_process_date: item.processDate,
      payslip_pay_source: "pdf_text_backfill",
      payslip_pay_verified_at: new Date().toISOString(),
    })
    .eq("id", item.file.id);
  if (error) {
    console.error(`Update failed for ${item.staffName} · ${item.file.title}: ${error.message}`);
    process.exit(1);
  }
  updated += 1;
}

console.log(`\nBackfill complete. Updated ${updated} payslip pay records.`);
