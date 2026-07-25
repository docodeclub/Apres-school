import {
  blockingPeriods,
  calendarForSchool,
  teachingWindows,
} from "./schoolCalendars2026.js";

const weekdays = new Set([1, 2, 3, 4, 5]);

export function formatWraparoundDay(date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function atNoon(isoDate) {
  return new Date(`${isoDate}T12:00:00`);
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function expandRange(start, end) {
  const dates = [];
  const cursor = atNoon(start);
  const last = atNoon(end);
  for (; cursor <= last; cursor.setDate(cursor.getDate() + 1)) {
    dates.push(dateKey(cursor));
  }
  return dates;
}

export function generateTermDays(windows, exclusions = []) {
  const excluded = new Set(exclusions.flatMap((item) => {
    if (typeof item === "string") return [item];
    return expandRange(item.start, item.end);
  }));
  const days = [];
  for (const window of windows) {
    const cursor = atNoon(window.start);
    const last = atNoon(window.end);
    for (; cursor <= last; cursor.setDate(cursor.getDate() + 1)) {
      const key = dateKey(cursor);
      // Exclusions are inclusive and win over term windows, so INSET days,
      // half terms, bank holidays, closures and KHS last days never become bookable.
      if (weekdays.has(cursor.getDay()) && !excluded.has(key)) {
        days.push(formatWraparoundDay(cursor));
      }
    }
  }
  return days;
}

export const wraparound2026Configs = Object.fromEntries(
  ["ripley", "willington", "shrewsbury", "kings"].map((key) => {
    const calendar = calendarForSchool(key);
    const blocked = blockingPeriods(key);
    return [key, {
      site: calendar.site,
      area: calendar.area,
      windows: teachingWindows(key),
      exclusions: blocked
        .filter((period) => period.end)
        .map((period) => period.start === period.end
          ? period.start
          : { start: period.start, end: period.end }),
      blockedLabels: blocked.map((period) =>
        `${period.label}: ${period.start}${period.end && period.end !== period.start ? ` to ${period.end}` : ""}`
      ),
    }];
  })
);

export function daysForWraparoundConfig(key) {
  const config = wraparound2026Configs[key];
  return generateTermDays(config.windows, config.exclusions);
}

export function expandedBlockedDates(config) {
  return new Set(config.exclusions.flatMap((item) => {
    if (typeof item === "string") return [item];
    return expandRange(item.start, item.end);
  }));
}

export function dayLabelToIso(label) {
  const cleaned = String(label || "").replace(/,/g, "").trim();
  const parsed = new Date(`${cleaned} 12:00:00`);
  return Number.isNaN(parsed.getTime()) ? "" : dateKey(parsed);
}
