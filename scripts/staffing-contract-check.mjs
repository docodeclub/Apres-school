import assert from "node:assert/strict";
import fs from "node:fs";
import { calculatePaidShift, qualificationCoverage, requiredStaffCount, shiftsOverlap } from "../src/staffingRules.js";

const afterSchool = calculatePaidShift("2026-09-14T14:30:00.000Z", "2026-09-14T17:00:00.000Z");
assert.equal(afterSchool.start, "2026-09-14T14:15:00.000Z");
assert.equal(afterSchool.end, "2026-09-14T17:15:00.000Z");
assert.equal(afterSchool.paidMinutes, 180);

const breakfast = calculatePaidShift("2026-09-14T06:30:00.000Z", "2026-09-14T07:00:00.000Z");
assert.equal(breakfast.paidMinutes, 60);

const holidayCamp = calculatePaidShift("2026-08-03T07:30:00.000Z", "2026-08-03T16:30:00.000Z");
assert.equal(holidayCamp.paidMinutes, 570);

assert.equal(requiredStaffCount(0), 2);
assert.equal(requiredStaffCount(28, { minimumStaff: 2, childrenPerStaff: 8 }), 4);
assert.equal(requiredStaffCount(31, { minimumStaff: 2, childrenPerStaff: 8 }), 4);
assert.equal(shiftsOverlap({ start: "2026-09-14T14:15:00Z", end: "2026-09-14T18:15:00Z" }, { start: "2026-09-14T18:15:00Z", end: "2026-09-14T19:00:00Z" }), false);
assert.equal(shiftsOverlap({ start: "2026-09-14T14:15:00Z", end: "2026-09-14T18:15:00Z" }, { start: "2026-09-14T18:00:00Z", end: "2026-09-14T19:00:00Z" }), true);

const coverage = qualificationCoverage([{ qualifications: { firstAid: true, level3: true } }, { qualifications: { dsl: true } }]);
assert.equal(coverage.firstAid, true);
assert.equal(coverage.level3, true);
assert.equal(coverage.dsl, true);
assert.equal(coverage.sendco, false);

const migration = fs.readFileSync(new URL("../supabase/migrations/0094_staffing_system.sql", import.meta.url), "utf8");
assert.match(migration, /references public\.sessions\(id\)/);
assert.match(migration, /unique index if not exists hours_entries_staff_session_unique_idx/);
assert.match(migration, /staffing_save_assignment/);
assert.match(migration, /staffing_publish_rota/);
assert.doesNotMatch(migration, /create table if not exists public\.staffing_sessions/);

const scopeMigration = fs.readFileSync(new URL("../supabase/migrations/0095_staffing_manager_scope.sql", import.meta.url), "utf8");
assert.match(scopeMigration, /staffing_location_in_scope/);
assert.match(scopeMigration, /staffing_staff_in_scope/);
assert.match(scopeMigration, /revoke all on function public\.staffing_planner_for_range_unscoped/);
assert.match(scopeMigration, /assignment_snapshot/);

const availabilityMigration = fs.readFileSync(new URL("../supabase/migrations/0096_staffing_availability_submission.sql", import.meta.url), "utf8");
assert.match(availabilityMigration, /staffing_save_own_availability/);
assert.match(availabilityMigration, /staffing_availability_submitted/);

const notificationFunction = fs.readFileSync(new URL("../supabase/functions/notify-staffing-publication/index.ts", import.meta.url), "utf8");
assert.match(notificationFunction, /staffing_rota_publication/);
assert.match(notificationFunction, /Rota version/);
assert.match(notificationFunction, /acknowledge each shift/);

const moduleSource = fs.readFileSync(new URL("../src/StaffingModule.jsx", import.meta.url), "utf8");
for (const label of ["Today", "Planner", "Cover", "Hours", "Publish rota", "Copy previous week", "+ Add staff", "My weekly availability", "Working with:"]) assert.ok(moduleSource.includes(label), `Missing Staffing control: ${label}`);

console.log("Staffing contract checks passed.");
