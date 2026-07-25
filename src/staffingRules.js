export const STAFFING_DEFAULTS = Object.freeze({
  setupMinutes: 15,
  closingMinutes: 15,
  minimumStaff: 2,
  childrenPerStaff: 8,
  firstAiderRequired: true,
  level3Required: true,
  sendcoRequired: false,
});

export function calculatePaidShift(startsAt, endsAt, settings = {}) {
  const setupMinutes = Number(settings.setupMinutes ?? STAFFING_DEFAULTS.setupMinutes);
  const closingMinutes = Number(settings.closingMinutes ?? STAFFING_DEFAULTS.closingMinutes);
  const start = new Date(new Date(startsAt).getTime() - setupMinutes * 60000).toISOString();
  const end = new Date(new Date(endsAt).getTime() + closingMinutes * 60000).toISOString();
  return {
    start,
    end,
    setupMinutes,
    closingMinutes,
    paidMinutes: Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000)),
  };
}

export function requiredStaffCount(bookingCount, settings = {}) {
  const minimumStaff = Math.max(1, Number(settings.minimumStaff ?? STAFFING_DEFAULTS.minimumStaff));
  const childrenPerStaff = Math.max(1, Number(settings.childrenPerStaff ?? STAFFING_DEFAULTS.childrenPerStaff));
  return Math.max(minimumStaff, Math.ceil(Number(bookingCount || 0) / childrenPerStaff));
}

export function shiftsOverlap(first, second) {
  return new Date(first.start) < new Date(second.end) && new Date(first.end) > new Date(second.start);
}

export function qualificationCoverage(people = []) {
  return {
    firstAid: people.some((person) => Boolean(person?.qualifications?.firstAid)),
    level3: people.some((person) => Boolean(person?.qualifications?.level3)),
    eyfs: people.some((person) => Boolean(person?.qualifications?.eyfs)),
    manager: people.some((person) => Boolean(person?.qualifications?.manager)),
    dsl: people.some((person) => Boolean(person?.qualifications?.dsl)),
    sendco: people.some((person) => Boolean(person?.qualifications?.sendco)),
  };
}
