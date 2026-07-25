export const SCHOOL_CALENDAR_ACADEMIC_YEAR = "2026/27";
export const SCHOOL_CALENDAR_CHECKED_ON = "2026-07-19";

const sources = {
  ripley: "https://www.ripleycourt.co.uk/63/term-dates",
  shrewsbury: "https://www.shrewsburyhouse.net/term-dates",
  kings: "https://kingshouseschool.org/news-dates/term-dates/",
  willington: "https://www.willingtonschool.co.uk/co-educational-prep-wimbledon/term-dates",
};

function teaching(term, half, start, end, label, notes = "") {
  return {
    kind: "teaching",
    term,
    half,
    start,
    end,
    label: label || `${titleCase(term)} term – half ${half}`,
    pupilsInSchool: true,
    afterSchoolEligible: true,
    campCandidate: false,
    notes,
  };
}

function closure(kind, label, start, end, options = {}) {
  return {
    kind,
    label,
    start,
    end: end || null,
    term: options.term || null,
    half: null,
    pupilsInSchool: false,
    afterSchoolEligible: false,
    campCandidate: Boolean(options.campCandidate && end),
    notes: options.notes || "",
    pupilScope: options.pupilScope || "all",
  };
}

function school({ key, site, area, periods }) {
  return {
    key,
    site,
    area,
    academicYear: SCHOOL_CALENDAR_ACADEMIC_YEAR,
    sourceUrl: sources[key],
    sourceCheckedOn: SCHOOL_CALENDAR_CHECKED_ON,
    periods,
  };
}

