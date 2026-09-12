// Only approved, non-personal venue information belongs here, keyed by bookingSites title.
// Empty fields are not published. See docs/public-journeys-release.md for release scope.
// Venue ages and signage guidance confirmed by the operator on 12 September 2026.
const signage = "Look for the Après School flag or signage.";
const facts = (ageEligibility) => ({ ageEligibility, arrival: signage, collection: signage });
const receptionToYearSix = "Reception (age 4) to Year 6 (age 11).";
export const approvedPublicServiceFacts = {
  "Willington Prep": facts("Ages 3–11."),
  "Holiday Camp at Willington Prep": facts("Nursery to Year 6."),
  "Ripley Court School": facts("Ages 3–11."),
  "Holiday Camp at Ripley Court School": facts("Ages 4–11."),
  "King's House School": facts(receptionToYearSix),
  "Holiday Camp at King's House School": facts(receptionToYearSix),
  "Shrewsbury House School": facts(receptionToYearSix),
  "Holiday Camp at Shrewsbury House School": facts(receptionToYearSix),
  "Holiday Camp at The Rowans School": facts(receptionToYearSix),
};
export function publicServiceFacts(title) {
  const source = approvedPublicServiceFacts[title] || {};
  return Object.fromEntries(["ageEligibility", "otherSchoolEligibility", "address", "arrival", "collection", "standardPrices"].map((key) => [key, typeof source[key] === "string" ? source[key].trim() : ""]));
}
