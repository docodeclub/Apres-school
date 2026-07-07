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

export const wraparound2026Configs = {
  ripley: {
    site: "Ripley Court",
    area: "Surrey",
    windows: [
      { start: "2026-09-04", end: "2026-12-11" },
      { start: "2027-01-06", end: "2027-03-19" },
      { start: "2027-04-13", end: "2027-07-07" },
    ],
    exclusions: [
      "2026-09-02",
      "2026-09-03",
      { start: "2026-10-19", end: "2026-10-30" },
      { start: "2026-12-14", end: "2027-01-05" },
      "2027-01-05",
      { start: "2027-02-15", end: "2027-02-19" },
      { start: "2027-03-21", end: "2027-04-12" },
      "2027-04-12",
      { start: "2027-05-31", end: "2027-06-04" },
    ],
    blockedLabels: [
      "INSET: 2-3 Sept 2026, 5 Jan 2027, 12 Apr 2027",
      "Half terms: 19-30 Oct 2026, 15-19 Feb 2027, 31 May-4 Jun 2027",
      "Winter and spring holidays excluded",
    ],
  },
  willington: {
    site: "Willington Prep",
    area: "Wimbledon",
    windows: [
      { start: "2026-09-03", end: "2026-12-11" },
      { start: "2027-01-04", end: "2027-03-25" },
      { start: "2027-04-12", end: "2027-07-07" },
    ],
    exclusions: [
      "2026-08-28",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      { start: "2026-10-19", end: "2026-10-30" },
      "2026-12-14",
      { start: "2027-02-15", end: "2027-02-19" },
      "2027-05-03",
      "2027-05-31",
      { start: "2027-06-01", end: "2027-06-04" },
      "2027-07-08",
    ],
    blockedLabels: [
      "INSET/bank holidays: 28 Aug, 31 Aug, 1-2 Sept, 14 Dec 2026; 3 May, 31 May, 8 Jul 2027",
      "Half terms: 19-30 Oct 2026, 15-19 Feb 2027, 1-4 Jun 2027",
    ],
  },
  shrewsbury: {
    site: "Shrewsbury House School",
    area: "Surbiton",
    windows: [
      { start: "2026-09-03", end: "2026-12-09" },
      { start: "2027-01-06", end: "2027-03-24" },
      { start: "2027-04-20", end: "2027-07-09" },
    ],
    exclusions: [
      { start: "2026-10-19", end: "2026-10-30" },
      { start: "2027-02-15", end: "2027-02-19" },
      { start: "2027-05-31", end: "2027-06-04" },
    ],
    blockedLabels: [
      "Half terms: 19-30 Oct 2026, 15-19 Feb 2027, 31 May-4 Jun 2027",
      "Assumption: normal wraparound starts 3 Sept 2026 for whole school",
      "Autumn/Spring 2pm finishes are flagged only; no 2pm sessions created",
    ],
  },
  kings: {
    site: "King's House School",
    area: "Richmond",
    windows: [
      { start: "2026-09-03", end: "2026-12-10" },
      { start: "2027-01-06", end: "2027-03-23" },
      { start: "2027-04-14", end: "2027-07-06" },
    ],
    exclusions: [
      "2026-08-28",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      { start: "2026-10-19", end: "2026-10-30" },
      "2026-12-11",
      "2027-01-05",
      "2027-02-12",
      { start: "2027-02-15", end: "2027-02-19" },
      "2027-03-24",
      "2027-04-12",
      "2027-04-13",
      "2027-05-03",
      { start: "2027-05-31", end: "2027-06-04" },
      "2027-07-07",
    ],
    blockedLabels: [
      "KHS last days excluded: 11 Dec 2026, 24 Mar 2027, 7 Jul 2027",
      "Training/bank holidays: 28 Aug, 31 Aug, 1-2 Sept 2026; 5 Jan, 12 Feb, 12-13 Apr, 3 May 2027",
      "Half terms: 19-30 Oct 2026, 15-19 Feb 2027, 31 May-4 Jun 2027",
    ],
  },
};

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
