# Changelog

Notable changes to the Après School website and operations platform are recorded here. This file follows the principles of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The application is deployed continuously, so entries are grouped by production date rather than numbered releases.

## Unreleased

### Documentation

- Rebuilt the project README around the current production platform.
- Added a maintained architecture guide and project tree.
- Added this changelog for future production changes.

### Added

- Semantic responsive imagery on the Holiday Clubs page, with descriptive alt text, intrinsic dimensions, responsive sources and intentional loading priority.
- Build-time static generation of the complete content, navigation and footer for every indexable public page.
- SEO regression checks that require substantial pre-rendered copy, heading structure and full-site internal linking on every public route.
- First-visit consent for cookies and similar browser storage, with equally clear accept and reject choices.
- Granular privacy settings, six-month consent renewal and a permanent way to change or withdraw consent.
- Public information explaining necessary and optional browser storage, including confirmation that advertising and analytics cookies are not currently used.
- Fuller homepage Organization structured data with verified company identity, registered office and service information.
- Route-specific WebPage, ContactPage, CollectionPage and Service markup, plus BreadcrumbList data on every deeper indexable public page.

### Fixed

- Removed robots.txt blocks from HTML routes that already carry `noindex`, allowing crawlers to read and honour the directive while keeping `/api/` blocked.

## 2026-08-02

### Added

- Route-specific pre-JavaScript content for public pages so search crawlers can read meaningful headings and summaries.
- A crawlability regression check covering public routes, canonical metadata, internal links, `robots.txt` and `sitemap.xml`.

### Changed

- Converted primary public header and footer navigation to crawlable links while retaining SPA navigation.
- Rebuilt the sitemap around current indexable pages and removed obsolete booking-provider routes.
- Updated booking-system metadata to reflect the live family platform.

### Fixed

- Ensured `robots.txt` and `sitemap.xml` are included in the deployed build and return successfully in production.

## 2026-08-01

### Added

- Finance reporting for pricing-group customer spend, savings, standard value, active families and outstanding balances.
- Animated booking CTA border treatment on the public header and family account booking panel.
- Persistent “Ready to make a booking?” panel across all family-account sections.

### Changed

- Renamed the footer booking link to “Make a booking”.
- Reduced animation bleed so booking CTA colour remains confined to the border.
- Made the mobile booking-system announcement compact and kept its close control accessible.
- Improved the contrast and typography of the children’s rewards counter.

## 2026-07-31

### Changed

- Redesigned parent booking invoices to follow the professional Après School finance hierarchy and branding.
- Standardised invoice branding on “Après School”.

### Fixed

- Corrected tier-price checkout resolution when a site has multiple sessions on the same date.

## 2026-07-30

### Added

- Migrated-parent account-completion reminders and delivery progress reporting.
- Pricing-tier welcome emails, monitoring copies and eligibility wording.
- Pricing-tier support for staff-created ad-hoc bookings.

### Changed

- Routed public booking calls to action into the Après School family booking system.
- Made the holiday-clubs page evergreen and replaced the seasonal camp popup with the booking launch announcement.
- Clarified parent rewards and made sign-out more prominent.

### Fixed

- Confirmed fully discounted and zero-price bookings without requiring PonchoPay or a card guarantee.
- Restored all eligible schools in family booking choices.
- Enforced complete child profiles and explicit Yes/No permissions before checkout.
- Corrected live basket pricing, pricing-group quotes and account-credit balances.

## Earlier history

The repository predates this maintained changelog. Earlier implementation details remain available through Git history and the operational runbooks in [docs](docs).
