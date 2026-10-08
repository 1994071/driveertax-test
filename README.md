# DriverTax

UK driver income, expense, receipt, mileage and tax reserve tracker. Static `index.html` uses the existing Supabase project. Deploy through the existing GitHub/Netlify connection.

## October 2026 batch

Today Details, editable work preferences, Records category icons and filters, regular-cost controls, Calendar summaries and Dashboard / Records / Calendar / Scan / Tax navigation are included.

Regular-cost stop dates preserve past allocations. Costs are allocated through the stop date, inclusively, and historical stopped costs are loaded for calculations. The migration in `supabase/migrations/20261008_recurring_cost_history.sql` has been applied. Regular costs are estimated daily shares; editing an existing cost changes its saved allocation history. To preserve an old rate, stop it and add a new cost.

Tax summary defaults to records through today. The 2026/27 estimate uses annual thresholds, without annualising a short period's profit. £4,121 income minus £1,037 expenses, with no other income, gives £3,084 profit and zero Income Tax/Class 4 NI. Other tax-profile income can change the estimate. The estimate is not an HMRC submission.

## Report email

`supabase/functions/email-tax-report/index.ts` is deployed to the existing `email-tax-report` function with JWT verification enabled. It validates the signed-in user, supports a configuration-status action without sending, and returns provider acceptance only after the provider responds successfully.

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
