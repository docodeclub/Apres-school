import { schoolYears } from "./labData.js";

export function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

export function addAuditLog(action, detail) {
  const items = readJson("apres-audit-log", []);
  const entry = {
    id: `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    action,
    detail,
    source: "Booking Lab",
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem("apres-audit-log", JSON.stringify([entry, ...items].slice(0, 80)));
}

export function money(value) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

export function downloadTextFile(filename, contents, type = "text/plain") {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function schoolYearIndex(value) {
  const index = schoolYears.indexOf(value);
  return index === -1 ? 0 : index;
}
