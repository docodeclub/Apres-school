const PAGE = { width: 595, height: 842, margin: 42 };
const BLUE = [0.15, 0.25, 0.66];
const ROYAL = [0.29, 0.41, 0.85];
const GREEN = [0.15, 0.66, 0.46];
const AMBER = [0.95, 0.56, 0.15];
const INK = [0.09, 0.09, 0.18];
const MUTED = [0.36, 0.39, 0.46];
const LINE = [0.86, 0.89, 0.98];
const SOFT = [0.96, 0.97, 1];
const WHITE = [1, 1, 1];

function clean(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/£/g, "GBP ")
    .replace(/[^\x20-\x7E]/g, "");
}

function escapePdf(value) {
  return clean(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
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

  text(value, x, y, size = 10, color = INK) {
    this.current.push(`BT /F1 ${size} Tf ${this.rgb(color)} rg ${x.toFixed(2)} ${(PAGE.height - y).toFixed(2)} Td (${escapePdf(value)}) Tj ET`);
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

  wrap(value, x, y, width, size = 10, color = INK, lineHeight = size * 1.35) {
    const maxChars = Math.max(18, Math.floor(width / (size * 0.52)));
    const words = clean(value).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    words.forEach((word) => {
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxChars && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    lines.forEach((lineText, index) => this.text(lineText, x, y + index * lineHeight, size, color));
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
    this.text(value, x + 12, y + 45, 17, BLUE);
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
    const pageIds = [];
    this.pages.forEach((page) => {
      const stream = page.join("\n");
      const contentId = addObject(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`);
      const pageId = addObject(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
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
      ["Enhanced DBS", checklistStatus(staff, "dbs", evidenceRequests), evidenceSummary(staff, "dbs", evidenceRequests)],
      ["Barred list", checklistStatus(staff, "barredList", evidenceRequests), evidenceSummary(staff, "barredList", evidenceRequests)],
      ["Safeguarding training", checklistStatus(staff, "safeguarding", evidenceRequests), evidenceSummary(staff, "safeguarding", evidenceRequests)],
      ["Allergy awareness", checklistStatus(staff, "allergy", evidenceRequests), evidenceSummary(staff, "allergy", evidenceRequests)],
      ["References", checklistStatus(staff, "references", evidenceRequests), evidenceSummary(staff, "references", evidenceRequests)],
      ["Annual declarations", checklistStatus(staff, "declarations", evidenceRequests), evidenceSummary(staff, "declarations", evidenceRequests)],
    ],
    PAGE.margin,
    y + 18,
    [170, 175, 165],
    { rowHeight: 32 },
  );

  y += 32;
  doc.sectionTitle("Recruitment and Annual Declarations", PAGE.margin, y);
  y = doc.wrap("The full record supports application review, employment gaps, references, overseas checks where applicable, qualifications, annual medical and criminal declarations, childcare disqualification declarations and evidence requests.", PAGE.margin, y + 24, 500, 10, MUTED);
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
    ["Staff member", "Role", "DBS", "Safeguarding", "First aid", "SCR status"],
    staff.map((person) => [
      person.name,
      person.role,
      checklistStatus(person, "dbs", evidenceRequests),
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
