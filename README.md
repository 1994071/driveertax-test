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

## Weekly Dashboard and driver preferences

The Dashboard now defaults to Monday–today profit, with Today / Week / Month switches, the exact date range and a smaller today's recorded-profit figure. Month means month to date; detail views share these cutoffs. Calendar's Week preset still selects the full Monday–Sunday week. Sign-in lands on Dashboard instead of automatically covering it with Calendar.

Quick income/expense/receipt actions and Add past earnings sit above the optional weekly goal and review checklist. Profit includes allocated regular costs. Comparisons use the same elapsed weekdays last week, yesterday, or the same elapsed dates last month. Partial catch-up ranges suppress comparisons and goal celebrations, with an explanation and Calendar access. Goals use weekly profit before tax; progress is clamped to 0–100%, with no invented rewards or loss-of-streak messages.

Driver choices are saved in account-scoped localStorage (`drivertax-dashboard-v1:<user-id>`), not synced between devices. The form explains this. Goals can be removed, reminders are off by default and can be disabled, and storage failures are reported rather than presented as permanent saves. Review ticks are explicit driver acknowledgements, not automatic verification. They reset when the date or in-range records/costs change. Only the latest 12 weekly reviews are retained.

Optional app-open reminders show a dismissible, once-per-day banner at or after the driver's chosen UK time. There is no background push service. A downloadable daily .ics event with a display alarm and Europe/London daylight-saving rules is provided for the driver's calendar; importing and removing that event are managed by the calendar app separately. No external calendar is modified automatically.

Validation: `TZ=Europe/London node tests/weekly-dashboard-checks.cjs` (requires linkedom) covers Dashboard cutoffs, regular costs, fair comparisons, detail totals, goals, review invalidation, partial ranges, account separation, reminder time/dismissal/off, calendar structure, DST and unavailable storage. Existing tax, navigation, receipt, reconciliation and report checks pass. Actual calendar import/notifications remain device-dependent.

## Dashboard guided entry and emojis

Dashboard Add Income and the shift reminder's Add income action now call the same `startDailyEntry` flow as Calendar, using the current UK date. Income saves advance to expenses; the existing optional expense/mileage steps and skips are retained. Standalone expense entry and receipt scanning remain separate actions. Main Dashboard options use distinct decorative emojis beside their existing labels.

Validation: `TZ=Europe/London node tests/dashboard-daily-entry-checks.cjs` (linkedom) checks the actual Dashboard click handler, income save progression, date consistency and skipping expenses/mileage without extra saves. Weekly Dashboard regression checks also pass.

## Dashboard period tax reserve correction

Period reserve is now the difference between the tax estimate at the selected end date and the estimate with the selected range's recorded business profit removed. It uses the existing annual thresholds, other income and tax profile, and returns zero for a nonpositive selected profit. This replaces subtracting dated cumulative snapshots: when a multiweek catch-up summary ended this week, the old snapshots could attribute the whole summary's tax to this week even when its income was excluded from the weekly profit view. The full tax-year calculation remains separate and unchanged.

Dashboard explicitly labels tax reserve for today/this week/this month and shows the tax-year estimate separately. It does not assume an annual earnings forecast. Regression case: £30,000 past turnover in a summary ending 7 October plus £100 on 8 October produced £4,557.80 weekly reserve before; it now produces £26 weekly reserve and £74 estimated take-home, with the £4,557.80 tax-year estimate preserved.

Validation: `TZ=Europe/London node tests/dashboard-tax-reserve-checks.cjs` (linkedom) covers that ending-summary bug, full summary ranges, dated history, annual allowance crossing, PAYE income baseline, empty ranges and loss ranges. Existing tax/weekly Dashboard/reconciliation/sharing/daily-entry checks pass. 2026/27 ordinary Income Tax and Class 4 thresholds were rechecked against https://www.gov.uk/income-tax-rates and https://www.gov.uk/self-employed-national-insurance-rates.

## Driver invoices

Dashboard Create invoice / View invoices supports seller and customer details, service and issue dates, due dates, up to 20 priced line items, payment instructions and notes. Issuing creates an immutable unpaid snapshot and a unique per-driver invoice number. It does not send a message or add income. Cancel an unpaid invoice and issue a replacement to correct its details. This first version requires confirmation that the business is not VAT registered; VAT invoices, partial payments, credit notes and subscriptions are deferred. Required invoice fields follow https://www.gov.uk/invoicing-and-taking-payment-from-customers/invoices-what-they-must-include.

PDF download, native file sharing and manual WhatsApp attachment fallback are available. The invoice email button uses the existing authenticated email function. Actual delivery still requires RESEND_API_KEY and REPORT_FROM_EMAIL; missing configuration remains an explicit error, and mock provider tests are not evidence of delivered email.