export const schoolCalendars2026 = {
  ripley: school({
    key: "ripley",
    site: "Ripley Court",
    area: "Surrey",
    periods: [
      closure("seasonal_holiday", "Summer holiday", "2026-07-09", "2026-09-03", { campCandidate: true, notes: "Includes pupil-free INSET days on 2–3 September." }),
      closure("inset_day", "Staff INSET", "2026-09-02", "2026-09-03"),
      teaching("autumn", 1, "2026-09-04", "2026-10-16"),
      closure("half_term_holiday", "Autumn half-term", "2026-10-19", "2026-10-30", { term: "autumn", campCandidate: true }),
      teaching("autumn", 2, "2026-11-02", "2026-12-11"),
      closure("seasonal_holiday", "Christmas holiday", "2026-12-12", "2027-01-05", { campCandidate: true, notes: "School labels the winter holiday as 14 December–5 January; this record includes the preceding weekend." }),
      closure("inset_day", "Staff INSET", "2027-01-05", "2027-01-05"),
      teaching("spring", 1, "2027-01-06", "2027-02-12"),
      closure("half_term_holiday", "Spring half-term", "2027-02-15", "2027-02-19", { term: "spring", campCandidate: true }),
      teaching("spring", 2, "2027-02-22", "2027-03-19"),
      closure("seasonal_holiday", "Easter holiday", "2027-03-20", "2027-04-12", { campCandidate: true, notes: "School labels the spring holiday as 21 March–12 April; this record includes the preceding weekend." }),
      closure("inset_day", "Staff INSET", "2027-04-12", "2027-04-12"),
      teaching("summer", 1, "2027-04-13", "2027-05-28"),
      closure("half_term_holiday", "Summer half-term", "2027-05-31", "2027-06-04", { term: "summer", campCandidate: true }),
      teaching("summer", 2, "2027-06-07", "2027-07-07"),
      closure("seasonal_holiday", "Summer holiday – end not yet published", "2027-07-08", null, { notes: "Not camp-bookable until the next pupil return date is published." }),
    ],
  }),
  shrewsbury: school({
    key: "shrewsbury",
    site: "Shrewsbury House School",
    area: "Surbiton",
    periods: [
      closure("seasonal_holiday", "Summer holiday", "2026-07-04", "2026-09-02", { campCandidate: true, notes: "New Boys and Year 8 attend on 2 September; the whole school returns on 3 September." }),
      closure("induction_day", "New Boys and Year 8 return", "2026-09-02", "2026-09-02", { pupilScope: "new_boys_and_year_8" }),
      teaching("autumn", 1, "2026-09-03", "2026-10-16"),
      closure("half_term_holiday", "Autumn half-term", "2026-10-19", "2026-10-30", { term: "autumn", campCandidate: true }),
      teaching("autumn", 2, "2026-11-02", "2026-12-09", undefined, "2pm finish on final day."),
      closure("seasonal_holiday", "Christmas holiday", "2026-12-10", "2027-01-05", { campCandidate: true }),
      teaching("spring", 1, "2027-01-06", "2027-02-12"),
      closure("half_term_holiday", "Spring half-term", "2027-02-15", "2027-02-19", { term: "spring", campCandidate: true }),
      teaching("spring", 2, "2027-02-22", "2027-03-24", undefined, "2pm finish on final day."),
      closure("seasonal_holiday", "Easter holiday", "2027-03-25", "2027-04-19", { campCandidate: true }),
      teaching("summer", 1, "2027-04-20", "2027-05-28"),
      closure("half_term_holiday", "Summer half-term", "2027-05-31", "2027-06-04", { term: "summer", campCandidate: true }),
      teaching("summer", 2, "2027-06-07", "2027-07-09", undefined, "Prizegiving on final day."),
      closure("seasonal_holiday", "Summer holiday – end not yet published", "2027-07-10", null, { notes: "Not camp-bookable until the next pupil return date is published." }),
    ],
  }),
  kings: school({
    key: "kings",
    site: "King's House School",
    area: "Richmond",
    periods: [
      closure("seasonal_holiday", "Summer holiday", "2026-07-03", "2026-09-02", { campCandidate: true, notes: "Includes pupil-free staff training days on 1–2 September." }),
      closure("induction_day", "New staff induction", "2026-08-28", "2026-08-28"),
      closure("bank_holiday", "Summer Bank Holiday", "2026-08-31", "2026-08-31"),
      closure("inset_day", "Staff training", "2026-09-01", "2026-09-02"),
      teaching("autumn", 1, "2026-09-03", "2026-10-16"),
      closure("half_term_holiday", "Autumn half-term", "2026-10-19", "2026-10-30", { term: "autumn", campCandidate: true }),
      teaching("autumn", 2, "2026-11-02", "2026-12-11"),
      closure("operational_closure", "No wraparound on final day of autumn term", "2026-12-11", "2026-12-11", { notes: "Existing approved booking rule retained separately from the published school calendar." }),
      closure("seasonal_holiday", "Christmas holiday", "2026-12-12", "2027-01-05", { campCandidate: true }),
      closure("inset_day", "Staff training", "2027-01-05", "2027-01-05"),
      teaching("spring", 1, "2027-01-06", "2027-02-11"),
      closure("inset_day", "Staff training", "2027-02-12", "2027-02-12"),
      closure("half_term_holiday", "Spring half-term", "2027-02-15", "2027-02-19", { term: "spring", campCandidate: true }),
      teaching("spring", 2, "2027-02-22", "2027-03-24"),
      closure("operational_closure", "No wraparound on final day of spring term", "2027-03-24", "2027-03-24", { notes: "Existing approved booking rule retained separately from the published school calendar." }),
      closure("seasonal_holiday", "Easter holiday", "2027-03-25", "2027-04-13", { campCandidate: true, notes: "Includes pupil-free staff training days on 12–13 April." }),
      closure("inset_day", "Staff training", "2027-04-12", "2027-04-13"),
      teaching("summer", 1, "2027-04-14", "2027-05-28"),
      closure("bank_holiday", "Early May Bank Holiday", "2027-05-03", "2027-05-03"),
      closure("half_term_holiday", "Summer half-term", "2027-05-31", "2027-06-04", { term: "summer", campCandidate: true }),
      teaching("summer", 2, "2027-06-07", "2027-07-07"),
      closure("operational_closure", "No wraparound on final day of summer term", "2027-07-07", "2027-07-07", { notes: "Existing approved booking rule retained separately from the published school calendar." }),
      closure("seasonal_holiday", "Summer holiday – end not yet published", "2027-07-08", null, { notes: "Not camp-bookable until the next pupil return date is published." }),
    ],
  }),
  willington: school({
    key: "willington",
    site: "Willington Prep",
    area: "Wimbledon",
    periods: [
      closure("seasonal_holiday", "Summer holiday", "2026-07-04", "2026-09-02", { campCandidate: true, notes: "Includes pupil-free staff INSET days on 1–2 September." }),
      closure("induction_day", "SLT INSET", "2026-08-28", "2026-08-28"),
      closure("bank_holiday", "Summer Bank Holiday", "2026-08-31", "2026-08-31"),
      closure("inset_day", "Staff INSET", "2026-09-01", "2026-09-02"),
      teaching("autumn", 1, "2026-09-03", "2026-10-16"),
      closure("half_term_holiday", "Autumn half-term", "2026-10-19", "2026-10-30", { term: "autumn", campCandidate: true }),
      teaching("autumn", 2, "2026-11-02", "2026-12-11"),
      closure("seasonal_holiday", "Christmas holiday", "2026-12-12", "2027-01-03", { campCandidate: true }),
      closure("inset_day", "Staff INSET", "2026-12-14", "2026-12-14", { notes: "Falls inside the Christmas holiday." }),
      teaching("spring", 1, "2027-01-04", "2027-02-12"),
      closure("half_term_holiday", "Spring half-term", "2027-02-15", "2027-02-19", { term: "spring", campCandidate: true }),
      teaching("spring", 2, "2027-02-22", "2027-03-25"),
      closure("seasonal_holiday", "Easter holiday", "2027-03-26", "2027-04-11", { campCandidate: true }),
      teaching("summer", 1, "2027-04-12", "2027-05-28"),
      closure("bank_holiday", "Early May Bank Holiday", "2027-05-03", "2027-05-03"),
      closure("bank_holiday", "Spring Bank Holiday", "2027-05-31", "2027-05-31"),
      closure("half_term_holiday", "Summer half-term", "2027-06-01", "2027-06-04", { term: "summer", campCandidate: true }),
      teaching("summer", 2, "2027-06-07", "2027-07-07"),
      closure("seasonal_holiday", "Summer holiday – end not yet published", "2027-07-08", null, { notes: "Not camp-bookable until the next pupil return date is published." }),
    ],
  }),
};

