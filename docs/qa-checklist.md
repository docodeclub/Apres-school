# QA Checklist

## Public Website

- Homepage first fold renders with real imagery.
- Header navigation works on desktop.
- Mobile menu opens and closes.
- Mobile sticky CTA is hidden on homepage and visible on secondary pages.
- Booking cards show correct platform and site notes.
- Homepage club finder routes each selected school/camp to Magicbooking or Pebble.
- External booking links open in a new tab.
- Policies, booking guides, payment and cancellation guide pages load from direct URLs.
- Contact form calls the Supabase enquiry function when configured, with local fallback for development.
- School enquiry form calls the Supabase enquiry function when configured, with local fallback for development.
- Staff Login is subtle on public pages and local demo access is unavailable in production builds.

## Responsive

- No horizontal overflow at 390px.
- No text overlaps buttons or cards.
- Booking filters scroll horizontally on small screens.
- Header keeps Book Now as the primary mobile action.
- Footer remains readable above the mobile CTA.

## Sensitive Data

- No real staff names in bundled demo data.
- No public safeguarding issue counts.
- No DBS, payroll, evidence or incident details exposed outside the login route.
- Outreach lead data loads only inside the protected CRM area.