Mark paid records the full payment on its received date. Drivers choose an exact amount/date existing income record or create a new one. An existing match blocks a duplicate new payment. A payment date covered by a catch-up summary requires a dated income record to be reviewed and linked first. Existing summary reconciliation reduces its unrecorded remainder when dated income is added. Paid income cannot be deleted or have its amount/date changed while linked to an invoice. Unpaid and cancelled invoices do not contribute to dashboard or tax income.

Applied migration: supabase/schema/invoices.sql. Tables use owner-only RLS. Security-invoker RPCs validate auth.uid(), compute rounded line totals on the server, serialize numbering/payment per driver and use request IDs for issuance retries. Paying an already-paid invoice returns the original income ID, so retries do not add another payment.

Validation: node tests/invoice-checks.cjs (linkedom and jspdf) covers totals, non-VAT confirmation, issuance payload, unpaid income exclusion, real PDF output, sharing fallback, existing-income selection, catch-up protection, escaped customer text and mocked email. tests/invoices-db.sql passed in a rolled-back authenticated transaction, covering canonical totals, numbering, request/payment retries, duplicate matches, reused-income rejection, cancellation, immutable issued details, linked-income protection and cross-driver isolation. Existing dashboard, tax, receipts, catch-up, report and email checks also pass.

## Invoice payment details, calendars and PDF layout

The invoice form now offers bank transfer, payment link, cash or other instructions. Bank transfer fields preserve leading zeroes and validate a six-digit sort code and eight-digit account number; names are searchable through common UK bank suggestions with free entry for other banks. Suggestions and number format validation are not bank/account verification. Payment links require HTTPS. Issued payment details remain in the existing immutable invoice snapshot, with no schema change. New invoices restore the last issued invoice's structured details; older free-text instructions are preserved unchanged. A driver can change the details before issuing.

Invoice, service, due and payment-received dates use the same calendar renderer as Calendar and Catch Up Records, with Monday-first cells, month navigation and activity dots. Calendar selection does not change the main calendar. Invoice and received dates disallow future dates, due dates cannot precede issue dates, and service dates can be future bookings. Due now / 7 / 14 / 30 day buttons calculate the due date from the invoice date.

PDFs now use a company banner, side-by-side customer/seller details, a description/quantity/unit-price/total table, payment details and the automatic invoice-number reference. Long descriptions, addresses, instructions and notes wrap across pages, with repeated table headers and numbered footers. Existing invoices also use this presentation when downloaded again; saved invoice details remain unchanged.

Validation: invoice-checks.cjs covers structured payment round trips, leading zeroes, malformed bank numbers, HTTPS links, legacy instructions, date terms/bounds, independent calendar navigation and real multi-page PDFs. Invoice, tax, dashboard, catch-up, receipts, sharing and email regression suites pass. Single-page and long PDF pages were rendered and visually checked. No payment provider connection or automatic payment collection has been added.

## Invoice Centre & VAT Foundations

Dashboard now places Invoice Centre directly after the profit card, with Create/View actions, outstanding totals (including archived invoices), due-today/overdue counts, drafts and a VAT link. These alerts appear while using the app; they are not background push notifications. Bank entry has an explicit Other bank action and separate missing-bank, holder, sort-code and account-number errors.

Drafts are stored separately in `invoice_drafts`, can hold incomplete details and future intended issue dates, and support save/reopen/edit/permanent deletion. They do not consume invoice numbers, add income or send emails. Revisions prevent stale-window overwrites. Issuance uses today's actual date, validates the complete payload, assigns the final number and removes the draft atomically. The draft UUID is also the invoice request ID: a lost-response retry recovers the same invoice. Future service and due dates remain available. Scheduled issuing/sending is not implemented.

Issued invoices support archive/restore, preserving their immutable snapshot, paid/unpaid state and income link. Archived unpaid invoices remain in outstanding totals, due alerts and VAT records. Paid invoices cannot be permanently deleted. Unpaid VAT cancellation creates an immutable full credit note; paid corrections, partial credits and partial payments remain outside this foundation.

Owner-only `vat_profiles` records declared UK VAT registration, effective date and standard/cash accounting. New VAT invoices snapshot number/method/tax point, support 20%, 5% and zero-rated lines and VAT-inclusive/exclusive price entry. The server rounds each line, derives net/VAT/gross totals and ignores client total fields. VAT invoice and credit-note PDFs include registration, tax point, line rates/net/VAT amounts, unit price excluding VAT and totals. Settings never rewrite issued invoices. Flat Rate, exemptions, reverse charge, imports, special schemes and HMRC/MTD submission are not supported; they must not be silently calculated with standard rules.

