import { hasSupabaseConfig, supabase } from "./supabaseClient.js";

export async function fetchSchoolBookingWindows(locationId, academicYear = "2026/27") {
  assertCalendarClient();
  if (!locationId) throw new Error("School location is required.");

  const { data, error } = await supabase
    .from("school_booking_windows")
    .select("id, location_id, academic_year, term_name, half_term_number, label, starts_on, ends_on, source_url, source_checked_on")
    .eq("location_id", locationId)
    .eq("academic_year", academicYear)
    .order("starts_on", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function fetchSchoolHolidayWindows(locationId, academicYear = "2026/27") {
  assertCalendarClient();
  if (!locationId) throw new Error("School location is required.");

  const { data, error } = await supabase
    .from("school_calendar_periods")
    .select("id, period_kind, term_name, label, starts_on, ends_on, camp_candidate, notes, source_url, source_checked_on")
    .eq("location_id", locationId)
    .eq("academic_year", academicYear)
    .in("period_kind", ["half_term_holiday", "seasonal_holiday"])
    .order("starts_on", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function fetchSchoolDateStatus(locationId, date) {
  assertCalendarClient();
  if (!locationId) throw new Error("School location is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) {
    throw new Error("Date must use YYYY-MM-DD format.");
  }

  const { data, error } = await supabase
    .from("school_booking_date_status")
    .select("location_id, academic_year, calendar_date, pupils_in_school, after_school_eligible, camp_candidate, period_kinds, labels")
    .eq("location_id", locationId)
    .eq("calendar_date", date)
    .maybeSingle();

  if (error) throw error;
  return data || {
    location_id: locationId,
    calendar_date: date,
    pupils_in_school: false,
    after_school_eligible: false,
    camp_candidate: false,
    period_kinds: [],
    labels: ["No approved school-calendar coverage"],
  };
}

function assertCalendarClient() {
  if (!hasSupabaseConfig || !supabase) {
    throw new Error("School calendar database is not configured.");
  }
}
