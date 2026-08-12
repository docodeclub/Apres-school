# notify-public-enquiry

Receives public website enquiries, writes them to the `enquiries` table and optionally sends an email notification using Resend.

Identical normalized submissions accepted within ten minutes resolve to the original enquiry. Acceptance is serialized in Postgres so concurrent double-clicks create one record and one notification. The endpoint returns `duplicate: true` when it safely recovers the existing submission.

## Required Secrets

Supabase provides these automatically inside Edge Functions:

- `SUPABASE_URL`
- `APRES_SERVICE_ROLE_KEY`

Set these manually:

```bash
supabase secrets set ENQUIRY_NOTIFICATION_TO=hello@apres-school.co.uk
supabase secrets set RESEND_API_KEY=...
supabase secrets set RESEND_FROM="Après School <hello@apres-school.co.uk>"
```

If `RESEND_API_KEY` is not set, the function will still save enquiries but skip email notification.
That state is recorded as `queued_without_provider` and appears as queued evidence in the admin CRM.

Deploy with:

```bash
supabase functions deploy notify-public-enquiry --no-verify-jwt
```

This endpoint is intentionally public because website visitors are not signed in. Database writes still use the server-side `APRES_SERVICE_ROLE_KEY`.