The VAT screen reports recorded output/input VAT for a chosen date range and exports formula-safe CSV. Standard sales use the invoice/tax point (service date when more than 14 days before issue), adjusted for an earlier full advance payment; cash sales enter on full payment. Standard cancellation records the original sale plus a separate full credit at cancellation date; unpaid cash cancellations have no output VAT. Archived entries remain included. Deposits/partial payments, special tax-point arrangements and VAT-scheme transitions require further work.

Purchase VAT is manually recorded against an owned, dated expense after the driver confirms eligible business use and valid VAT evidence. Ordinary UK VAT up to 20% is supported; vehicle/fuel/private-use claims are not inferred. Recorded expenses must already exclude private spending. Purchase links are unique, guard the original expense amount/date and use the snapshotted VAT scheme. Removing a purchase VAT record retains its expense. This screen is explicitly a **recorded VAT position**, not a complete VAT return: other earnings, regular costs, receipt scans and catch-up totals are not automatically VAT-classified.

Income/expenses retain original gross cash amounts in the database. Fetching adds `grossAmount`/`vatAmount` and presents accounting amounts after known output VAT/eligible input VAT. Payment matching and catch-up reconciliation compare gross amounts; profit/tax calculations use accounting amounts. Known VAT is therefore removed once even when a dated payment sits inside a reconciled whole-period summary. CSV detailed records include accounting amount, original cash amount and excluded VAT. Missing VAT classifications still require review, so no complete tax-accuracy claim is made.

Applied migration: `supabase/schema/invoice_centre_vat.sql`. The migration is additive and preserves existing issued amounts. Tables have owner-only RLS and explicit authenticated grants; RPCs are security invoker with an empty search path. Live rollback tests in `tests/invoice-centre-vat-db.sql` cover canonical mixed/inclusive VAT totals, invalid rates, registration requirements, draft dates/revisions/deletion/atomic retries, credits, archive/income preservation, expense guards and account isolation. `tests/invoice-centre-vat-checks.cjs` covers actual gross/net fetch transformation, catch-up arithmetic, cash/standard timing, credit entries, archived outstanding totals, gross payment matching, drafts, VAT/credit PDFs and CSV. Existing non-VAT/database, dashboard, tax, calendar, receipts, reports and email checks pass. Real PDF samples are rendered and visually inspected. The additional Playwright browser suite could not run in this environment because its browser download was unavailable; it is not claimed as passed. Email provider configuration remains deferred until a domain is available; no real email was sent during testing.

VAT rule references: https://www.gov.uk/vat-rates ; https://www.gov.uk/charge-reclaim-record-vat ; https://www.gov.uk/vat-record-keeping/vat-invoices ; https://www.gov.uk/vat-cash-accounting-scheme ; https://www.gov.uk/guidance/vat-guide-notice-700 .

## VAT Returns & Flat Rate

VAT Centre now supports ordinary UK VAT return preparation, including classification of dated sales/expenses, Flat Rate invoice/cash turnover methods, reviewed-period saving and PDF/CSV return exports with supporting records. There is no HMRC/MTD connection or submission. The Dashboard link opens VAT & return review.

Flat Rate settings record HMRC-authorised scheme start, the declared sector percentage and first-year discount eligibility. Transport/storage/couriers/taxis is offered at 10%; other current sector percentages can be selected using the linked HMRC rate table. The app does not apply to join the scheme, verify authorisation or choose a sector from the driver's job title. Ordinary VAT invoice rates remain 20%, 5% and zero rated; Flat Rate payable is calculated separately on VAT-inclusive turnover, including exempt/zero-rated business sales. Flat Rate cash turnover is distinct from ordinary Cash Accounting.

For each review period the driver declares and confirms relevant goods. The limited-cost test compares goods against 2% of Flat Rate turnover and the applicable proportion of £1,000. Full monthly/quarterly/annual periods derive that proportion; non-standard periods require a checked custom proportion. A boundary case exactly equal to 2% but below the period minimum is flagged for HMRC/accountant review instead of silently assigning a rate. The limited-cost rate is 16.5%. The declared eligible first-year reduction is one percentage point, ending before the VAT-registration anniversary, not the Flat Rate joining anniversary. Returns spanning its end date split turnover by effective rate. Sector-rate changes are snapshotted per invoice/classification. Imports/exports, reverse charge, NI/EU goods, partial exemption, fuel scale charges, supplier credit notes, partial payments, scheme transitions and previous-return corrections are outside the reviewed-return scope and require separate support/accountant review. The scope declaration must explicitly confirm they do not apply.