export function calendarForSchool(key) {
  const calendar = schoolCalendars2026[key];
  if (!calendar) throw new Error(`Unknown school calendar: ${key}`);
  return calendar;
}

export function schoolCalendarKeyForSite(site) {
  return Object.entries(schoolCalendars2026)
    .find(([, calendar]) => calendar.site === site)?.[0] || null;
}

export function teachingWindows(key) {
  return calendarForSchool(key).periods
    .filter((period) => period.kind === "teaching")
    .map(({ start, end, term, half, label }) => ({ start, end, term, half, label }));
}

export function blockingPeriods(key) {
  return calendarForSchool(key).periods.filter((period) =>
    ["half_term_holiday", "seasonal_holiday", "bank_holiday", "inset_day", "induction_day", "operational_closure"].includes(period.kind)
  );
}

export function campCandidatePeriods(key) {
  return calendarForSchool(key).periods.filter((period) => period.campCandidate && period.end);
}

export function bookingGroups(key) {
  const windows = teachingWindows(key);
  const halfTerms = windows.map((window) => ({
    id: `${key}-${window.term}-${window.half}`,
    label: `${titleCase(window.term)} term – half ${window.half}`,
    term: window.term,
    half: window.half,
    start: window.start,
    end: window.end,
  }));
  const terms = ["autumn", "spring", "summer"].map((term) => {
    const halves = halfTerms.filter((period) => period.term === term);
    return {
      id: `${key}-${term}`,
      label: `${titleCase(term)} term`,
      term,
      start: halves[0]?.start || null,
      end: halves.at(-1)?.end || null,
      halfTermIds: halves.map((period) => period.id),
    };
  });
  return { halfTerms, terms };
}

function titleCase(value) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : "";
}
