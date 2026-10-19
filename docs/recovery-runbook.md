# Recovery acceptance procedure

Prepared 19 October 2026. This is a procedure, not proof that backups or alerts are configured.

## Before public launch

1. In Supabase Database > Backups, record the actual plan, latest successful backup and retention. Free plans require an independently scheduled database export. Keep encrypted copies away from the production project; store credentials only in the chosen backup runner's secret store.
2. Back up the private Storage objects separately, including original receipt images/PDFs and avatars. A database dump or account JSON export does not include these binaries. Preserve bucket/object paths and an integrity manifest so restored metadata still points to the right files. Restrict backup access and agree retention before scheduling copies.
3. Restore a database copy and sample files into an isolated test environment, with outbound email/AI disabled and test-only credentials. Never use a live production restore as a drill. Check record counts, invoice totals, paid-income links, receipt hashes, two-account isolation and evidence access. Record duration and any unrecoverable interval. Remove the test copy securely afterwards.
4. Retain a known-good GitHub release and Netlify deploy. Reverting the frontend is separate from reverting a schema. Prefer forward database fixes; do not blindly roll back migrations containing user data.
5. Verify failure notifications reach the operator, then simulate a harmless outage against a test endpoint. Agree an acceptable detection interval and recovery time before promising availability.

## Monitoring added in this release

- `report-app-health` accepts authenticated fixed event codes only. It never accepts receipt text, monetary amounts, URLs, stack traces, passwords or arbitrary messages. Counters retain only the latest active day for each code/account; there is no complete historical incident log.
- Optional operator emails require an `APP_ALERT_EMAIL` secret pointing to a verified operator-controlled mailbox. Existing `RESEND_API_KEY` and `REPORT_FROM_EMAIL` are reused. Alerts contain only the event code. Global cooldown: at most one email attempt per code/hour. Delivery is best effort; failed sends are logged, not automatically retried. Configure and verify delivery before relying on alerts.
- Operational counters are service-only; ordinary app accounts cannot read or write them directly. Client reports are diagnostic signals, not proof of root cause. Sign-in failures before authentication and device crashes that cannot send a request are not covered.
- `.github/workflows/availability.yml` checks the public website and Auth health hourly and after relevant pushes. It does not prove receipt AI, database writes or email delivery. GitHub schedules may be delayed; confirm Actions is enabled, first run succeeds and workflow failure email notifications are enabled. Dedicated shorter-interval uptime monitoring remains an option before launch.

## Deletion request handling

The Profile button records a request, not an immediate account wipe. Operators must review open `account_deletion_requests`, verify identity, determine any required retention, respond to the user, and perform approved deletion across Auth, database, Storage and applicable processors. Mark processing/completion only from a trusted operator environment. Users can cancel while review has not begun. Do not promise full erasure until the procedure, retention and backups have been checked.

Official references checked 19 October 2026:
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/auth/password-security
- https://supabase.com/docs/reference/javascript/storage-updatebucket
- https://ico.org.uk/for-the-public/your-right-to-get-your-data-deleted/
- https://www.gov.uk/self-employed-records/how-long-to-keep-your-records
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
