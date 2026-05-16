# notify-cover-move

Sends cover-move notifications when a staff member is moved to another site.

## Behaviour

- Requires an authenticated Supabase user.
- Allows `manager`, `admin` and `superadmin` profiles.
- Writes a `cover_moves` row.
- Sends three emails when `RESEND_API_KEY` is configured:
  - the staff member covering,
  - the person being covered,
  - the operations inbox.
- Writes an `audit_log` row.

## Required secrets

- `SUPABASE_URL`
- `APRES_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM`
- `OPERATIONS_NOTIFICATION_TO`
