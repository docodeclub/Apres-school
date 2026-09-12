import assert from "node:assert/strict";
import { publicServiceFacts, approvedPublicServiceFacts } from "../src/publicServiceFacts.js";
assert.equal(Object.keys(approvedPublicServiceFacts).length, 9);
for (const title of ["Willington Prep", "Ripley Court School"]) {
  assert.equal(publicServiceFacts(title).ageEligibility, "Ages 3–11.");
  assert.equal(publicServiceFacts(`Holiday Camp at ${title}`).ageEligibility, title === "Willington Prep" ? "Nursery to Year 6." : "Ages 4–11.");
}
for (const title of ["King's House School", "Shrewsbury House School", "Holiday Camp at King's House School", "Holiday Camp at Shrewsbury House School", "Holiday Camp at The Rowans School"]) {
  assert.equal(publicServiceFacts(title).ageEligibility, "Reception (age 4) to Year 6 (age 11).");
}
for (const title of Object.keys(approvedPublicServiceFacts)) {
  const row = publicServiceFacts(title);
  assert.equal(row.arrival, "Look for the Après School flag or signage.");
  assert.equal(row.collection, row.arrival);
  assert.equal(row.address, "");
  assert.equal(row.standardPrices, "");
}
assert.ok(Object.values(publicServiceFacts("Unknown venue")).every(value => value === ""));
console.log("PASS: approved ages and signage for all nine existing venue cards; no invented address, price or new service.");
