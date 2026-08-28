import fs from "node:fs";

const checks = [
  ["src/PlatformModule.jsx", ["Holiday Camps planner", "upsertHolidayCamp", "Publish camp dates"]],
  ["src/BookingLab.jsx", ["fetchHolidayCampSchedule", "liveHolidayCampCatalog", "dayBlocks"]],
  ["src/app.jsx", ["fetchPublicHolidayCampSchedule", "Dates not yet published", "camp-site-schedule"]],
  ["src/bookingSystem.js", ["fetchAdminHolidayCampSchedule", "admin_upsert_holiday_camp"]],
  ["supabase/migrations/0132_holiday_camp_planner.sql", ["public_holiday_camp_schedule", "holiday_camp_planner", "Only admins can manage holiday camps"]],
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
