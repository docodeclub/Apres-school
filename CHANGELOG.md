# Changelog

## 2026-08-27 - Application-led employee onboarding

- Added an Admin onboarding wizard directly to each protected staff application for candidates who have already accepted the role and signed their contract.
- Added explicit signed-contract confirmation before an application can become an employee record.
- Carried application answers into onboarding as unverified declarations, while keeping identity, right-to-work, DBS, references and other safer-recruitment checks incomplete until evidence is reviewed.
- Added one-step creation of the new employee's staff login, staff record and SCR checklist, followed by the existing evidence and site-assurance journey.
- Added a branded onboarding email containing the secure staff login once the employee record is created.

## 2026-08-27 - Live staff application review

- Connected the Staff Onboarding review area to the protected `staff_applications` database records instead of the legacy browser-only list.
- Added full-application viewing, live reviewing, shortlisting and rejection decisions, Admin notes and clear loading/error states.
- Restricted application viewing and saved review decisions to active Admin and Superadmin accounts and recorded each decision in the audit log.

## 2026-08-26 - Employee holiday management

- Added a staff holiday workspace for allowance balances, full-day, part-day and custom-hour requests, and decision history.
- Added direct-report approval queues and a team leave calendar for Managers, with organisation-wide controls for Admin and Superadmin.
- Added Admin leave-year settings and employee entitlement records, including carry-forward and auditable adjustments.
- Connected approved holiday to the staffing planner so affected assignments are marked as requiring cover and restored if the leave is cancelled.
- Added separate paid-holiday payroll entries and a worked-hours/holiday-hours split in payroll views and exports.
- Added branded request and decision emails with secure links back to the Holiday area.
- Added database-enforced privacy so staff see only their own holiday and Managers see only their direct reports.
- Added the first two booking rules: Admin/Superadmin staff may request leave at any time, while Staff and Managers assigned to a school can only request dates wholly inside that school's published holiday windows.
- Added staff absence reporting alongside Holiday, with broad reason categories, direct-report visibility, rolling 12-month metrics and return-to-work closure.
- Connected reported absence to rota cover, automatically restoring or extending affected assignments when a record is cancelled or the actual return date is confirmed.
- Added branded absence emails to the relevant manager and Superadmin while keeping detailed health information out of email.

## 2026-08-26 - Employee expenses workflow

- Added a prominent staff-dashboard shortcut for submitting expenses.
- Added secure receipt upload and employee-owned claim history.
- Added manager approval for direct reports and Admin/Superadmin payroll processing.
- Added private receipt storage, status history and database-enforced role boundaries.
- Added backend-only maintenance permission for secure operational cleanup; browser roles remain unchanged.
- Restricted expense approval and denial to Superadmin, added per-employee claim totals and added a branded Superadmin submission email with a secure evidence-review link.
- Removed manager access to colleagues' expense claims and receipts; Managers retain access to their own claims only.
- Moved expense-notification queueing into the secure submission transaction so a saved claim cannot lose its Superadmin email when a browser closes, changes connection or is running an older page bundle.
- Added branded approval and denial emails to the employee, including the decision, claim details, reviewer note and a secure link to their own expense history.
- Added an Admin-only guided SCR and letter-of-assurance workflow with skippable sections, evidence-based completion, saved progress, PDF generation and an auditable submission record.

Notable changes to the Après School website and operations platform are recorded here. This file follows the principles of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The application is deployed continuously, so entries are grouped by production date rather than numbered releases.

## Unreleased

### Documentation

- Rebuilt the project README around the current production platform.
- Added a maintained architecture guide and project tree.
- Added this changelog for future production changes.

### Added

- A Ripley Court–only free-care pricing group, with a school-scoped complimentary-care rule.
- Restored Admin and Superadmin save permissions for pricing groups and their rules while retaining database role checks.
- Faster indexed register and finance-ledger queries, timeout-aware retries and protection against stale register requests replacing newer results.
- Clear unavailable states for finance totals when live data cannot load, preventing a database timeout from being presented as £0 income.
- Consistent register aliases for Ripley Court so saved site defaults match booking records regardless of their historic venue label.

