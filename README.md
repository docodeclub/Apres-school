# Après School Website & Operations Platform

The production web platform for Après School. One React application provides the public website, family booking and account experience, and a protected role-based workspace for staff and administrators.

Production: [www.apres-school.co.uk](https://www.apres-school.co.uk/)

## Product areas

- Public website for wraparound care, holiday clubs, schools, policies, recruitment and enquiries.
- Family accounts for children, bookings, payments, invoices, account credit, messages and rewards.
- Booking system with school and session availability, pricing groups, ad-hoc bookings, cancellations and PonchoPay integration.
- Staff operations for registers, incidents, safeguarding, staffing, sessions and site oversight.
- People and compliance tools for users, HR, employee documents, SCR and Ofsted readiness.
- Finance tools for school invoicing, payments, pay, rewards and pricing-group performance.
- Communications, CRM, documents, audit and system settings.

## Technology

- React 18 and Vite 6
- Supabase Auth, Postgres, Row Level Security, Storage and Edge Functions
- Vercel hosting, rewrites, API routes and security headers
- PonchoPay checkout and webhook processing
- Resend-backed transactional email functions
- PDF generation for invoices, employee documents and operational exports

See [ARCHITECTURE.md](ARCHITECTURE.md) for the system design and project tree. Recent product changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## Local development

Requirements:

- Node.js 20–23
- npm or pnpm
- Supabase credentials for live data-backed functionality

Install and run:

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

Copy `.env.example` to an ignored local environment file and add only the variables required for the task. Never commit `.env.local`, production credentials, service-role keys, payment credentials or customer data.

## Important commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run build` | Build the production app |
| `npm run validate:static` | Check required files and public-data safety rules |
| `npm run check:seo` | Verify crawlable HTML, links, robots and sitemap output after a build |
| `npm run smoke` | Exercise the main public routes against a running local server |
| `npm run qa:launch` | Run public launch checks at desktop and mobile sizes |
| `npm run check:deploy` | Validate deployment configuration |
| `npm run check:deploy:strict` | Validate deployment with production environment requirements |
| `npm run check:booking-contract` | Check booking-system integration contracts |
| `npm run check:pricing-groups` | Check pricing-group and discount behaviour |
| `npm run check:staffing` | Check staffing-system contracts |
| `npm run check:employee-documents` | Check employee-document privacy and workflow contracts |

The complete command list is in [package.json](package.json).

## Build and deployment

`npm run build` creates the Vite bundle. The post-build step then:

1. Removes unused public image assets from `dist`.
2. Generates route-specific static HTML entry files and metadata.
3. Copies `robots.txt` and `sitemap.xml` into the deployed output.

[vercel.json](vercel.json) defines clean URLs, payment-return redirects, SPA rewrites and baseline security headers. Changes pushed to the production branch are deployed through the connected Vercel project.

Before publishing a material change:

```bash
npm run build
npm run validate:static
npm run check:seo
```

Run the relevant domain contract check as well.

## Supabase

Database changes live in [supabase/migrations](supabase/migrations) and must be additive, reviewable and safe for existing production data. Deployed server-side workflows live in [supabase/functions](supabase/functions).

Key principles:

- Parent, employee, safeguarding and finance records are protected by role-aware RLS and server-side checks.
- Booking prices are frozen on booking lines for audit and invoicing.
- Sensitive operations use Edge Functions or server API routes rather than trusting browser input.
- Production secrets stay in Vercel or Supabase environment settings—not the repository.

## Documentation

- [Architecture and project tree](ARCHITECTURE.md)
- [Tree-view shortcut](TREEVIEW.md)
- [Changelog](CHANGELOG.md)
- [Deployment checklist](docs/deployment-checklist.md)
- [Production booking launch runbook](docs/production-booking-launch-runbook.md)
- [Production Supabase runbook](docs/production-supabase-runbook.md)
- [PonchoPay live checklist](docs/ponchopay-live-checklist.md)
- [QA checklist](docs/qa-checklist.md)
- [Content checklist](docs/content-checklist.md)
- [GDPR retention plan](docs/gdpr-retention-plan.md)
- [Image privacy guidance](docs/image-privacy-guidance.md)
- [Supabase blueprint](docs/supabase-blueprint.md)

## Maintaining these docs

- Update `README.md` when setup, deployment or major product scope changes.
- Add user-visible, operational, security or data-model changes to `CHANGELOG.md`.
- Update `ARCHITECTURE.md` when modules, integrations, data boundaries or directory ownership changes.
