# Paid API limits

Deploy `supabase/migrations/20261023_paid_api_limits.sql` **before** deploying the four changed Edge Functions. No provider secrets are stored in these tables. All quota access is service-role only; the caller ID comes from `auth.getUser`, never the request body. The function runs as invoker with an empty search path.

| Service | Per user/minute | Per user/UTC day | Whole app/minute | Whole app/UTC day |
| --- | ---: | ---: | ---: | ---: |
| Receipt scans (OpenAI) | 30 | 100 | 100 | 1,000 |
| PDF statements (OpenAI) | 3 | 10 | 10 | 100 |
| Reports/invoices (Resend) | 5 | 20 | 20 | 200 |
| Optional operator alerts (Resend) | 1 | 5 | 6 | 24 |

These are initial safety caps, not subscription entitlements. They are fixed UTC windows. All workers share Postgres counters; a policy-row lock serializes reservations for each service, so concurrent accounts cannot overrun its shared cap. All four counters are checked before any increment. Counters overwrite old buckets instead of accumulating history. User counters cascade on account deletion. Invalid/missing services, disabled services and missing users are denied. Errors or non-boolean RPC results never permit provider requests.

Authenticated customer endpoints return 429 when denied, 503 if quota verification is unavailable. The retry header is a minimum retry delay, not a guarantee of allowance: daily denial can persist until midnight UTC. Optional alert denial skips the email while preserving the health event; existing per-code hourly deduplication still applies. Attempts remain counted if later validation, provider delivery or model parsing fails; there are no automatic paid retries or refunds. Checks occur before the provider call and some file validation, conservatively counting those attempts too.

Operators can change caps or set `enabled=false` in the private `paid_api_limits` table without redeploying. This stops **new** calls for that service, not requests already sent. Keep all limits positive. Do not grant clients table/RPC access or accept a user-supplied quota identity.

There are no Anthropic, Gemini, Stripe or Plaid calls in this checkout. Uber has its separate authenticated per-user limiter. New paid integrations must register a service here and call the shared RPC before **each** billable attempt, including retries. `paid-api-coverage-checks` deliberately fails for a new remote endpoint until reviewed; this is a development check, not an automatic runtime firewall.

Validation: `npm test` exercises endpoint authentication, quota denial and quota outage with providers mocked. `tests/paid-api-limits.sql` runs rollback-only database assertions for minute/day user/global boundaries, resets, denied-request accounting, kill switch, RLS and client privileges. It does not make provider calls. Separate sessions have not been load-tested.

Request caps bound request counts, not exact currency spend, and do not replace provider account restrictions, subscription enforcement, key rotation, IP/edge DDoS controls or ongoing security review. Existing maximum output tokens and file/page limits remain in place.
