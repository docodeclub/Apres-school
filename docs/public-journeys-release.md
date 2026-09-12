# Public journeys release — 12 September 2026

Isolated from the payment audit branch and based on production main after the session display fixes. This release includes parent navigation, the inline booking notice, upcoming camp dates with expandable later weeks, existing camp practical information, earlier wraparound booking choices, payment/cancellation guidance, and school enquiry context preservation.

Excluded: recruitment declaration changes and their server handler, draft privacy summaries, unapproved venue facts, payment processor/cancellation database changes. No new venue facts were supplied; the approved facts map is empty. Existing recruitment and policy pages are unchanged. No customer records or notification sends are part of deployment.

Checks: production bundle and static route generation; synthetic browser tests at 1440/390/320 pixels with external requests blocked; visual review of homepage desktop and mobile contact page; 22 public booking CTA checks; per-child session value and payment-label regression checks. Existing large-bundle warnings remain. These checks do not certify the unfinished payment release or constitute a new numerical site score.

Next content work: approved venue ages, entrance/collection details and standard-price summaries. Recruitment/privacy drafts need their separate review. Re-score only after a fresh whole-site review against the original criteria.
