const PAGE = { width: 595, height: 842, margin: 42 };
const BLUE = [0.15, 0.25, 0.66];
const ROYAL = [0.29, 0.41, 0.85];
const GREEN = [0.15, 0.66, 0.46];
const AMBER = [0.95, 0.56, 0.15];
const RED = [0.74, 0.20, 0.24];
const INK = [0.09, 0.09, 0.18];
const MUTED = [0.36, 0.39, 0.46];
const LINE = [0.86, 0.89, 0.98];
const SOFT = [0.96, 0.97, 1];
const WHITE = [1, 1, 1];
const PALE_GREEN = [0.92, 0.98, 0.95];

function clean(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E£]/g, "");
}

function escapePdf(value) {
  return clean(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/£/g, "\\243");
}

function dateStamp() {
  return new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fileStamp() {
  return new Date().toISOString().slice(0, 10);
}

function slug(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "record";
}

function money(value) {
  return `£${Number(value || 0).toFixed(2)}`;
}

function formatPeriod(period) {
  if (!period || !/^\d{4}-\d{2}$/.test(String(period))) return clean(period || "Payroll period");
  const [year, month] = String(period).split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function formatDate(value) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function inDate(value) {
  if (!value) return false;
  const lower = String(value).toLowerCase();
  if (lower.includes("no expiry") || lower.includes("not required")) return true;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date >= today;
}

function meetsRequirement(person, requirement) {
  if (requirement === "firstAid") return inDate(person.firstAidExpiry);
  if (requirement === "eyfs") return String(person.eyfsLevel || person.role || "").toLowerCase().includes("level 3") || String(person.role || "").toLowerCase().includes("manager");
  if (requirement === "safeguarding") {
    const evidence = person.scrChecklist?.evidence?.safeguarding || {};
    return inDate(person.safeguardingExpiry)
      || Boolean(evidence.reference && (evidence.noExpiryShown || evidence.noExpiryStated || evidence.status === "Approved" || evidence.storagePath));
  }
  if (requirement === "allergy") return inDate(person.allergyAwarenessExpiry);
  return false;
}

class PdfDoc {
  constructor(title) {
    this.title = clean(title);
    this.pages = [];
    this.current = null;
  }

  addPage() {
    this.current = [];
    this.pages.push(this.current);
    return this;
  }

  rgb(color) {
    return color.map((part) => Number(part).toFixed(3)).join(" ");
  }

  text(value, x, y, size = 10, color = INK, font = "F1") {
    this.current.push(`BT /${font} ${size} Tf ${this.rgb(color)} rg ${x.toFixed(2)} ${(PAGE.height - y).toFixed(2)} Td (${escapePdf(value)}) Tj ET`);
  }

  textBold(value, x, y, size = 10, color = INK) {
    this.text(value, x, y, size, color, "F2");
  }

  line(x1, y1, x2, y2, color = LINE, width = 1) {
    this.current.push(`${this.rgb(color)} RG ${width} w ${x1.toFixed(2)} ${(PAGE.height - y1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE.height - y2).toFixed(2)} l S`);
  }

  rect(x, y, width, height, fill = null, stroke = LINE) {
    const commands = [];
    if (fill) commands.push(`${this.rgb(fill)} rg`);
    if (stroke) commands.push(`${this.rgb(stroke)} RG`);
    commands.push(`${x.toFixed(2)} ${(PAGE.height - y - height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re`);
    commands.push(fill && stroke ? "B" : fill ? "f" : "S");
    this.current.push(commands.join(" "));
  }

  measureLines(value, width, size = 10) {
    const maxChars = Math.max(10, Math.floor(width / (size * 0.5)));
    const words = clean(value).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    words.forEach((word) => {
      if (word.length > maxChars) {
        if (line) {
          lines.push(line);
          line = "";
        }
        for (let index = 0; index < word.length; index += maxChars) {
          lines.push(word.slice(index, index + maxChars));
        }
        return;
      }
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxChars && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  wrap(value, x, y, width, size = 10, color = INK, lineHeight = size * 1.35, font = "F1") {
    const lines = this.measureLines(value, width, size);
    lines.forEach((lineText, index) => this.text(lineText, x, y + index * lineHeight, size, color, font));
    return y + Math.max(lines.length, 1) * lineHeight;
  }

  badge(value, x, y, width, color = GREEN) {
    this.rect(x, y, width, 18, [0.93, 0.98, 0.96], null);
    this.text(value, x + 8, y + 12, 8, color);
  }

  pageHeader(documentType, meta) {
    this.text("Apres School", PAGE.margin, 38, 17, BLUE);
    this.text("Let's Learn and Play", PAGE.margin, 55, 8, AMBER);
    this.text(`Document: ${documentType}`, 370, 38, 9, MUTED);
    this.text(`Generated: ${dateStamp()}`, 370, 52, 9, MUTED);
    if (meta) this.text(meta, 370, 66, 9, MUTED);
    this.line(PAGE.margin, 82, PAGE.width - PAGE.margin, 82);
  }

  kpi(label, value, x, y, width) {
    this.rect(x, y, width, 64, SOFT, LINE);
    this.text(label.toUpperCase(), x + 12, y + 20, 7.5, MUTED);
    this.textBold(value, x + 12, y + 45, 17, BLUE);
  }

  sectionTitle(title, x, y) {
    this.text(title, x, y, 13, BLUE);
    this.line(x, y + 8, PAGE.width - PAGE.margin, y + 8);
  }

  table(headers, rows, x, y, widths, options = {}) {
    const rowHeight = options.rowHeight || 27;
    this.rect(x, y, widths.reduce((sum, item) => sum + item, 0), rowHeight, SOFT, LINE);
    let cursorX = x;
    headers.forEach((header, index) => {
      this.text(header.toUpperCase(), cursorX + 6, y + 17, 7, MUTED);
      cursorX += widths[index];
    });
    let cursorY = y + rowHeight;
    rows.forEach((row) => {
      this.rect(x, cursorY, widths.reduce((sum, item) => sum + item, 0), rowHeight, WHITE, LINE);
      cursorX = x;
      row.forEach((cell, index) => {
        this.wrap(cell, cursorX + 6, cursorY + 14, widths[index] - 12, 7.6, INK, 9.5);
        cursorX += widths[index];
      });
      cursorY += rowHeight;
    });
    return cursorY;
  }

  output() {
    const encoder = new TextEncoder();
    const objects = [];
    const addObject = (body) => {
      objects.push(body);
      return objects.length;
    };
    const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    const boldFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
    const pageIds = [];
    this.pages.forEach((page) => {
      const stream = page.join("\n");
      const contentId = addObject(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`);
      const pageId = addObject(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
      pageIds.push(pageId);
    });
    const pagesId = addObject(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
    const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    pageIds.forEach((id) => {
      objects[id - 1] = objects[id - 1].replace("/Parent 0 0 R", `/Parent ${pagesId} 0 R`);
    });
    let body = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(encoder.encode(body).length);
      body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = encoder.encode(body).length;
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => {
      body += `${String(offset).padStart(10, "0")} 00000 n \n`;
    });
    body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Title (${escapePdf(this.title)}) >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return encoder.encode(body);
  }
}

function downloadPdf(filename, doc) {
  const blob = new Blob([doc.output()], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportBookingInvoicePdf(invoice = {}) {
  const reference = invoice.reference || invoice.id || "Booking";
  const rows = Array.isArray(invoice.lines) && invoice.lines.length ? invoice.lines : [];
  const total = Number(invoice.total || rows.reduce((sum, row) => sum + Number(row.total || 0), 0));
  const paid = Number(invoice.paid ?? Math.max(0, total - Number(invoice.balance || 0)));
  const balance = Number(invoice.balance ?? Math.max(0, total - paid));
  const doc = new PdfDoc(`Apres School invoice ${reference}`);
  const tableWidths = [92, 72, 98, 185, 64];
  const tableWidth = tableWidths.reduce((sum, width) => sum + width, 0);

  const addHeader = (continued = false) => {
    doc.addPage();
    doc.rect(0, 0, PAGE.width, 78, BLUE, null);
    doc.textBold("Apres School", PAGE.margin, 34, 20, WHITE);
    doc.text("Let's Learn and Play", PAGE.margin, 53, 8.5, AMBER);
    doc.textBold("INVOICE", 430, 34, 20, WHITE);
    doc.text(reference, 430, 54, 9, WHITE);
    if (continued) doc.text("Continued", 430, 68, 8, WHITE);
  };
  const tableHeader = (y) => {
    doc.rect(PAGE.margin, y, tableWidth, 28, SOFT, LINE);
    let x = PAGE.margin;
    ["Date", "Time", "Child", "Session", "Amount"].forEach((label, index) => {
      doc.textBold(label.toUpperCase(), x + 7, y + 18, 7, MUTED);
      x += tableWidths[index];
    });
    return y + 28;
  };
  const tableRow = (row, y) => {
    const values = [row.date || "-", row.time || "-", row.child || "Child", row.description || "Care session", money(row.total)];
    const height = Math.max(38, Math.max(...values.map((value, index) => doc.measureLines(value, tableWidths[index] - 14, 8).length)) * 10 + 18);
    doc.rect(PAGE.margin, y, tableWidth, height, WHITE, LINE);
    let x = PAGE.margin;
    values.forEach((value, index) => {
      doc.wrap(value, x + 7, y + 16, tableWidths[index] - 14, 8, index === 4 ? BLUE : INK, 10, index === 4 ? "F2" : "F1");
      x += tableWidths[index];
    });
    return y + height;
  };

  addHeader(false);
  doc.textBold("Billed to", PAGE.margin, 112, 10, BLUE);
  doc.textBold(invoice.parentName || "Parent or carer", PAGE.margin, 133, 11, INK);
  doc.text(invoice.parentEmail || "", PAGE.margin, 151, 8.5, MUTED);
  doc.textBold("Invoice details", 340, 112, 10, BLUE);
  doc.text(`Issued: ${formatDate(invoice.issueDate || new Date().toISOString())}`, 340, 133, 8.5, MUTED);
  doc.text(`Booking reference: ${reference}`, 340, 151, 8.5, MUTED);
  doc.rect(PAGE.margin, 178, tableWidth, 96, PALE_GREEN, LINE);
  [["TOTAL", money(total)], ["PAID", money(paid)], ["BALANCE", money(balance)], ["STATUS", invoice.status || (balance <= 0 ? "Paid" : "Payment arranged")]].forEach(([label, value], index) => {
    const x = PAGE.margin + 16 + index * 124;
    doc.text(label, x, 203, 7.2, MUTED);
    doc.textBold(value, x, 232, index === 3 ? 11 : 16, index === 2 && balance > 0 ? AMBER : GREEN);
  });
  doc.text(`Payment: ${invoice.paymentMethod || "PonchoPay"}`, PAGE.margin + 16, 257, 8, MUTED);
  doc.textBold("Booked care", PAGE.margin, 306, 12, BLUE);
  let y = tableHeader(322);
  (rows.length ? rows : [{ description: "Booking details are available in the parent portal", total }]).forEach((row) => {
    const values = [row.date || "-", row.time || "-", row.child || "Child", row.description || "Care session", money(row.total)];
    const height = Math.max(38, Math.max(...values.map((value, index) => doc.measureLines(value, tableWidths[index] - 14, 8).length)) * 10 + 18);
    if (y + height > 748) {
      addHeader(true);
      y = tableHeader(110);
    }
    y = tableRow(row, y);
  });
  doc.pages.forEach((page, index) => {
    const previous = doc.current;
    doc.current = page;
    doc.line(PAGE.margin, 786, PAGE.width - PAGE.margin, 786, LINE);
    doc.text("Apres School | hello@apres-school.co.uk | www.apres-school.co.uk", PAGE.margin, 808, 8, MUTED);
    doc.text(`Page ${index + 1} of ${doc.pages.length}`, 500, 808, 8, MUTED);
    doc.current = previous;
  });
  downloadPdf(`apres-school-invoice-${slug(reference)}.pdf`, doc);
}

function complianceCounts(staff) {
  const total = staff.length;
  const complete = staff.filter((person) => person.compliance === "Compliant").length;
  return { total, complete, review: Math.max(total - complete, 0), completion: total ? `${Math.round((complete / total) * 100)}%` : "100%" };
}

function assignedSites(person) {
  if (Array.isArray(person?.siteAssignments) && person.siteAssignments.length) {
    return person.siteAssignments.map((assignment) => {
      const dates = [assignment.startDate, assignment.endDate].filter(Boolean).join(" to ");
      return `${assignment.school}${dates ? ` (${dates})` : ""}`;
    }).join("; ");
  }
  return person?.location || "Not recorded";
}

function evidenceRequestFor(staff, key, requests = {}) {
  return requests?.[`${staff.id}-${key}`] || null;
}

function requestStatus(request) {
  if (!request) return "";
  if (request.status === "Rejected") return "Sent back";
  if (request.status === "Submitted") return "Submitted for review";
  if (request.status === "Requested") return "Requested from staff";
  if (request.status === "Approved") return "Approved";
  if (request.status === "Cleared") return "Cleared";
  return request.status || "";
}

function evidenceSummary(staff, key, requests = {}) {
  const request = evidenceRequestFor(staff, key, requests);
  const evidence = staff.scrChecklist?.evidence?.[key] || {};
  if (key === "references") {
    const received = evidence.referencesReceived ?? evidence.referenceReceived ?? evidence.referenceCount > 0;
    const wouldReemploy = evidence.wouldReemploy ?? evidence.wouldEmployAgain;
    const safeguardingConcerns = evidence.safeguardingConcerns;
    const recommended = evidence.recommendedForChildren ?? evidence.recommendForChildrenRole;
    const referenceNames = Array.isArray(evidence.references)
      ? evidence.references.map((reference) => reference.organisation ? `${reference.name} (${reference.organisation})` : reference.name).filter(Boolean)
      : Array.isArray(evidence.referenceNames)
        ? evidence.referenceNames.filter(Boolean)
        : [];
    const parts = [
      request?.evidenceReference || evidence.reference || "Reference evidence",
      referenceNames.length ? `names: ${referenceNames.join("; ")}` : "",
      received ? `${evidence.referenceCount || 2} reference${Number(evidence.referenceCount || 2) === 1 ? "" : "s"} received` : "",
      evidence.dateSeen || evidence.checkedAt ? `checked ${evidence.dateSeen || evidence.checkedAt}` : "",
      wouldReemploy === true ? "would employ again: yes" : wouldReemploy === false ? "would employ again: no" : "",
      safeguardingConcerns === false ? "safeguarding concerns: no" : safeguardingConcerns === true ? "safeguarding concerns: yes" : "",
      recommended === true ? "recommended for work with children: yes" : recommended === false ? "recommended for work with children: no" : "",
      evidence.verifiedBy ? `by ${evidence.verifiedBy}` : "",
      request?.note || request?.submissionNote || evidence.note || "",
    ].filter(Boolean);
    return parts.join(", ");
  }
  const parts = [
    request?.evidenceReference || evidence.reference || "No reference recorded",
    request?.submittedAt ? `submitted ${request.submittedAt.slice(0, 10)}` : "",
    request?.reviewedAt ? `reviewed ${request.reviewedAt.slice(0, 10)}` : "",
    evidence.dateSeen ? `seen ${evidence.dateSeen}` : "",
    request?.evidenceExpiryDate || evidence.expiryDate ? `expires/reviews ${request?.evidenceExpiryDate || evidence.expiryDate}` : "",
    evidence.verifiedBy ? `by ${evidence.verifiedBy}` : "",
    request?.rejectionReason ? `reason: ${request.rejectionReason}` : "",
    request?.note || request?.submissionNote || "",
  ].filter(Boolean);
  return parts.join(", ");
}

function evidenceExpiryStatus(evidence) {
  if (!evidence?.expiryDate) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(`${evidence.expiryDate}T00:00:00`);
  const days = Math.ceil((expiry - today) / 86400000);
  if (days < 0) return "Expired";
  if (days <= 60) return "Expiring soon";
  return "In date";
}

function checklistStatus(staff, key, requests = {}) {
  const request = evidenceRequestFor(staff, key, requests);
  const workflowStatus = requestStatus(request);
  if (workflowStatus && workflowStatus !== "Cleared") return workflowStatus;
  const expiryStatus = evidenceExpiryStatus(staff.scrChecklist?.evidence?.[key]);
  if (expiryStatus === "Expired" || expiryStatus === "Expiring soon") return expiryStatus;
  if (staff.scrChecklist?.evidence?.[key]?.status === "Approved") return "Approved";
  if (staff.scrChecklist?.[key]) return "Complete";
  if (staff.scrChecklist?.evidence?.[key]?.reference) return "Evidence noted";
  return "Pending";
}

function addMonthsIso(dateString, months) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysUntilIso(dateString) {
  if (!dateString) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target - today) / 86400000);
}

function latestSuitabilityDeclaration(staff = {}) {
  return (staff.suitabilityDeclarations || [])
    .filter(Boolean)
    .sort((a, b) => String(b.dateCompleted || b.createdAt || "").localeCompare(String(a.dateCompleted || a.createdAt || "")))[0] || null;
}

function suitabilityDeclarationStatus(staff = {}) {
  const latest = latestSuitabilityDeclaration(staff);
  if (!latest) return "Missing";
  const dueDate = latest.nextDueDate || (latest.dateCompleted ? addMonthsIso(latest.dateCompleted, 12) : "");
  const remaining = daysUntilIso(dueDate);
  if (remaining !== null && remaining < 0) return "Expired";
  if (remaining !== null && remaining <= 30) return "Due within 30 days";
  return "Current";
}

function suitabilityDeclarationSummary(staff = {}) {
  const latest = latestSuitabilityDeclaration(staff);
  if (!latest) return "No annual staff suitability declaration is recorded.";
  const dueDate = latest.nextDueDate || (latest.dateCompleted ? addMonthsIso(latest.dateCompleted, 12) : "");
  return [
    latest.declarationYear ? `${latest.declarationYear} declaration` : "Annual declaration",
    latest.dateCompleted ? `completed ${latest.dateCompleted}` : "",
    latest.signedBy ? `signed by ${latest.signedBy}` : "",
    dueDate ? `next due ${dueDate}` : "",
  ].filter(Boolean).join(", ");
}

function dbsNumberFor(staff = {}) {
  return staff.dbsNumber
    || staff.scrChecklist?.dbsNumber
    || staff.scrChecklist?.evidence?.dbs?.number
    || staff.scrChecklist?.evidence?.dbs?.dbsNumber
    || staff.scrChecklist?.evidence?.dbs?.dbs_number
    || staff.scrChecklist?.evidence?.dbs?.certificateNo
    || staff.scrChecklist?.evidence?.dbs?.certificate_no
    || staff.scrChecklist?.dbs?.number
    || staff.scrChecklist?.dbs?.dbsNumber
    || staff.scrChecklist?.dbs?.dbs_number
    || staff.scrChecklist?.dbs?.certificateNo
    || staff.scrChecklist?.dbs?.certificate_no
    || "";
}

function scrCheckedDateFor(staff = {}) {
  const checklist = staff.scrChecklist || {};
  const evidence = checklist.evidence || {};
  return checklist.approvedAt
    || checklist.checkedAt
    || checklist.updatedAt
    || evidence.adminReview?.checkedAt
    || evidence.dbs?.checkedAt
    || evidence.dbs?.verifiedAt
    || evidence.safeguarding?.checkedAt
    || evidence.safeguarding?.verifiedAt
    || "";
}

function dbsStatusFor(staff = {}, requests = {}) {
  const number = dbsNumberFor(staff);
  const status = checklistStatus(staff, "dbs", requests);
  return number ? `${number} / ${status}` : `Not recorded / ${status}`;
}

function evidenceCheckFromRow(evidenceRows = [], staff = {}, key = "") {
  const row = evidenceRows.find((item) => item.person?.id === staff.id);
  return row?.checks?.find((check) => check.key === key) || null;
}

function compactCheckLabel(check, fallback = "Not recorded") {
  if (!check) return fallback;
  return [check.status, check.detail].filter(Boolean).join(" - ") || fallback;
}

function inspectionChecklistRowForStaff(staff = {}, evidenceRows = [], requests = {}) {
  const dbsCheck = evidenceCheckFromRow(evidenceRows, staff, "dbs");
  const safeguarding = evidenceCheckFromRow(evidenceRows, staff, "safeguarding");
  const allergy = evidenceCheckFromRow(evidenceRows, staff, "allergy");
  const firstAid = evidenceCheckFromRow(evidenceRows, staff, "firstAid");
  const references = evidenceCheckFromRow(evidenceRows, staff, "references");
  const suitability = evidenceCheckFromRow(evidenceRows, staff, "annualSuitability");
  const row = evidenceRows.find((item) => item.person?.id === staff.id);
  const blockers = (row?.checks || []).filter((check) => check.tone !== "ready" && check.tone !== "neutral");
  const checkedDate = scrCheckedDateFor(staff);
  return [
    `${staff.name || "Staff member"}\n${staff.role || "Staff"}`,
    `${dbsNumberFor(staff) || "DBS not recorded"}\n${dbsCheck?.status || checklistStatus(staff, "dbs", requests)}\nChecked: ${checkedDate ? formatDate(checkedDate) : "not recorded"}`,
    `Safeguarding: ${safeguarding?.status || checklistStatus(staff, "safeguarding", requests)}\nAllergy: ${allergy?.status || checklistStatus(staff, "allergy", requests)}\nFirst aid: ${firstAid?.status || checklistStatus(staff, "firstAid", requests)}`,
    compactCheckLabel(references, evidenceSummary(staff, "references", requests) || "Not recorded"),
    compactCheckLabel(suitability, suitabilityDeclarationSummary(staff)),
    blockers.length ? `${blockers.length} to check` : "Ready",
  ];
}

function namesList(people = []) {
  return people.length ? people.map((person) => person.name || "Staff member").join(", ") : "Gap to resolve";
}

function chunkRows(rows = [], size = 14) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks.length ? chunks : [[]];
}

function drawInspectionFooter(doc, note = "Confidential inspection preparation pack. Confirm live records before sharing externally.") {
  doc.line(PAGE.margin, 802, PAGE.width - PAGE.margin, 802, LINE);
  doc.text(note, PAGE.margin, 820, 7.5, MUTED);
}

function buildKingHouseNamedEvidenceRows(staff = [], evidenceRows = []) {
  const rama = staff.find((person) => {
    const text = `${person.name || ""} ${person.fullName || ""} ${person.email || ""}`.toLowerCase();
    return text.includes("rama") && text.includes("singh");
  }) || staff.find((person) => String(person.role || "").toLowerCase().includes("manager"));
  const evidence = rama?.scrChecklist?.evidence || {};
  const ramaRow = evidenceRows.find((row) => row.person?.id === rama?.id);
  const checkFile = (key) => ramaRow?.checks?.find((check) => check.key === key)?.file;
  const evidenceTitle = (key, fallback) => {
    const item = evidence[key] || {};
    const file = checkFile(key);
    return item.reference || item.qualification || file?.title || fallback;
  };
  const dateSummary = (item = {}) => {
    const issueDate = item.completionDate || item.issueDate || "";
    const expiryDate = item.expiryDate || "";
    if (issueDate && expiryDate) return `${formatDate(issueDate)} - expires ${formatDate(expiryDate)}`;
    if (issueDate) return `${formatDate(issueDate)} - no expiry shown`;
    if (expiryDate) return `Expires ${formatDate(expiryDate)}`;
    return "Date not recorded";
  };
  const safeguarding = evidence.safeguarding || {};
  const firstAid = evidence.firstAid || {};
  const send = evidence.eyfsLevel || {};
  const staffName = rama?.name || "Rama Singh";

  return [
    ["Site manager", staffName, rama?.role || "Manager", rama?.location || "King's House School"],
    ["DSL / safeguarding", staffName, evidenceTitle("safeguarding", "Safeguarding evidence not recorded"), dateSummary(safeguarding)],
    ["Paediatric first aid", staffName, evidenceTitle("firstAid", "First aid evidence not recorded"), dateSummary(firstAid)],
    ["SEND inclusion", staffName, evidenceTitle("eyfsLevel", "SEND inclusion evidence not recorded"), dateSummary(send)],
  ];
}

const assuranceEvidenceChecks = [
  ["Right to work", "rightToWork"],
  ["Identity", "identity"],
  ["DBS", "dbs"],
  ["Barred list", "barredList"],
  ["Safeguarding", "safeguarding"],
  ["Allergy", "allergy"],
  ["First aid", "firstAid"],
  ["References", "references"],
  ["Declarations", "declarations"],
];

export function exportStaffScrSummary(person, allStaff = [], options = {}) {
  const staff = person || allStaff[0];
  if (!staff) return;
  const evidenceRequests = options.evidenceRequests || {};
  const counts = complianceCounts(allStaff.length ? allStaff : [staff]);
  const doc = new PdfDoc(`${staff.name} SCR Summary`).addPage();
  doc.pageHeader("Staff SCR Record", `Record owner: ${staff.name}`);
  doc.text("Single Central Register Staff Record", PAGE.margin, 116, 21, BLUE);
  let y = doc.wrap("This summary brings together safer recruitment checks, employment information, training records and review status for internal compliance use.", PAGE.margin, 140, 500, 10, MUTED);
  const kpiY = y + 18;
  doc.kpi("Completion", counts.completion, PAGE.margin, kpiY, 116);
  doc.kpi("Complete checks", String(counts.complete), 171, kpiY, 116);
  doc.kpi("Review due", staff.dbsRenewal || "Not recorded", 300, kpiY, 116);
  doc.kpi("Action needed", staff.compliance || "Review", 429, kpiY, 124);

  y = kpiY + 96;
  doc.sectionTitle("Personal and Employment Information", PAGE.margin, y);
  y += 26;
  const fields = [
    ["Full name", staff.name],
    ["Preferred name", staff.name?.split(" ")[0] || "Not recorded"],
    ["Role", staff.role],
    ["Employment type", "Sessional / hourly"],
    ["Assigned sites", assignedSites(staff)],
    ["Start date", "Held in staff profile"],
    ["Email", `${slug(staff.name)}@apres-school.local`],
    ["Emergency contact", "Held in staff profile"],
  ];
  fields.forEach(([label, value], index) => {
    const x = index % 2 === 0 ? PAGE.margin : 310;
    const rowY = y + Math.floor(index / 2) * 36;
    doc.text(label.toUpperCase(), x, rowY, 7.5, MUTED);
    doc.text(value || "Not recorded", x, rowY + 16, 10, INK);
  });

  doc.addPage();
  doc.pageHeader("Staff SCR Record", `Record owner: ${staff.name}`);
  y = 116;
  doc.sectionTitle("Compliance Checks", PAGE.margin, y);
  y = doc.table(
    ["Check", "Status", "Evidence / verifier"],
    [
      ["SCR status", staff.compliance, "Current admin review"],
      ["Right to work", checklistStatus(staff, "rightToWork", evidenceRequests), evidenceSummary(staff, "rightToWork", evidenceRequests)],
      ["Identity / address", checklistStatus(staff, "identity", evidenceRequests), evidenceSummary(staff, "identity", evidenceRequests)],
      ["Enhanced DBS", dbsStatusFor(staff, evidenceRequests), evidenceSummary(staff, "dbs", evidenceRequests)],
      ["Barred list", checklistStatus(staff, "barredList", evidenceRequests), evidenceSummary(staff, "barredList", evidenceRequests)],
      ["Safeguarding training", checklistStatus(staff, "safeguarding", evidenceRequests), evidenceSummary(staff, "safeguarding", evidenceRequests)],
      ["Allergy awareness", checklistStatus(staff, "allergy", evidenceRequests), evidenceSummary(staff, "allergy", evidenceRequests)],
      ["References", checklistStatus(staff, "references", evidenceRequests), evidenceSummary(staff, "references", evidenceRequests)],
      ["Annual declarations", checklistStatus(staff, "declarations", evidenceRequests), evidenceSummary(staff, "declarations", evidenceRequests)],
      ["Annual suitability declaration", suitabilityDeclarationStatus(staff), suitabilityDeclarationSummary(staff)],
    ],
    PAGE.margin,
    y + 18,
    [170, 175, 165],
    { rowHeight: 32 },
  );

  y += 32;
  doc.sectionTitle("Recruitment and Annual Declarations", PAGE.margin, y);
  y = doc.wrap("The full record supports application review, employment gaps, references, overseas checks where applicable, qualifications, annual medical and criminal declarations, childcare disqualification declarations and evidence requests.", PAGE.margin, y + 24, 500, 10, MUTED);
  const suitabilityHistory = (staff.suitabilityDeclarations || []).slice(0, 5);
  if (suitabilityHistory.length) {
    y += 22;
    doc.sectionTitle("Annual Suitability Declaration History", PAGE.margin, y);
    y = doc.table(
      ["Year", "Completed", "Signed by", "Status", "Next due"],
      suitabilityHistory.map((declaration) => [
        declaration.declarationYear || declaration.dateCompleted?.slice(0, 4) || "Not recorded",
        declaration.dateCompleted || "Not recorded",
        declaration.signedBy || "Not recorded",
        suitabilityDeclarationStatus({ suitabilityDeclarations: [declaration] }),
        declaration.nextDueDate || (declaration.dateCompleted ? addMonthsIso(declaration.dateCompleted, 12) : "Not recorded"),
      ]),
      PAGE.margin,
      y + 18,
      [70, 95, 135, 100, 110],
      { rowHeight: 30 },
    );
  }
  doc.text("Generated from Apres School SCR records. Confirm live data before sharing externally.", PAGE.margin, 804, 8, MUTED);
  downloadPdf(`apres-staff-scr-summary-${slug(staff.name)}-${fileStamp()}.pdf`, doc);
}

export function exportSchoolAssuranceLetter(staff = [], schoolName = "Partner School", options = {}) {
  const counts = complianceCounts(staff);
  const evidenceRequests = options.evidenceRequests || {};
  const doc = new PdfDoc(`${schoolName} Assurance Letter`).addPage();
  doc.pageHeader("Letter of Assurance", `School: ${schoolName}`);
  doc.text("Safeguarding and Safer Recruitment Assurance", PAGE.margin, 116, 20, BLUE);
  let y = doc.wrap(`Dear DSL, SBM or compliance contact, Apres School maintains safer recruitment and staff compliance records through its Single Central Register. This assurance summary is generated from the staff records currently assigned to ${schoolName}.`, PAGE.margin, 142, 500, 10, MUTED);
  const kpiY = y + 18;
  doc.kpi("Assigned staff", String(counts.total), PAGE.margin, kpiY, 116);
  doc.kpi("Complete records", String(counts.complete), 171, kpiY, 116);
  doc.kpi("Require review", String(counts.review), 300, kpiY, 116);
  doc.kpi("Issue date", dateStamp(), 429, kpiY, 124);

  y = kpiY + 94;
  doc.sectionTitle("Staff Covered by this Assurance", PAGE.margin, y);
  y = doc.table(
    ["Staff member", "Role", "DBS number / status", "Safeguarding", "First aid", "SCR status"],
    staff.map((person) => [
      person.name,
      person.role,
      dbsStatusFor(person, evidenceRequests),
      checklistStatus(person, "safeguarding", evidenceRequests),
      checklistStatus(person, "firstAid", evidenceRequests),
      person.compliance,
    ]),
    PAGE.margin,
    y + 18,
    [100, 88, 78, 88, 78, 78],
    { rowHeight: 34 },
  );

  y += 34;
  doc.sectionTitle("Assurance Statements", PAGE.margin, y);
  const statements = [
    "Enhanced DBS details, barred list checks and update-service status are recorded against staff records.",
    "Right to work, identity and proof-of-address evidence are tracked with admin verification status.",
    "Safeguarding, KCSIE, company policy and allergy-awareness records are monitored with dates and evidence.",
    "First aid is recorded by qualification, expiry date, role and site requirement.",
    "References, employment gaps, overseas checks and qualification evidence are captured where applicable.",
    "Annual declarations can be prompted, digitally confirmed and reset after completion.",
  ];
  statements.forEach((statement, index) => {
    const x = index % 2 === 0 ? PAGE.margin : 310;
    const rowY = y + 26 + Math.floor(index / 2) * 56;
    doc.rect(x, rowY - 12, 4, 45, GREEN, null);
    doc.wrap(statement, x + 12, rowY, 220, 8.5, INK, 11);
  });
  y += 210;
  doc.wrap("Where a staff record is pending, action needed or review due, that item should be resolved before deployment to regulated activity where the missing check is required.", PAGE.margin, y, 500, 9, MUTED);

  const hasEvidence = options.includeEvidenceAppendix && staff.some((person) => assuranceEvidenceChecks.some(([, key]) => person.scrChecklist?.evidence?.[key]?.reference || person.scrChecklist?.[key] || evidenceRequestFor(person, key, evidenceRequests)));
  if (hasEvidence) {
    doc.addPage();
    doc.pageHeader("Letter of Assurance", `School: ${schoolName}`);
    y = 116;
    doc.sectionTitle("Evidence Detail Appendix", PAGE.margin, y);
    y = doc.wrap("This appendix summarises recorded evidence metadata for staff assigned to this school. It is intended for higher-detail assurance requests and should be checked against live SCR records before sharing.", PAGE.margin, y + 24, 500, 9.5, MUTED);
    staff.forEach((person) => {
      if (y > 650) {
        doc.addPage();
        doc.pageHeader("Letter of Assurance", `School: ${schoolName}`);
        y = 116;
      }
      y += 18;
      doc.text(person.name, PAGE.margin, y, 12, BLUE);
      y = doc.table(
        ["Check", "Status", "Evidence / verifier"],
        assuranceEvidenceChecks.map(([label, key]) => [label, checklistStatus(person, key, evidenceRequests), evidenceSummary(person, key, evidenceRequests)]),
        PAGE.margin,
        y + 12,
        [135, 110, 265],
        { rowHeight: 28 },
      );
    });
  }

  doc.text("Signed for Apres School:", PAGE.margin, 740, 10, INK);
  doc.line(160, 740, 360, 740, MUTED);
  doc.text("Name / position:", PAGE.margin, 770, 10, INK);
  doc.line(160, 770, 360, 770, MUTED);
  doc.text(`Date: ${dateStamp()}`, PAGE.margin, 800, 9, MUTED);
  downloadPdf(`apres-school-assurance-${slug(schoolName)}-${fileStamp()}.pdf`, doc);
}

export function exportInspectionEvidencePack(options = {}) {
  const site = options.site || {};
  const timing = options.timing || {};
  const staff = Array.isArray(options.staff) ? options.staff : [];
  const evidenceRows = Array.isArray(options.evidenceRows) ? options.evidenceRows : [];
  const documents = Array.isArray(options.documents) ? options.documents : [];
  const documentLinks = options.documentLinks || {};
  const rota = Array.isArray(options.rota) ? options.rota : [];
  const logs = Array.isArray(options.logs) ? options.logs : [];
  const evidenceRequests = options.evidenceRequests || {};
  const scheduledInspection = options.scheduledInspection || {};
  const blockerRows = evidenceRows
    .map((row) => ({
      person: row.person || {},
      checks: (row.checks || []).filter((check) => check.tone !== "ready" && check.tone !== "neutral"),
    }))
    .filter((row) => row.checks.length);
  const policyNames = [
    "Safeguarding Policy",
    "Behaviour Policy",
    "Health and Safety Policy",
    "Complaints Policy",
    "Illness and Accidents",
    "First Aid Policy",
    "Code of Conduct",
    "Staff Handbook",
  ];
  const policyRows = policyNames.map((name) => {
    const document = documents.find((item) => item.name === name) || {};
    const linked = Boolean(documentLinks[name] || document.url);
    return [
      name,
      linked ? "Linked" : "Add link",
      document.assigned ? `${document.read || 0}/${document.assigned} read` : document.version || "Current",
    ];
  });
  const coverRows = [
    ["Named manager", staff.filter((person) => String(person.role || "").toLowerCase().includes("manager"))],
    ["First aider", staff.filter((person) => meetsRequirement(person, "firstAid"))],
    ["EYFS Level 3+", staff.filter((person) => meetsRequirement(person, "eyfs"))],
    ["Safeguarding trained", staff.filter((person) => meetsRequirement(person, "safeguarding"))],
    ["Allergy aware", staff.filter((person) => meetsRequirement(person, "allergy"))],
  ];
  const openLogs = logs.filter((log) => log.status !== "Closed");
  const sessionSummary = rota.length
    ? rota.map((item) => `${item.type}: ${item.sessionStart}-${item.sessionEnd}`).join("; ")
    : "No rota window configured";
  const siteName = site.school || "King's House School";
  const readinessStatus = blockerRows.length ? `${blockerRows.length} SCR blocker${blockerRows.length === 1 ? "" : "s"} to check` : "No SCR blockers flagged";
  const readinessBadge = blockerRows.length ? "Action needed" : "Ready";
  const coverTableRows = coverRows.map(([label, people]) => [
    label,
    people.length ? "Covered" : "Gap",
    namesList(people),
  ]);
  const namedEvidenceRows = buildKingHouseNamedEvidenceRows(staff, evidenceRows);
  const blockerTableRows = blockerRows.length
    ? blockerRows.slice(0, 8).map((row) => [
      row.person.name || "Staff member",
      row.checks.map((check) => `${check.label}: ${check.status}`).join("; "),
      dbsStatusFor(row.person, evidenceRequests),
      row.checks[0]?.detail || "Open staff profile for detail",
    ])
    : [["None flagged", "No SCR blockers are currently flagged for this site.", "", ""]];
  const inspectionChecklistRows = staff.length ? [...staff].sort((a, b) => {
    const rowA = evidenceRows.find((row) => row.person?.id === a.id);
    const rowB = evidenceRows.find((row) => row.person?.id === b.id);
    const blockersA = (rowA?.checks || []).filter((check) => check.tone !== "ready" && check.tone !== "neutral").length;
    const blockersB = (rowB?.checks || []).filter((check) => check.tone !== "ready" && check.tone !== "neutral").length;
    return blockersB - blockersA || String(a.name || "").localeCompare(String(b.name || ""));
  }).map((person) => inspectionChecklistRowForStaff(person, evidenceRows, evidenceRequests)) : [["No staff assigned", "", "", "", "", ""]];
  const currentStaffRows = staff.length ? [...staff]
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
    .map((person) => [
      person.name || "Staff member",
      person.role || "Staff",
      dbsNumberFor(person) || "Not recorded",
      scrCheckedDateFor(person) ? formatDate(scrCheckedDateFor(person)) : "Not recorded",
    ]) : [["No current staff assigned", "", "", ""]];
  const openLogRows = openLogs.length ? openLogs.slice(0, 8).map((log) => [
    log.type || log.title || "Log",
    log.status || "Open",
    log.owner || log.assignedTo || "Unassigned",
    log.dueDate || log.createdAt || "Date not recorded",
  ]) : [["None", "No open logs recorded", "", ""]];
  const managerCover = coverRows.find(([label]) => label === "Named manager")?.[1] || [];
  const firstAidCover = coverRows.find(([label]) => label === "First aider")?.[1] || [];
  const eyfsCover = coverRows.find(([label]) => label === "EYFS Level 3+")?.[1] || [];
  const safeguardingCover = coverRows.find(([label]) => label === "Safeguarding trained")?.[1] || [];
  const quickRouteRows = [
    [
      "Who is working at this site?",
      "Page 1 Current Staff Only",
      `${staff.length} current ${siteName} staff. This pack is site-scoped.`,
    ],
    [
      "Show the site SCR checklist",
      "Page 2 Site SCR Checklist",
      "DBS numbers, checked dates, training, references and annual suitability are listed by assigned staff member.",
    ],
    [
      "Who is the named manager?",
      "Page 1 Required Cover",
      namesList(managerCover),
    ],
    [
      "Who covers first aid and EYFS Level 3?",
      "Page 1 Required Cover",
      `First aid: ${namesList(firstAidCover)}. EYFS Level 3+: ${namesList(eyfsCover)}.`,
    ],
    [
      "Show safeguarding evidence",
      "Page 1 Named Evidence / live SCR profile",
      namesList(safeguardingCover),
    ],
    [
      "Show policies and procedures",
      "Page 3 Site Operation and Documents",
      "Safeguarding, behaviour, health and safety, complaints, accidents and conduct links.",
    ],
    [
      "Show live follow-up actions",
      "Live SCR evidence rows / Page 1 Immediate SCR Actions",
      blockerRows.length ? `${blockerRows.length} item${blockerRows.length === 1 ? "" : "s"} currently flagged.` : "No SCR blockers flagged.",
    ],
    [
      "Show operational logs",
      "Page 3 Open Operational Logs",
      openLogs.length ? `${openLogs.length} open log${openLogs.length === 1 ? "" : "s"} recorded.` : "No open logs recorded.",
    ],
  ];
  const doc = new PdfDoc(`${site.school || "King's House School"} Inspection Evidence Pack`).addPage();
  doc.pageHeader("Inspection Evidence Pack", `Site: ${siteName}`);
  doc.rect(PAGE.margin, 104, PAGE.width - PAGE.margin * 2, 96, [0.95, 0.97, 1], LINE);
  doc.text(`${siteName} Inspection Pack`, PAGE.margin + 18, 132, 21, BLUE);
  let y = doc.wrap(
    scheduledInspection.label || timing.summary || "Site-specific Ofsted inspection preparation pack.",
    PAGE.margin + 18,
    156,
    335,
    9.5,
    MUTED,
    12,
  );
  doc.badge(readinessBadge, 405, 122, 122, blockerRows.length ? RED : GREEN);
  doc.text("Inspection focus", 405, 154, 7.5, MUTED);
  doc.wrap(readinessStatus, 405, 169, 128, 8.2, INK, 10);
  doc.text(site.urn ? `URN ${site.urn}` : "URN not linked", 405, 193, 9, MUTED);
  const kpiY = 224;
  doc.kpi("Assigned staff", String(staff.length), PAGE.margin, kpiY, 116);
  doc.kpi("Complete DBS", String(staff.filter((person) => dbsNumberFor(person)).length), 171, kpiY, 116);
  doc.kpi("SCR blockers", String(blockerRows.length), 300, kpiY, 116);
  doc.kpi("Open logs", String(openLogs.length), 429, kpiY, 124);

  y = kpiY + 86;
  doc.sectionTitle("Current Staff Only", PAGE.margin, y);
  y = doc.table(
    ["Staff member", "Role", "DBS number", "SCR checked"],
    currentStaffRows,
    PAGE.margin,
    y + 14,
    [134, 104, 132, 140],
    { rowHeight: 24 },
  );

  y += 14;
  doc.sectionTitle("Named Evidence To Open First", PAGE.margin, y);
  y = doc.table(
    ["Area", "Staff", "Evidence", "Date / expiry"],
    namedEvidenceRows,
    PAGE.margin,
    y + 14,
    [92, 92, 202, 124],
    { rowHeight: 29 },
  );

  y += 14;
  doc.sectionTitle("Required Cover", PAGE.margin, y);
  y = doc.table(
    ["Requirement", "Status", "Named evidence"],
    coverTableRows,
    PAGE.margin,
    y + 14,
    [125, 70, 315],
    { rowHeight: 24 },
  );

  y += 14;
  doc.sectionTitle(blockerRows.length > 2 ? "Immediate SCR Actions - First Two" : "Immediate SCR Actions", PAGE.margin, y);
  y = doc.table(
    ["Staff member", "Evidence checks", "DBS", "Detail"],
    blockerTableRows.slice(0, 2),
    PAGE.margin,
    y + 14,
    [104, 196, 110, 100],
    { rowHeight: 28 },
  );

  drawInspectionFooter(doc, "Page 1: inspection overview, required cover and immediate SCR actions.");

  doc.addPage();
  doc.pageHeader("Inspection Evidence Pack", `Site: ${siteName}`);
  y = 112;
  doc.sectionTitle("Site SCR Checklist", PAGE.margin, y);
  y = doc.wrap("This page is filtered to current staff assigned to this site only. It mirrors the live SCR checklist: DBS numbers, SCR checked dates, safeguarding, allergy, first aid, references and annual suitability declaration status.", PAGE.margin, y + 18, 500, 9, MUTED, 12);
  chunkRows(inspectionChecklistRows, 11).forEach((chunk, index) => {
    if (index > 0) {
      drawInspectionFooter(doc, "Site SCR checklist continued.");
      doc.addPage();
      doc.pageHeader("Inspection Evidence Pack", `Site: ${siteName}`);
      y = 112;
      doc.sectionTitle("Site SCR Checklist Continued", PAGE.margin, y);
    }
    y = doc.table(
      ["Staff", "DBS / checked", "Training", "References", "Suitability", "Action"],
      chunk,
      PAGE.margin,
      y + 14,
      [88, 98, 118, 82, 82, 42],
      { rowHeight: 48 },
    );
  });
  drawInspectionFooter(doc, "Page 2: site-scoped SCR checklist with DBS numbers, checked dates, training, references and annual suitability.");

  doc.addPage();
  doc.pageHeader("Inspection Evidence Pack", `Site: ${siteName}`);
  y = 116;
  doc.sectionTitle("Site Operation and Documents", PAGE.margin, y);
  y = doc.wrap(`Session context: ${sessionSummary}. Documents below should be openable from the live Documents library if requested.`, PAGE.margin, y + 18, 500, 8.5, MUTED, 11);
  const startY = y + 8;
  policyRows.forEach((row, index) => {
    const column = index % 2;
    const itemY = startY + Math.floor(index / 2) * 34;
    const x = column === 0 ? PAGE.margin : 310;
    doc.rect(x, itemY, 238, 26, row[1] === "Linked" ? [0.95, 0.99, 0.96] : [1, 0.98, 0.94], LINE);
    doc.text(row[0], x + 8, itemY + 11, 7.5, BLUE);
    doc.text(`${row[1]} - ${row[2]}`, x + 8, itemY + 22, 7.1, MUTED);
  });

  y = startY + Math.ceil(policyRows.length / 2) * 34 + 28;
  doc.sectionTitle("Open Operational Logs", PAGE.margin, y);
  y = doc.table(
    ["Area", "Status", "Owner", "Date"],
    openLogRows,
    PAGE.margin,
    y + 14,
    [155, 100, 135, 120],
    { rowHeight: 30 },
  );

  doc.text("Prepared by:", PAGE.margin, 760, 9, INK);
  doc.line(100, 760, 260, 760, MUTED);
  doc.text("Name / position:", PAGE.margin, 784, 9, INK);
  doc.line(120, 784, 280, 784, MUTED);
  doc.text(`Generated: ${dateStamp()}`, 365, 784, 8, MUTED);
  drawInspectionFooter(doc, "Page 3: documents, operational logs and sign-off.");

  doc.addPage();
  doc.pageHeader("Inspection Evidence Pack", `Site: ${siteName}`);
  y = 116;
  doc.sectionTitle("Inspection Quick Routes", PAGE.margin, y);
  y = doc.wrap(
    "Use this page during the inspection conversation. It keeps the pack focused on this site and points you to the exact page or live SCR area to open first.",
    PAGE.margin,
    y + 18,
    500,
    8.8,
    MUTED,
    12,
  );
  y = doc.table(
    ["Inspector asks", "Open first", "What to say / check"],
    quickRouteRows,
    PAGE.margin,
    y + 16,
    [150, 145, 215],
    { rowHeight: 38 },
  );

  y += 22;
  doc.sectionTitle("Site Scope Reminder", PAGE.margin, y);
  doc.rect(PAGE.margin, y + 18, PAGE.width - PAGE.margin * 2, 72, [0.95, 0.97, 1], LINE);
  doc.wrap(
    `This export is for ${siteName}. It should only include staff assigned to this site and the documents, logs and evidence relevant to this inspection. If a person is not assigned to ${siteName}, they should not appear in the current staff roster or DBS table.`,
    PAGE.margin + 16,
    y + 42,
    500,
    8.6,
    INK,
    12,
  );
  drawInspectionFooter(doc, "Page 4: inspection questions, quick routes and site-scope reminder.");
  if (options.returnBytes) return doc.output();
  downloadPdf(`apres-inspection-pack-${slug(site.school || "kings-house-school")}-${fileStamp()}.pdf`, doc);
}

export function exportPayrollSummary(rows = [], period = "", run = {}, options = {}) {
  const payrollRows = Array.isArray(rows) ? rows : [];
  const periodLabel = formatPeriod(period);
  const totalHours = payrollRows.reduce((sum, row) => sum + Number(row.hours || 0), 0);
  const totalGross = payrollRows.reduce((sum, row) => sum + Number(row.gross || 0), 0);
  const totalExpenses = payrollRows.reduce((sum, row) => sum + Number(row.expenses || 0), 0);
  const totalDeductions = payrollRows.reduce((sum, row) => sum + Number(row.deductions || 0), 0);
  const totalNet = payrollRows.reduce((sum, row) => sum + Number(row.net ?? (Number(row.gross || 0) + Number(row.expenses || 0) - Number(row.deductions || 0))), 0);
  const staffToPay = payrollRows.filter((row) => Number(row.hours || 0) > 0 || Number(row.monthlySalary || 0) > 0 || (row.payslips || []).length > 0);
  const payslipsUploaded = staffToPay.filter((row) => (row.payslips || []).length > 0).length;
  const doc = new PdfDoc(`${periodLabel} Payroll Summary`).addPage();
  doc.pageHeader("Payroll Summary", `Period: ${periodLabel}`);
  doc.text(`${periodLabel} Payroll Summary`, PAGE.margin, 116, 20, BLUE);
  let y = doc.wrap("Internal payroll record generated from Apres School payroll data. Check live records before submitting payment externally.", PAGE.margin, 142, 500, 9.5, MUTED);

  const kpiY = y + 16;
  doc.kpi("Staff due pay", String(staffToPay.length), PAGE.margin, kpiY, 116);
  doc.kpi("Paid hours", totalHours.toFixed(2), 171, kpiY, 116);
  doc.kpi("Gross payroll", money(totalGross), 300, kpiY, 116);
  doc.kpi("Net payroll", money(totalNet), 429, kpiY, 124);

  y = kpiY + 92;
  doc.sectionTitle("Run Status", PAGE.margin, y);
  y = doc.table(
    ["Status", "Reviewed", "Approved", "Paid", "Payslips"],
    [[
      run.status || "Draft",
      run.reviewedAt ? formatDate(run.reviewedAt) : "Not reviewed",
      run.approvedAt ? formatDate(run.approvedAt) : "Not approved",
      run.paidAt ? formatDate(run.paidAt) : "Not paid",
      `${payslipsUploaded}/${staffToPay.length} uploaded`,
    ]],
    PAGE.margin,
    y + 18,
    [82, 105, 105, 105, 113],
    { rowHeight: 34 },
  );

  y += 32;
  doc.sectionTitle("Financial Totals", PAGE.margin, y);
  y = doc.table(
    ["Gross", "Expenses", "Deductions", "Net"],
    [[money(totalGross), money(totalExpenses), money(totalDeductions), money(totalNet)]],
    PAGE.margin,
    y + 18,
    [128, 128, 128, 126],
    { rowHeight: 34 },
  );

  const exportRows = payrollRows
    .filter((row) => options.includeAllStaff || Number(row.hours || 0) > 0 || Number(row.monthlySalary || 0) > 0 || (row.payslips || []).length > 0)
    .map((row) => {
      const net = Number(row.net ?? (Number(row.gross || 0) + Number(row.expenses || 0) - Number(row.deductions || 0)));
      const schools = Array.from(new Set((row.payrollEntries || []).map((entry) => entry.schoolName).filter(Boolean))).join(", ");
      return [
        row.name || "Staff",
        schools || "Salary / no site hours",
        Number(row.hours || 0).toFixed(2),
        money(row.gross || 0),
        money(net),
        (row.payslips || []).length ? "Uploaded" : "Missing",
      ];
    });

  const chunks = [];
  for (let index = 0; index < exportRows.length; index += 17) chunks.push(exportRows.slice(index, index + 17));
  chunks.forEach((chunk, index) => {
    if (index === 0) {
      y += 34;
    } else {
      doc.addPage();
      doc.pageHeader("Payroll Summary", `Period: ${periodLabel}`);
      y = 116;
    }
    doc.sectionTitle(index === 0 ? "Staff Payroll Rows" : "Staff Payroll Rows Continued", PAGE.margin, y);
    y = doc.table(
      ["Staff", "Schools", "Hours", "Gross", "Net", "Payslip"],
      chunk,
      PAGE.margin,
      y + 18,
      [105, 125, 52, 78, 78, 72],
      { rowHeight: 34 },
    );
  });

  if (!exportRows.length) {
    y += 34;
    doc.wrap("No staff payroll rows are currently due pay for this period.", PAGE.margin, y, 500, 10, MUTED);
  }

  doc.text("Generated from Apres School internal payroll records.", PAGE.margin, 804, 8, MUTED);
  downloadPdf(`apres-payroll-summary-${slug(periodLabel)}-${fileStamp()}.pdf`, doc);
}

export function exportFinanceInvoicePdf(invoice = {}, customer = {}, settings = {}, options = {}) {
  const invoiceNumber = invoice.invoiceNumber || invoice.draftReference || "Draft invoice";
  const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
  const bankAccountName = settings.bankAccountName || "Apres School Limited";
  const bankSortCode = settings.bankSortCode || "04-00-03";
  const bankAccountNumber = settings.bankAccountNumber || "21773814";
  const companyName = settings.companyName || "Apres School Limited";
  const financeEmail = settings.financeEmail || "hello@apres-school.co.uk";
  const website = settings.website || "www.apres-school.co.uk";
  const doc = new PdfDoc(`Invoice ${invoiceNumber}`);
  const tableX = PAGE.margin;
  const tableWidth = PAGE.width - PAGE.margin * 2;
  const tableWidths = [246, 55, 72, 61, 77];
  const tableBottom = 744;
  const lineSize = 8.2;
  const lineHeight = 10.8;
  const lineRows = lines.length ? lines.map((line) => [
    line.description || "Service",
    `${Number(line.quantity || 0).toFixed(2)} ${line.unit || ""}`.trim(),
    money(line.unitPrice),
    line.vatRate || "No VAT",
    money(line.grossTotal),
  ]) : [["No lines recorded", "", "", "", money(invoice.total)]];

  const addInvoiceHeader = (continued = false) => {
    doc.addPage();
    doc.textBold("Apres School", PAGE.margin, 40, 17, BLUE);
    doc.text("Let's Learn and Play", PAGE.margin, 58, 8, AMBER);
    doc.textBold("INVOICE", 430, 40, 20, BLUE);
    doc.text(invoiceNumber, 430, 62, 9.5, INK);
    if (continued) doc.text("Continued", 430, 77, 8, MUTED);
    doc.line(PAGE.margin, 92, PAGE.width - PAGE.margin, 92);
  };

  const renderMetaPanel = () => {
    doc.rect(344, 116, 209, 124, WHITE, LINE);
    const metaRows = [
      ["Invoice date", formatDate(invoice.invoiceDate)],
      ["Due date", formatDate(invoice.dueDate)],
      ["Purchase order", invoice.purchaseOrder || "Not supplied"],
      ["Service period", servicePeriodLabel(invoice)],
    ];
    metaRows.forEach(([label, value], index) => {
      const rowY = 134 + index * 27;
      doc.text(label.toUpperCase(), 360, rowY, 7.2, MUTED);
      doc.wrap(value, 360, rowY + 12, 170, 8.5, INK, 10.5);
    });
  };

  const renderCompanyInfo = () => {
    let companyY = 122;
    doc.textBold(companyName, PAGE.margin, companyY, 10.5, INK);
    if (settings.registeredAddress) {
      companyY = doc.wrap(settings.registeredAddress, PAGE.margin, companyY + 15, 250, 8.2, MUTED, 10.5);
    }
    const companyLines = [
      settings.companyNumber ? `Company Number: ${settings.companyNumber}` : "",
      settings.vatStatus === "registered" && settings.vatNumber ? `VAT Number: ${settings.vatNumber}` : "",
      `Finance Email: ${financeEmail}`,
      `Website: ${website}`,
    ].filter(Boolean);
    companyLines.forEach((line) => {
      doc.text(line, PAGE.margin, companyY + 10, 8.2, MUTED);
      companyY += 13;
    });
  };

  const renderBillTo = () => {
    doc.textBold("Bill To", PAGE.margin, 252, 12, BLUE);
    doc.line(PAGE.margin, 262, 286, 262);
    let billY = 284;
    const addressLines = String(customer.billingAddress || invoice.billingAddress || "")
      .split(/\n|,/)
      .map((line) => clean(line).trim())
      .filter(Boolean);
    const billingLines = [
      customer.customerName || invoice.customerName || "Customer",
      customer.accountsContact || invoice.accountsContact || "",
      customer.accountsEmail || invoice.accountsEmail || "",
      ...addressLines,
    ].filter(Boolean);
    billingLines.forEach((line, index) => {
      billY = doc.wrap(line, PAGE.margin, billY, 238, index === 0 ? 10 : 8.6, index === 0 ? BLUE : MUTED, index === 0 ? 13 : 11, index === 0 ? "F2" : "F1");
      billY += index === 0 ? 4 : 1;
    });
  };

  const renderSummary = () => {
    doc.textBold("Summary", 344, 252, 12, BLUE);
    doc.line(344, 262, PAGE.width - PAGE.margin, 262);
    const summaryRows = [
      ["Subtotal", money(invoice.subtotal)],
      ["VAT", money(invoice.vatTotal)],
      ["Total Due", money(invoice.total)],
      ["Balance Outstanding", money(invoice.balanceDue ?? invoice.total)],
    ];
    summaryRows.forEach(([label, value], index) => {
      const rowY = 288 + index * 24;
      const isTotal = label === "Total Due";
      if (isTotal) doc.rect(344, rowY - 16, 209, 28, PALE_GREEN, LINE);
      doc.text(label, 360, rowY, isTotal ? 9 : 8.5, isTotal ? INK : MUTED);
      doc.textBold(value, 470, rowY, isTotal ? 12 : 9.5, isTotal ? GREEN : INK);
    });
  };

  const renderTableHeader = (y) => {
    doc.rect(tableX, y, tableWidth, 28, SOFT, LINE);
    let cursorX = tableX;
    ["Description", "Qty", "Unit Price", "VAT", "Total"].forEach((header, index) => {
      doc.textBold(header.toUpperCase(), cursorX + 8, y + 17, 7.1, MUTED);
      cursorX += tableWidths[index];
    });
    return y + 28;
  };

  const rowHeightFor = (row) => {
    const lineCounts = row.map((cell, index) => doc.measureLines(cell, tableWidths[index] - 16, lineSize).length);
    return Math.max(38, Math.max(...lineCounts) * lineHeight + 18);
  };

  const renderTableRow = (row, y) => {
    const rowHeight = rowHeightFor(row);
    doc.rect(tableX, y, tableWidth, rowHeight, WHITE, LINE);
    let cursorX = tableX;
    row.forEach((cell, index) => {
      doc.wrap(cell, cursorX + 8, y + 15, tableWidths[index] - 16, lineSize, index === 0 ? INK : MUTED, lineHeight);
      cursorX += tableWidths[index];
    });
    return y + rowHeight;
  };

  addInvoiceHeader(false);
  renderCompanyInfo();
  renderMetaPanel();
  renderBillTo();
  renderSummary();

  let y = 390;
  doc.textBold("Invoice Lines", PAGE.margin, y, 12.5, BLUE);
  y = renderTableHeader(y + 18);
  lineRows.forEach((row) => {
    const rowHeight = rowHeightFor(row);
    if (y + rowHeight > tableBottom) {
      addInvoiceHeader(true);
      y = renderTableHeader(116);
    }
    y = renderTableRow(row, y);
  });

  const paymentPanelHeight = 182;
  const footerText = invoice.notes || settings.defaultInvoiceFooter || "Please use the invoice number as your payment reference.";
  if (y + paymentPanelHeight + 44 > tableBottom) {
    addInvoiceHeader(true);
    y = 118;
  } else {
    y += 24;
  }

  doc.rect(PAGE.margin, y, tableWidth, paymentPanelHeight, [0.94, 0.96, 1], LINE);
  doc.textBold("How to Pay", PAGE.margin + 18, y + 28, 14, BLUE);
  const paymentRows = [
    ["Payment Method", "BACS"],
    ["Account Name", bankAccountName],
    ["Sort Code", bankSortCode],
    ["Account Number", bankAccountNumber],
    ["Reference", invoiceNumber],
  ];
  paymentRows.forEach(([label, value], index) => {
    const rowY = y + 56 + index * 23;
    doc.text(label, PAGE.margin + 18, rowY, 8, MUTED);
    doc.textBold(value, PAGE.margin + 150, rowY, index === 4 ? 11 : 9.2, index === 4 ? AMBER : INK);
  });
  doc.wrap("Please use the invoice number as your payment reference.", PAGE.margin + 18, y + 168, 330, 8.5, MUTED, 10.5);
  doc.rect(PAGE.width - PAGE.margin - 170, y + 38, 150, 94, WHITE, LINE);
  doc.text("Total Due", PAGE.width - PAGE.margin - 150, y + 66, 8.4, MUTED);
  doc.textBold(money(invoice.total), PAGE.width - PAGE.margin - 150, y + 96, 19, BLUE);

  let footerY = y + paymentPanelHeight + 28;
  const standardPaymentNote = "Please use the invoice number as your payment reference.";
  if (clean(footerText).toLowerCase() !== standardPaymentNote.toLowerCase()) {
    const footerLines = doc.measureLines(footerText, tableWidth, 8.4);
    const footerHeight = footerLines.length * 11 + 28;
    if (footerY + footerHeight > 794) {
      addInvoiceHeader(true);
      footerY = 118;
    }
    doc.line(PAGE.margin, footerY, PAGE.width - PAGE.margin, footerY);
    doc.wrap(footerText, PAGE.margin, footerY + 18, tableWidth, 8.4, MUTED, 11);
  }
  doc.text(`Finance contact: ${financeEmail}${settings.financeTelephone ? ` | ${settings.financeTelephone}` : ""}`, PAGE.margin, 816, 8, MUTED);

  doc.pages.forEach((page, index) => {
    const previous = doc.current;
    doc.current = page;
    doc.text(`Page ${index + 1} of ${doc.pages.length}`, PAGE.width - PAGE.margin - 70, 816, 8, MUTED);
    doc.current = previous;
  });

  if (options.returnBytes) return doc.output();
  downloadPdf(`apres-invoice-${slug(invoiceNumber)}.pdf`, doc);
}

function servicePeriodLabel(invoice = {}) {
  if (invoice.servicePeriodStart && invoice.servicePeriodEnd) return `${formatDate(invoice.servicePeriodStart)} - ${formatDate(invoice.servicePeriodEnd)}`;
  if (invoice.servicePeriodStart) return formatDate(invoice.servicePeriodStart);
  return "Not specified";
}
