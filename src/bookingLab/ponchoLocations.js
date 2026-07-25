export const PONCHOPAY_LOCATION_URNS = {
  "King's House School": "2801558",
  "Rosemead Preparatory School": "2824761",
  "Ripley Court": "IUcCfoT4",
  "Ripley Court School": "IUcCfoT4",
  "Shrewsbury House School": "IUYmDzCq",
  "Willington": "2764313",
  "Willington Prep": "2764313",
};

export const PONCHOPAY_LOCATION_PENDING = [];

export function ponchoLocationUrnForSite(site) {
  return PONCHOPAY_LOCATION_URNS[String(site || "").trim()] || "";
}

export function ponchoLocationStatusForSite(site) {
  const name = String(site || "").trim();
  if (PONCHOPAY_LOCATION_URNS[name]) return "configured";
  if (PONCHOPAY_LOCATION_PENDING.includes(name)) return "pending";
  return "not_required_or_unknown";
}
