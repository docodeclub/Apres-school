import {
  bookingGroups,
  schoolCalendars2026,
} from "../src/bookingLab/schoolCalendars2026.js";
import { daysForWraparoundConfig, dayLabelToIso } from "../src/bookingLab/wraparound2026.js";
import { readFileSync } from "node:fs";

const failures = [];
const summaries = [];
const blockingKinds = new Set([
  "half_term_holiday",
  "seasonal_holiday",
  "bank_holiday",
  "inset_day",
  "induction_day",
  "operational_closure",
]);
const migrationSql = readFileSync(
  new URL("../supabase/migrations/0054_school_booking_calendars.sql", import.meta.url),
  "utf8"
);

for (const [key, calendar] of Object.entries(schoolCalendars2026)) {
  const teaching = calendar.periods.filter((period) => period.kind === "teaching");
  const groups = bookingGroups(key);

  if (teaching.length !== 6) failures.push(`${key}: expected six teaching half-terms, found ${teaching.length}`);
  if (groups.terms.some((term) => term.halfTermIds.length !== 2)) {
    failures.push(`${key}: every term must contain exactly two teaching half-terms`);
  }

  for (const period of calendar.periods) {
    if (!isIsoDate(period.start)) failures.push(`${key}: invalid start date for ${period.label}`);
    if (period.end && !isIsoDate(period.end)) failures.push(`${key}: invalid end date for ${period.label}`);
    if (period.end && period.start > period.end) failures.push(`${key}: inverted range for ${period.label}`);
    if (period.afterSchoolEligible && period.kind !== "teaching") {
      failures.push(`${key}: non-teaching period is after-school eligible: ${period.label}`);
    }
    if (period.campCandidate && (!period.end || !["half_term_holiday", "seasonal_holiday"].includes(period.kind))) {
      failures.push(`${key}: invalid camp candidate: ${period.label}`);
    }
    if (!period.end && period.campCandidate) failures.push(`${key}: open-ended period cannot be camp-bookable: ${period.label}`);
    const sqlLabel = period.label.replaceAll("'", "''");
    if (!migrationSql.includes(`'${sqlLabel}','${period.start}'`)) {
      failures.push(`${key}: database migration is missing ${period.label} on ${period.start}`);
    }
  }

  const sortedTeaching = [...teaching].sort((a, b) => a.start.localeCompare(b.start));
  for (let index = 1; index < sortedTeaching.length; index += 1) {
    if (sortedTeaching[index].start <= sortedTeaching[index - 1].end) {
      failures.push(`${key}: teaching periods overlap at ${sortedTeaching[index].label}`);
    }
  }

  const generatedDays = daysForWraparoundConfig(key).map(dayLabelToIso);
  for (const date of generatedDays) {
    const insideTeaching = teaching.some((period) => date >= period.start && date <= period.end);
    const blocked = calendar.periods.some((period) =>
      blockingKinds.has(period.kind)
      && period.end
      && date >= period.start
      && date <= period.end
    );
    if (!insideTeaching || blocked) failures.push(`${key}: generated invalid wraparound day ${date}`);
  }

  summaries.push({
    school: calendar.site,
    teachingHalfTerms: teaching.length,
    wraparoundDays: generatedDays.length,
    holidayWindows: calendar.periods.filter((period) => period.campCandidate).length,
    openEndedPeriodsAwaitingPublication: calendar.periods.filter((period) => !period.end).length,
    sourceCheckedOn: calendar.sourceCheckedOn,
  });
}

console.log(JSON.stringify({
  valid: failures.length === 0,
  summaries,
  failures,
}, null, 2));

if (failures.length) process.exitCode = 1;

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  return new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
