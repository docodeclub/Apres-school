import { labSessions } from "../src/bookingLab/labData.js";
import { dayLabelToIso } from "../src/bookingLab/wraparound2026.js";

const launchRows = labSessions.filter((session) => session.type === "Wraparound" && session.academicYear === "2026/27");
const failures = [];
const summary = [];

for (const session of launchRows) {
  const blocks = Array.isArray(session.sessionBlocks) ? session.sessionBlocks : [];
  const days = Array.isArray(session.days) ? session.days : [];
  const blockMappings = [];

  if (!session.id.startsWith("lab-")) failures.push(`${session.id}: lab session id must be stable for backend mapping`);
  if (!days.length) failures.push(`${session.id}: no launch days available`);
  if (!blocks.length) failures.push(`${session.id}: no session blocks available`);

  for (const dayLabel of days) {
    const sessionDate = dayLabelToIso(dayLabel);
    if (!sessionDate) failures.push(`${session.id}: cannot resolve date for ${dayLabel}`);

    for (const block of blocks) {
      if (!block.label) failures.push(`${session.id}: block missing label for ${dayLabel}`);
      if (!block.start || !block.end) failures.push(`${session.id}: ${block.label || "block"} missing time for ${dayLabel}`);
      blockMappings.push({
        labSessionId: session.id,
        sessionDate,
        sessionLabel: block.label,
      });
    }
  }

  const duplicateKeys = findDuplicates(blockMappings.map((item) => `${item.labSessionId}|${item.sessionDate}|${item.sessionLabel}`));
  duplicateKeys.forEach((key) => failures.push(`${session.id}: duplicate backend mapping ${key}`));

  summary.push({
    id: session.id,
    site: session.site,
    programme: session.title,
    days: days.length,
    blocksPerDay: blocks.length,
    backendBlockMappings: blockMappings.length,
    sample: blockMappings[0] || null,
  });
}

const totals = summary.reduce((acc, row) => {
  acc.sessions += 1;
  acc.days += row.days;
  acc.backendBlockMappings += row.backendBlockMappings;
  return acc;
}, { sessions: 0, days: 0, backendBlockMappings: 0 });

console.log(JSON.stringify({
  backendMapReady: failures.length === 0,
  totals,
  summary,
  failures,
}, null, 2));

if (failures.length) process.exitCode = 1;

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  values.forEach((value) => {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  });
  return [...duplicates];
}
