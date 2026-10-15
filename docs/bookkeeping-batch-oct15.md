# Bookkeeping batch — 15 October 2026

This release separates this business's tax reserve from tax attributable to employment and other income. Annual taxable employment pay from all jobs uses the same allowance and bands. The reserve is the increase in Income Tax, Class 4 and estimated loan liability when adding this business's positive profit. Reported tax deductions are informational and are not subtracted from that marginal reserve again. It is not an HMRC settlement balance, payroll reconciliation or forecast of payments on account. Negative profits do not calculate loss relief. Class 1/Class 4 maximum adjustments and specialist cases remain unsupported.

Dashboard date double-taps and Edit buttons open an explicit income/expense chooser. Existing zero-amount edits retain independently recorded expenses.

Receipt items are JSON allocations on one expense, not duplicate ledger rows. Users can edit descriptions, choose/type categories and set business percentages/treatment. Server validation requires positive cent amounts summing to the original expense total. Category summaries use items; tax deductions use reviewed item amounts. Removing allocations returns the expense to review and allows ordinary amount editing. AI supplies suggested readable lines; all require review, and discrepancies/discounts must be reconciled before saving. Allocation editing is guarded by the loaded updated_at timestamp. Original receipt evidence remains attached. Item-level VAT is not implemented: claims/classifications on allocated expenses are blocked, and existing VAT classifications must be removed before splitting.

Meal help distinguishes personal food, overnight travel, occasional/itinerant journeys, entertaining, resale ingredients and staff meals. It never grants a blanket daily allowance. Personal/client entertaining suggestions are excluded; other cases remain review until the user checks eligibility. Guidance applies to Income Tax; VAT is separate.

CSV statement import: GBP only, explicit DD/MM/YYYY or ISO date format, signed amount OR debit/credit columns, 500 transactions / 2 MB limit. Handles quoted delimiters, escaped quotes and multiline descriptions. Review every row and explicitly approve business records. Recognised salary/payroll/transfer/refund/loan text and same-date/type/amount existing records default to Skip; detection is suggestive and cannot recognise every salary or duplicate. No business turnover is created from skipped rows. Categories are basic suggestions (fuel/parking), editable by users. Server transaction and idempotency prevent retry/overlap duplication using a stable account nickname, date, amount, description, direction and within-file occurrence. Identical real transactions and changed descriptions need manual review. Import does not reconcile statement balances and does not parse PDF. No original statement is uploaded; only approved records and import provenance are persisted. Undo checks exact snapshots and invoice/VAT/evidence links before deleting anything. Clear-selected-records includes import history; clearing underlying income/expenses removes the corresponding import snapshots.

Evidence folder: dashboard entry, month or UK tax year (6 April–5 April), search merchant/category/item, missing evidence filter, signed private links and attaching images/PDF to an existing expense without creating another expense. The date is the expense date, not upload date. CSV index excludes private storage paths and signed URLs and escapes formula-leading text. Original files can be opened individually; bundled evidence export is not included. Income, expense and receipt fetches paginate beyond the default 1,000-row response limit.

## Verification

- Existing Scottish relief tests: 96 checks, plus existing tax-history and expense-tax checks.
- New unit checks: business-only PAYE, higher-band crossings, allowance taper, Scotland, incremental loans, CSV parsing/validation, tax-year boundaries, mixed item deductions and safe CSV cells.
- Scanner edge function mock checks passed: item sanitisation, authenticated ownership checks and no AI call for unauthorised requests. A real paid AI scan was not exercised.
- Mobile Chromium at 390px with touch enabled: double-tap edit chooser, split total rejection, offline retention, meal helper, salary and duplicate default skipping, per-row approval and evidence filtering. Screenshots inspected.
- PostgreSQL tests run inside a rolled-back transaction with temporary accounts: item reconciliation, repeated/overlapping import idempotency, atomic undo, edited-record protection, evidence linkage without extra expenses and isolation between users. No real financial records deleted.
- The invoice test runner could not run because its optional linkedom dependency is absent; invoice code is not changed by this batch.

## HMRC sources checked 15 October 2026

- https://www.gov.uk/income-tax-rates
- https://www.gov.uk/self-employed-national-insurance-rates
- https://www.gov.uk/expenses-if-youre-self-employed/travel
- https://www.gov.uk/hmrc-internal-manuals/business-income-manual/bim47705
- https://www.gov.uk/expenses-if-youre-self-employed/marketing-entertainment-subscriptions
- https://www.gov.uk/expenses-if-youre-self-employed/reselling-goods

CIS, landlord/property, childcare and farming specialist calculations are not enabled by this release. Live bank connections still require provider onboarding. HMRC submission remains separate work.

Security advisor: no new database findings. Existing leaked-password protection remains disabled; enable before public launch: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
