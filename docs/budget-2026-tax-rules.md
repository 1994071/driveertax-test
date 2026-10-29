# Budget 2026 tax rules — reviewed 29 October 2026

The app now records the 28 October announcements as an immutable, pending 2027/28 ruleset in `index.html`. Current 2025/26 and 2026/27 estimates use explicit year-specific constants. Unsupported years are rejected instead of silently borrowing current-year rules. The Tax page has an Upcoming tax changes view with official links and a pending-legislation notice.

## Recorded changes

Effective 6 April 2027 (2027/28), pending legislation and final implementation review:

- Trading Allowance and trading reporting threshold: £1,000 to £3,000. This is an alternative to actual eligible expenses; never subtract both. The property allowance is separate and remains £1,000.
- Savings rates, UK-wide: previously planned 22/42/47% to 24/44/49%.
- Property rates: previously planned 22/42/47% to 24/44/49%, with regional/devolved decisions needing separate verification.
- Blind Person's Allowance: £3,250 to £3,370.
- Married Couple's Allowance: maximum £11,700 to £12,110; minimum £4,530 to £4,690; income limit £39,200 to £40,600. This is not Marriage Allowance.
- Qualifying Care Relief: annual £20,440 to £21,160; weekly under-11 £435 to £455; weekly older-child/adult £515 to £535.
- Pension Tax Allowance: a separate tax reduction for eligible people at State Pension age, lasting through 5 April 2030. Do not increase the standard Personal Allowance. HMRC publishes a £13,036.40 full new State Pension, rounded eligibility/withdrawal boundaries of £13,037/£13,319 and a £1-per-£3 withdrawal. Exact rounding and eligibility need legislation/software-specification review.

The standard Personal Allowance/taper and Marriage Allowance figures remain unchanged. Plan 1's announced £28,005 future threshold and Plan 2's £29,385 policy are recorded for reference only. The loan region/plan rules and unverified thresholds must be checked before enabling any 2027/28 calculation; unknown values remain null, not copied from 2026/27.

## Activation blockers — not implemented by this change

No 2027/28 forecast, reserve or export is enabled. A calendar rollover alone cannot approve a ruleset. Before activation:

1. Verify enactment and effective dates, final Scottish bands, Scottish/Welsh property rates, Class 4 parameters and every student/postgraduate threshold (including Welsh Plan 2 treatment).
2. Add tax-year-specific profile storage/selection. Current profile data is specific to the existing current-year workflow.
3. Add gross qualifying trading income, allowance eligibility and allowance-versus-expenses election. The present engine accepts already-computed business profit, so applying £3,000 to that profit would double-deduct expenses.
4. Add separate savings/dividend inputs and income ordering/relief allocation; use marginal band widths and Personal Allowance taper. Do not merely multiply all combined income by a new rate.
5. Add age/State Pension age eligibility for Pension Tax Allowance, exact rounding/withdrawal, and capped interactions with Marriage Allowance and other reductions. Add eligibility inputs for Married Couple's Allowance and Qualifying Care Relief where supported.
6. Verify Self Assessment annual loan assessment and PAYE deductions reconciliation, independent postgraduate calculations and all mixed-income interactions. Existing estimates are business-attributable reserves, not a complete HMRC return.
7. Make unsupported/future-year screens show an unavailable state before enabling automatic 2027/28 dashboard rollover. Then update dashboard reserve, take-home, share text, CSV and PDF from the same reviewed engine.
8. Add independent reference examples and boundaries for the above changes, the 5/6 April rollover and preserved historic years. Only then change the supported-year gate.

## Official sources

All Budget 2026 sources below were published 28 October 2026. HMRC says the main changes will be legislated in Finance Bill 2026–27; they are announcements, not production activation approval.

- https://www.gov.uk/government/publications/budget-2026-overview-of-tax-legislation-and-rates-ootlar/budget-2026-overview-of-tax-legislation-and-rates-ootlar
- https://www.gov.uk/government/publications/budget-2026-overview-of-tax-legislation-and-rates-ootlar/annex-a-rates-and-allowances
- https://www.gov.uk/government/publications/income-tax-increasing-the-trading-allowance/increasing-the-trading-allowance
- https://www.gov.uk/government/publications/pension-tax-allowance-explainer/pension-tax-allowance-explainer
- https://www.gov.uk/government/news/student-loans-interest-rates-and-repayment-threshold-announcement--7 (10 August 2026)

Validation: `node tests/tax-rule-versioning-checks.cjs`, existing tax reference/regression suites and the repository check runner. No database migration or production data change is required for this preparation.
