# Daily bookkeeping completion and reminders

Home now shows a daily check-in for today's UK calendar date. Income and expenses each count as checked when at least one saved ledger row exists for that date, or the user explicitly confirms no activity for that side. This is a daily habit prompt, not a reconciliation or a claim that every transaction has been entered.

A quiet-day confirmation is stored separately from financial records. It does not add £0 income or an expense, change profit or tax estimates, or count as spending. The two confirmations are combined atomically so two devices cannot overwrite each other's choices. They are owner-scoped under RLS, included in account-data exports and cascade when the account is deleted.

When both sides are complete, Home shows a tick and “Well done for keeping track. Small steps build strong habits.” A short optional chime can play once per owner/date on that browser. Sound is off by default and depends on browser audio support, permission/gesture and device settings. Reloading an already complete day is quiet. There are no monetary or redeemable reward points.

Skipping or closing an entry step is not a zero-activity confirmation. The daily forms have separate “No income/expenses for this day” buttons. Historical confirmations never complete today's status or trigger today's reward. Users can still add records after confirming a quiet day.

## Reminder behavior

Existing daily reminder opt-in, time and per-device settings are preserved. The scheduler checks saved completion before listing a candidate and again inside the claim. The worker rechecks immediately before handing the payload to the push provider and skips a complete day or any unconfirmed read. Existing per-device/day claims prevent duplicate scheduling; queries use Europe/London, including BST/GMT changes. Invoice reminders remain independent.

A notification already handed to a phone's push service cannot be guaranteed retractable. Once completion is confirmed in the open app, it attempts to close that browser's existing bookkeeping notification. Phone delivery may be delayed by the network or OS. iPhone push requires the installed Home Screen app and notification permission; reminders remain opt-in.

Deleting the only ledger row for one side reopens that side unless a separate quiet-day confirmation remains. That confirmation means the user explicitly reported no activity, and additional records can still be added.

## Verification

- `npm test`: 32 suites, including new browser-DOM/mocked-service cases and updated push worker checks.
- `tests/daily-completion-database.sql`: verified against the configured Supabase database with temporary fixture users/records/device claims inside a rolled-back transaction. Covers empty/partial/complete days, cross-owner isolation, deletion, atomic quiet-day confirmations, owner read/write RLS, completion suppression, duplicate claims, UK midnight and summer/winter reminder times. No real push sent; fixtures rolled back.
- Static build, JavaScript syntax and diff checks pass.
- Physical iPhone/Android sound and notification delivery are not verified by automated tests.

Deployment order: apply `supabase/schema/daily_bookkeeping_completion.sql`, deploy the updated `owner-invoice-push` Edge Function, then publish the app. No cron schedule or notification opt-in is changed.
