# Phase 1 review — 11 September 2026

## Release status

Local implementation only. No deployment, database migration, real booking, financial adjustment or email was performed. A public-route smoke script made read-only requests to the public website; all interactive browser testing used synthetic local responses with external requests blocked. Production behaviour has not been certified by these checks.

## Implemented

- Recruitment declarations start unanswered and require explicit selections. The browser and submission function share the same allowed-answer validation. Missing, boolean and unknown responses fail; Needs discussion is accepted for human review, not automatic rejection.
- New applications store a server-generated response timestamp and question version alongside labelled answers, explicitly marked applicant/unverified. Existing recruitment-review permissions remain unchanged. No historical records are rewritten.
- Holiday CTA targets the visible venue list, with sticky-header offset. School assurance requests preserve School and Assurance pack through the contact form and submitted subject. The existing backend retains its website source attribution.
- Added Parent login / My bookings to the public navigation. Existing school/service URL handling and saved booking selection mechanisms are retained, not replaced.
- Replaced the large announcement modal with a dismissible inline notice. Cookie choices/settings are unchanged.
- Upcoming camp dates omit past dates, show the next holiday first, and put later holidays in an expandable section. Existing daily pricing, hours, early drop-off and saving remain; configured full-week amounts are displayed when present. Existing general food, packing and example-day content is reused without introducing visitor promises.
- Added public practical-information sections and support/cancellation routes. Existing school access descriptions remain. Added an explicit allowlisted venue-facts component for approved exact ages, address, arrival, collection and price summaries; blank content is not published.
- Moved the wraparound school/service/schedule panel immediately after the hero and removed a repeated descriptive flow section.
- Expanded payment and cancellation guidance without changing any financial or commercial logic. Deadlines remain those shown for the individual session, not a new hard-coded public promise.
- Added audience-specific privacy information links beside registration, recruitment and enquiry collection points. General privacy and cookie information are separate. Removed a future-tense GDPR claim; this is not a claim of legal compliance or a complete statutory privacy notice.

## Findings already addressed in existing code

- Public holiday dates, hours, prices, early drop-off and school eligibility descriptions existed. They were not missing features.
- Venue selection already survives the sign-in/account hydration path (public CTA contract: 22 passing checks). This phase does not replace that mechanism.
- Calendar/list booking management, individual child/session cancellation, credit adjustments, pricing-group quotes and payment reconciliation already have implementations. Do not commission duplicate systems on the basis of the public audit.
- Staff applications already use a protected review RPC with audited Admin/Superadmin decisions. The gap was explicit applicant answers and server validation, not a missing recruitment system.
- SCR assurance already has a persistent workflow, required completion steps and an existing PDF generator.

## Checks

Passed: production bundle build and static public-route generation; declaration behaviour tests; synthetic browser checks at 1440, 390 and 320px; explicit unanswered form validity and Needs discussion; keyboard focus; school/assurance context; simulated submission failure preserving input; camp anchor; expandable later holidays; contact/camp/wraparound horizontal overflow; first-visit announcement no longer a dialog.

Passed existing checks: staff application contract, booking contract, pricing groups (38), security contract, staffing, enquiry intake (21), public booking CTA (22), SCR assurance (14), holiday planner, PonchoPay contract (105), static checks, and public-route read-only smoke.

Visual review: home desktop, narrow contact and camp desktop screenshots inspected. Additional browser screenshots are in `output/audit-phase1/`. These are synthetic; they are not evidence of production dates or customer records.

Known test failure: `employee-documents-contract-check.mjs` expects a Manager navigation string containing `Documents, Pay, Sessions` in the unchanged `PlatformModule.jsx`. It fails that source assertion. Earlier permission/storage assertions pass. This is a test/implementation mismatch requiring investigation, not proof of an access leak, and was not changed in this phase.

Limitations: no deployed Edge Function test, live permission impersonation, payment-provider transaction or database concurrency rehearsal. Local Node runtime is 24.19.0 whereas the package declares Node 20–23; repeat CI using the supported release runtime. Existing large-bundle warnings remain.

## Content and approval required before release

Populate `src/publicServiceFacts.js`, keyed by existing venue title, only after approval:

