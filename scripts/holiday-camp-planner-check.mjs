import fs from "node:fs";

const checks = [
  ["src/PlatformModule.jsx", ["Holiday Camps planner", "upsertHolidayCamp", "Publish camp dates"]],
  ["src/BookingLab.jsx", ["fetchHolidayCampSchedule", "liveHolidayCampCatalog", "dayBlocks", "Full Week Discount", "Early Drop-Off", "holidayCampYearRange", "Willington Prep\" ? \"Nursery"]],
  ["src/app.jsx", ["fetchPublicHolidayCampSchedule", "Dates not yet published", "camp-site-schedule"]],
  ["src/bookingSystem.js", ["fetchAdminHolidayCampSchedule", "admin_upsert_holiday_camp"]],
  ["supabase/migrations/0132_holiday_camp_planner.sql", ["public_holiday_camp_schedule", "holiday_camp_planner", "Only admins can manage holiday camps"]],
  ["supabase/migrations/0133_willington_holiday_camp_pricing.sql", ["fullWeek4Price", "fullWeek5Price", "Early Drop-Off", "Full Week Discount", "holiday_camp_week_context"]],
  ["supabase/migrations/0135_holiday_camp_early_dropoff_dependency.sql", ["Early Drop-Off can only be added", "deferrable initially deferred", "Holiday Camp"]],
  ["supabase/migrations/0141_willington_nursery_holiday_eligibility.sql", ["Nursery to Year 6", "Reception to Year 6", "enforce_holiday_camp_session_year_range"]],
  ["supabase/functions/create-parent-booking/index.ts", ["CHILD_HOLIDAY_YEAR_INELIGIBLE", "Holiday Camp at ${site || \"this venue\"} accepts ${minYear} to ${maxYear}"]],
];

const failures = [];
for (const [file, needles] of checks) {
  const source = fs.readFileSync(file, "utf8");
  for (const needle of needles) {
    if (!source.includes(needle)) failures.push(`${file} is missing ${needle}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Holiday camp planner contract passed");
