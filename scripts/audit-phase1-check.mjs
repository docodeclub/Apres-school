import assert from "node:assert/strict";
import { applicationDeclarations, validateApplicationDeclarations, declarationRecord } from "../supabase/functions/_shared/application-declarations.js";
const valid = Object.fromEntries(Object.entries(applicationDeclarations).map(([key, question]) => [key, question.options[0]]));
valid.safeguardingStatement = "Confirmed";
assert.equal(validateApplicationDeclarations(valid), "");
for (const key of Object.keys(applicationDeclarations)) {
  for (const missing of [undefined, null, "", false, true, "Unrecognised"]) {
    assert.ok(validateApplicationDeclarations({ ...valid, [key]: missing }), `${key} must reject ${missing}`);
  }
  assert.equal(validateApplicationDeclarations({ ...valid, [key]: "Needs discussion" }), "");
}
assert.ok(validateApplicationDeclarations({}));
assert.ok(validateApplicationDeclarations(null));
assert.ok(validateApplicationDeclarations({ ...valid, safeguardingStatement: "" }));
const stamp = "2026-09-11T12:00:00.000Z";
const record = declarationRecord(valid, stamp);
assert.equal(record.respondedAt, stamp);
assert.equal(record.verified, false);
assert.equal(record.source, "applicant");
assert.ok(record.version);
assert.equal(record.responses.criminalDisclosure.answer, valid.criminalDisclosure);
console.log("PASS: explicit declarations, invalid/missing values, discussion route, versioned unverified record");
