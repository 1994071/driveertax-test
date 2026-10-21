# Earnavik Uber driver connection

Scope: saved Taxi / Private Hire profiles (including users with additional trades). Food delivery, couriers and general driving profiles do not qualify merely because they use Uber. Former taxi users retain disconnect access. The server checks the saved profile independently of the UI.

## Operator activation

1. Register Earnavik with Uber at https://developer.uber.com/products/drivers and obtain written approval for UK driver data, the intended bookkeeping use and the required scopes. Creating an application alone is not approval.
2. Register exactly this redirect URI: `https://earnavik.com/?uber_callback=1`.
3. Obtain `partner.accounts` and `partner.payments` access. We do not request trip locations, riders, ratings or trip history.
4. In Supabase Edge Function secrets set `UBER_CLIENT_ID`, `UBER_CLIENT_SECRET` and `UBER_TOKEN_KEY` (a cryptographically random 32-byte value encoded as base64). Never send secrets in chat or commit them. Back up the encryption key securely: replacing it requires existing drivers to reconnect.
5. After approval and test credentials are ready, set `UBER_DRIVER_APPROVED=true`. Until all settings are present, Connect Uber stays disabled and explains the pending access.
6. Test with an authorised UK taxi account: allow/deny, expired/replayed callback, changing Earnavik accounts mid-flow, refresh, payments, disconnect, and revocation at Uber. Confirm token values never appear in responses or logs.
7. Verify the UK payment breakdown and tax treatment against actual statements before adding a reviewed import workflow. This release only previews up to 50 payment entries from the last seven days. It never writes income, expenses, VAT or tax reserves. The count explicitly discloses truncation; it is not a complete period report. Fleet-managed drivers may receive no payments from this endpoint.

## Security and lifecycle

`uber-driver` validates the Supabase session with getUser on every POST. The public gateway is configured with verify_jwt=false solely because authentication is performed inside the handler, supporting current Supabase signing keys. Origins are allowlisted; requests are bounded and rate limited. OAuth state is random, hashed, expires in ten minutes, bound to the signed-in user and the browser's sessionStorage, and atomically consumed. Only the latest connection attempt can finish. Callback codes are stripped before loading external assets; codes are not persisted. Access and refresh tokens are encrypted using AES-GCM with the owner's ID as authenticated additional data. Database tables have RLS enabled, no browser grants and service-role-only access. User deletion cascades both tables; exported account data must never contain OAuth tokens. No imported financial records exist in this release.

Refresh requests use a database lease to prevent concurrent refresh-token rotation. Disconnect deletes the local connection and pending state before calling Uber revocation. Failed remote revocation is reported honestly with manual removal instructions. A disconnected or superseded callback cannot restore the connection.

API sources checked 21 October 2026:
- https://developer.uber.com/docs/drivers/guides/authentication
- https://developer.uber.com/docs/drivers/references/api/v1/partners-payments-get
- https://developer.uber.com/docs/drivers/tutorials/api/best-practices

Live UK OAuth and provider data remain unverified until credentials/approval are supplied. Mocked tests cannot establish provider approval, coverage or data completeness.
