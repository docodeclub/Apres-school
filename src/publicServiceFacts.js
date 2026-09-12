// Only approved, non-personal venue information belongs here, keyed by bookingSites title.
// Empty fields are not published. See docs/public-journeys-release.md for release scope.
export const approvedPublicServiceFacts = {};
export function publicServiceFacts(title) {
  const source = approvedPublicServiceFacts[title] || {};
  return Object.fromEntries(["ageEligibility", "otherSchoolEligibility", "address", "arrival", "collection", "standardPrices"].map((key) => [key, typeof source[key] === "string" ? source[key].trim() : ""]));
}