- A guarded daily register reset for one selected school, including a clear warning and a complete audit snapshot of the attendance it replaces.
- Account-level default register sites for staff, with the saved school selected automatically on future register visits.
- A register care-type switch that keeps holiday camps and Early Drop-Off out of the normal Breakfast Club and After-school Club view.
- A branded, no-index confirmation page for migration-reminder opt-outs, reached through the existing signed unsubscribe link.
- Per-user unread support-ticket badges for parents and administrators, cleared only when that signed-in person opens the ticket.
- Private support-ticket attachments for families and administrators, with restricted storage, validated image/PDF uploads and short-lived download links.
- A secure Support Tickets area in the parent portal where signed-in families can raise requests, view their own conversation history, add follow-up messages and re-open closed tickets with a required explanation.
- Parent and helpdesk email notifications for portal ticket creation, follow-up and reopening, with secure deep links back to the relevant account or staff ticket.
- A time-limited, single-use re-opening form for support contacts who do not yet have a family account, replacing the previous one-click email mutation.
- Former-staff document-only accounts that retain secure access to the employee's own P45, previous payslips and HR files after operational access ends.
- A staff-leaver workflow that archives the employment record, applies the restricted access state and sends a professional access-change email.
- A restrictive database-wide former-staff guard so preserved manager or admin roles cannot expose operational records through older access rules.
- Admin CRM evidence showing whether each public enquiry was saved and whether its internal notification was sent, failed, queued or has no linked delivery log.
- Auditable duplicate, test and spam classifications for enquiry records without deleting the original submissions.
- Atomic public-enquiry fingerprinting so repeated or concurrent submissions within ten minutes resolve to one saved record and one internal notification.
- Descriptive in-paragraph links between school partnerships, wraparound care, holiday clubs, venue booking routes and relevant policies.
- Semantic responsive imagery on the Holiday Clubs page, with descriptive alt text, intrinsic dimensions, responsive sources and intentional loading priority.
- Build-time static generation of the complete content, navigation and footer for every indexable public page.
- SEO regression checks that require substantial pre-rendered copy, heading structure and full-site internal linking on every public route.
- First-visit consent for cookies and similar browser storage, with equally clear accept and reject choices.
- Granular privacy settings, six-month consent renewal and a permanent way to change or withdraw consent.
- Public information explaining necessary and optional browser storage, including confirmation that advertising and analytics cookies are not currently used.
- Fuller homepage Organization structured data with verified company identity, registered office and service information.
- Route-specific WebPage, ContactPage, CollectionPage and Service markup, plus BreadcrumbList data on every deeper indexable public page.

### Fixed

- Made the role dashboard the post-login landing page, pinned Dashboard in every staff/admin navigation and added the prominent live Registers shortcut to the Admin/Superadmin dashboard as well as the Staff dashboard.
- Restored a personal-only Pay area for Managers so they can open their own payslips without gaining access to any other employee's pay or documents.
- Updated staff-account service authentication so support-led password resets can securely deliver through the existing staff email workflow.
- Stopped the public contact and school-enquiry forms from showing success when the server did not accept the enquiry; failed submissions now retain the visitor's text and provide a retry route.
- Prevented rapid repeat clicks, lost-response retries and concurrent identical submissions from creating duplicate CRM rows or notification emails.
- Removed robots.txt blocks from HTML routes that already carry `noindex`, allowing crawlers to read and honour the directive while keeping `/api/` blocked.

## 2026-08-02

### Added

- Route-specific pre-JavaScript content for public pages so search crawlers can read meaningful headings and summaries.
- A crawlability regression check covering public routes, canonical metadata, internal links, `robots.txt` and `sitemap.xml`.

### Changed

- Staff registers now show each child’s full first and last name instead of shortening the row to their preferred first name.
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
