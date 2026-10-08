# DriverTax

UK driver income, expense, receipt, mileage and tax reserve tracker. Static `index.html` uses the existing Supabase project. Deploy through the existing GitHub/Netlify connection.

## October 2026 batch

Today Details, editable work preferences, Records category icons and filters, regular-cost controls, Calendar summaries and Dashboard / Records / Calendar / Scan / Tax navigation are included.

Regular-cost stop dates preserve past allocations. Costs are allocated through the stop date, inclusively, and historical stopped costs are loaded for calculations. The migration in `supabase/migrations/20261008_recurring_cost_history.sql` has been applied. Regular costs are estimated daily shares; editing an existing cost changes its saved allocation history. To preserve an old rate, stop it and add a new cost.

Tax summary defaults to records through today. The 2026/27 estimate uses annual thresholds, without annualising a short period's profit. £4,121 income minus £1,037 expenses, with no other income, gives £3,084 profit and zero Income Tax/Class 4 NI. Other tax-profile income can change the estimate. The estimate is not an HMRC submission.

## Report email

`supabase/functions/email-tax-report/index.ts` is deployed to the existing `email-tax-report` function with gateway JWT verification disabled and explicit auth.getUser(token) verification for every send request. Its public status action exposes configuration booleans only, supports checking readiness without sending, and returns provider acceptance only after the provider responds successfully.

Supabase Edge Function secrets required: `RESEND_API_KEY` and `REPORT_FROM_EMAIL` (a sender approved by the provider). Do not place provider secrets in `index.html`. The sharing screen checks readiness and displays the backend's error message. End-to-end email delivery has not been verified in this batch; no real test email was sent.

## Checks

Run with Node.js:

```
TZ=Europe/London node tests/tax-history-checks.cjs
node tests/email-checks.cjs
```

The optional `tests/batch-checks.cjs` exercises the UI with Playwright. It needs Playwright and an installed Chromium browser. Browser execution was unavailable in the build environment, so visual verification remains outstanding.

Tax source references: https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027, https://www.gov.uk/self-employed-national-insurance-rates, https://www.gov.uk/marriage-allowance.

## Duplicate receipt warnings

The scanner warns for an identical file (SHA-256 fingerprint), or an existing expense with matching merchant, date and total. Both warnings offer **Cancel** and **Save anyway**. A fresh database check runs on confirmation. Saving anyway is tied to the current receipt details; changed details require a fresh acknowledgement when still matching.

The `save_scanned_receipt` RPC respects RLS, serializes identical-file saves per driver, inserts both records atomically, and uses a save request ID so retries return the same expense. Its schema SQL in `supabase/schema/receipt_duplicates.sql` has been applied. Legacy receipt files have no fingerprint; matching details still produce a warning. A retaken photograph is detected through matching details rather than a file hash, so OCR mistakes can affect detection.

Receipt DOM tests require `linkedom`: `node tests/receipt-duplicate-checks.cjs`. Database checks ran inside a rolled-back transaction and covered warning enforcement, explicit duplicate override, retry safety, and file-owner validation.

## Navigation and week selection

Bottom navigation is Dashboard / Calendar / Scan / Tax. Records remains accessible through Dashboard's View All link, with a Back to Dashboard control; receipt saves return to Dashboard. Calendar Week and dashboard This Week share Monday–Sunday bounds, including weeks spanning a month or year boundary. On 8 October 2026 the range is 5–11 October, replacing the former Calendar 8–14 monthly block.

## Catch Up Records: whole-period summaries

Select dates, enter turnover, then choose known expenses or known profit. Expenses/profit are derived automatically; negative profits are supported. A required regular-cost choice controls whether allocated recurring costs are deducted separately. Mileage, statement source and notes are optional. The live review displays business profit before tax. Saved summaries have an Edit Summary control and appear in CSV exports.

The `save_period_summary` RPC validates and derives totals, restricts entries to completed dates within one tax year, and prevents overlap with existing summaries. Legacy callers still reject dated overlap; the reviewed reconciliation flow allows dated records. Driver access uses auth.uid() and existing RLS policies. `supabase/schema/period_summaries.sql` has been applied. Period totals are counted only when the selected range contains the entire summary; partial selections link to the full summary instead of inventing daily income.

Verification: `node tests/period-summary-checks.cjs` (requires linkedom), plus existing regression checks. Rolled-back database fixtures verified derived expenses, editing, overlap rejection and tax-year boundary validation.

## Dashboard past earnings and reconciliation

Dashboard **Add past earnings** opens the picker directly, defaulting to the last completed Monday–Sunday week. `get_period_record_totals` returns the signed-in driver's existing totals and a record fingerprint. The form compares those amounts with the entered whole-period totals and requires acknowledgement when dated records exist. Saves reject a changed fingerprint or totals below existing records. Individual records and receipts are preserved.

Reconciled summaries store whole-period totals, not extra transactions. Calculations add only the unrecorded remainder independently for income, expenses and mileage. Later dated receipts reduce that remainder; if records exceed a declared total, actual recorded amounts are retained and Dashboard/Calendar show a review warning. Regular costs already included in a summary are excluded for covered days. Partial ranges contain actual dated records only; unrecorded totals are not spread across days. Business losses display as losses, while tax uses nonnegative business profit without automatic loss relief.

Applied database change: `supabase/schema/period_reconciliation.sql`. Old `period_summaries.sql` documents the previous migration; do not reapply it after reconciliation.

## PDF, CSV and WhatsApp

PDF reports include whole-period and unrecorded catch-up amounts. CSV category/source totals include only unrecorded remainders plus daily records and separate regular costs; summary rows explicitly distinguish whole-period totals. CSVs use a UTF-8 BOM and escape spreadsheet formula text. Both exports stop at the same date as the tax estimate.

Supported browsers open the device's file share sheet: choose WhatsApp and then the recipient. If file sharing is unavailable or denied, the app offers individual download buttons and an Open WhatsApp link; drivers attach the downloaded files themselves. Cancelling a share is handled as cancellation. Selecting PDF + CSV for download offers separate buttons to avoid blocked multiple downloads.

Verified live email status on 8 October 2026: providerConfigured=false, senderConfigured=false. Email delivery is blocked until the owner adds RESEND_API_KEY and REPORT_FROM_EMAIL in Supabase Edge Function Secrets. Use a provider-approved sender; provider acceptance is shown as accepted for sending, not confirmed inbox delivery. No real email was sent during tests.

Additional validation (linkedom and jspdf@2.5.1 required): `node tests/reconciliation-sharing-checks.cjs`. It generates a real PDF and checks reconciliation amounts in CSV, later receipts, loss display, native share payloads, cancellation and download fallback. `tests/period-reconciliation-db.sql` runs authenticated ownership, preservation, lower-total rejection, stale-review rejection and edit checks inside a rolled-back transaction. Existing regression tests pass. Actual device WhatsApp handoff and inbox delivery remain user-device/provider checks.