1. Exact minimum/maximum ages and school-year eligibility for each camp, including Willington nursery starters and permitted start holidays.
2. Confirm each venue's children-from-other-schools policy; do not generalise between sites.
3. Full venue address and specific entrance, drop-off/collection arrangements, authorised collector requirements and a suitable operational contact.
4. Approved current wraparound block/time/standard-price summaries per school, with an owner/update process. The prototype's seed prices were deliberately not promoted into a second authoritative public price list. A future live public price projection should expose only approved session fields, not family discounts or personal records.
5. Venue-specific food restrictions and additional-support arrangements that differ from the existing general camp information.

### Privacy review draft — not a complete notice

The audience summaries describe the documented platform uses: family care/booking/attendance and payment administration, applicant review, and enquiry handling. Before publication as a full notice, the responsible owner must confirm the controller's legal identity/address; purposes and lawful bases per use; special-category/criminal-record processing conditions; current processors, recipients and international transfers; retention schedules and deletion exceptions; rights/request handling and regulator contact; and any automated decision-making/profiling. Use `docs/gdpr-retention-plan.md` as a planning input, not proof that retention jobs are deployed. Do not invent retention periods. Specialist approval is needed for the substantive recruitment question wording as well.

### Historic declarations

Older defaulted answers cannot be assumed to be deliberate declarations. Identify applications predating this release without a versioned response record in an authorised, read-only review. Ask the recruitment owner which applicants need fresh explicit responses. Record the new response separately with its time/version; retain original provenance and do not backdate or convert self-declarations into verified checks. No mass email or historical update is authorised by this implementation.

## Phase 2 assessment and prioritised scope (not implemented)

| Area | Existing evidence | Next verification/enhancement |
| --- | --- | --- |
| Public availability | `public_holiday_camp_schedule` already projects camp dates/prices; not a guaranteed remaining-place quote | Build an approved public wraparound projection; distinguish published capacity from current availability; never publish children/account data |
| Different children/sessions | BookingLab has child-session basket rows and individual cancellation | Synthetic two-child/different-day end-to-end assertions through reservation, receipt and register |
| Selective early drop-off | Separate blocks and `earlyDropOffContextForBookedRow` already exist | Exercise selected days only and amendments; no duplicate add-on system |
| Discounts | Authoritative family quote and pricing-group contracts already exist | Scenario matrix for each site, full-week/sibling/staff/VIP; approved precedence only, no new stacking rules |
| Cancellation/credit/reconciliation | Individual-session window migration 0142, spent-credit preservation 0173 and provider contract exist | Replay duplicate/out-of-order callbacks, partial cancellations, top-up settlement and retries in staging |
| Capacity/concurrency | Reservation migration 0030 takes per-block advisory transaction locks; confirmed-item synchronisation 0161 exists | Parallel final-place reservations and expiry/retry tests against an isolated database, not just source assertions |
| Staff clearance | Existing SCR and staffing qualification projection; helper coverage uses qualification booleans | Trace expiry and school-specific clearance at the session date across every publish/cover path; not established by this audit |
| Rota/cover | Staffing rules test overlapping shifts, minimum cover and qualification coverage; manager-scope migration 0095 | Prove server enforcement on publish and cover changes, with explainable blocked reasons |
| Actual hours/payroll | Existing hours entries contain actual_start/end/minutes; Hours UI and monthly reconciliation exist | Trace approval locks and export idempotency; external statutory payroll remains authoritative |
| Documents/assurance | Protected document functions/storage rules and existing assurance generator | Resolve the failing navigation contract; run role-based access and download tests with synthetic documents |
| Exceptions | CRM ownership and Ofsted gap owner/dueDate controls already exist | Verify durable shared ownership, escalation and deadlines before proposing a unified queue; local UI controls alone are not sufficient |

Verified Phase 1 defects are the default declarations/server gap, misleading public CTAs/context, intrusive announcement and presentation gaps above. Phase 2 items are test gaps or enhancement candidates unless separately reproduced. No new production booking or permission defect is claimed from this source review.

Recommended next batch: staging payment/credit/cancellation replay plus two-child reservation-to-register and concurrent-capacity tests; then date/site-specific workforce clearance and document role tests. These are higher consequence than further cosmetic changes.

## Review and deployment

Review the working-tree diff plus the newly added declaration helper, public facts module and two audit test scripts. The Vite local preview can be run with empty Supabase configuration to avoid using live data. Approve factual content and legal wording before publishing. Deploy the shared validation helper with `submit-staff-application` as well as the frontend: a frontend-only release would leave the server gap open. No migration is required for the nested version record. Keep existing RLS and review RPCs unchanged.