Owner-only `vat_classifications` links a single income or expense, captures its original cash amount/date and VAT tax point, and records VAT treatment, reclaim evidence and capital-goods/disposal declarations. The server verifies source ownership, snapshot freshness and registration, computes sales VAT and allowable purchase reclaim, and snapshots VAT settings. Existing VAT invoice payments and purchase claims cannot also be classified, in either write order. Ordinary Flat Rate purchases force reclaim to zero; the supported capital exception requires a declared single eligible capital-goods purchase of at least £2,000 inclusive and valid evidence. A disposal of goods whose VAT was reclaimed is calculated outside Flat Rate. Vehicle, hiring/private-use and special capital eligibility are not inferred. Source edits invalidate classification snapshots; original gross bookkeeping records are retained. VAT exclusions do not correct underlying income-tax bookkeeping such as wrongly recorded loans or private funds.

Return boxes are computed from source records: standard/cash sales VAT and eligible input VAT; Flat Rate VAT-inclusive turnover times the effective rate plus supported capital disposals; permitted capital input VAT; absolute box 5 with explicit pay/reclaim direction. Boxes 6–9 omit pence. Standard/cash box 7 excludes all VAT shown on a purchase, independently of the proportion reclaimable. Flat Rate box 6 uses VAT-inclusive Flat Rate turnover plus net supported capital disposals, and box 7 includes supported capital purchases only. Boxes 2/8/9 are zero only inside the confirmed ordinary UK scope.

Missing/stale classifications, unsupported transactions, mixed schemes, pre-registration periods, still-open periods and incomplete catch-up totals block saving a reviewed return. Catch-up summaries cannot supply individual VAT tax points: the driver must enter dated records and reconcile the aggregate. The complete-record declaration includes external and unpaid invoices for invoice-based methods; regular-cost allocations are not automatically turned into purchase VAT invoices. A zero liability is not treated as proof that records are complete.

`vat_return_reviews` stores only declared settings and a deterministic 64-bit source-change fingerprint, never client-supplied VAT totals. Every preview/export recomputes the boxes. Changed relevant records, invoice credits, classification settings or recurring/catch-up coverage mark a review as needing review again. Reviews cannot overlap, cannot cover future periods and cannot be saved without scope/record confirmation. The fingerprint is a change detector, not an authorisation mechanism; RLS enforces account ownership. Exports are labelled DRAFT or REVIEWED COPY and always NOT SUBMITTED.

Flat Rate accounting uses reviewed-period VAT allocations to retain the difference between customer VAT and Flat Rate payable in turnover. Without a valid reviewed period, known Flat Rate payments use an explicitly provisional limited-cost rate (including the declared eligible first-year reduction); the tax tab labels those estimates Provisional. Saving a current complete review refreshes the accounting figures. Ordinary Flat Rate costs retain irrecoverable VAT; eligible capital input VAT is separated. Review allocations are computed once per data refresh rather than recalculating every review for each income record. Dated gross values still drive invoice payment matching and catch-up reconciliation.

Applied migrations: `vat_returns_flat_rate`, `vat_returns_registration_tax_point_guard` and `vat_return_review_resave_guard`, from the canonical definitions in `supabase/schema/vat_returns_flat_rate.sql`. They add owner-only RLS tables and security-invoker guards, preserve existing issued invoices and prevent new VAT tax points before registration/Flat Rate start. All frontend invoice, VAT, tax, dashboard, calendar, receipts, catch-up, report and mocked email suites pass. New checks are `tests/vat-returns-flat-rate-checks.cjs` and `tests/vat-return-ui-checks.cjs`; they verify HMRC limited-cost examples, discount boundaries, cash timing, capital purchases/disposals, nine boxes, stale/missing/mixed/unsupported completeness, accounting allocation, review invalidation, gross UI payloads, save errors and formula-safe exports. Rolled-back authenticated `tests/vat-returns-flat-rate-db.sql` verifies server snapshots/arithmetic, ordinary reclaim exclusion, capital thresholds/evidence, duplicate-record guards, review overlap/confirmation/date checks and ownership isolation. Earlier invoice database suites also pass. PDF return and supporting-record pages were rendered and visually inspected. The additional Playwright suite remains unavailable because the browser download failed in this environment; it is not claimed as passed. No real email was sent.

Authoritative calculation references: [HMRC Flat Rate Notice 733](https://www.gov.uk/guidance/flat-rate-scheme-for-small-businesses-vat-notice-733--2), particularly sections 4, 6, 7.8 and 15; [sector rates](https://www.gov.uk/vat-flat-rate-scheme/how-much-you-pay); [VAT Return Notice 700/12](https://www.gov.uk/guidance/how-to-fill-in-and-submit-your-vat-return-vat-notice-70012), sections 3 and 4.1.
