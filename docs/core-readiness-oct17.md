# Core readiness review — 17 October 2026

## Baseline and findings
The live Netlify index matched the repository index blob `7d39160de7280c6f0bd812f3ec51f8baefa9a303` byte for byte before changes. No customer records were altered by this review.

Email status was checked again on 17 October: `configured:false`, `providerConfigured:false`, `senderConfigured:false`. Deployed email function version 4 matches the local source used by the mocked email tests. Authentication, recipient validation, missing configuration and provider rejection/acceptance tests pass. No real email was sent. Configuration and successful inbox delivery remain open.

Receipt review found that a single capture input could force the camera on some devices despite promising photo-library choice, and that HEIC was advertised without conversion. The scanner now has separate Take photo and Choose image inputs. Supported formats are JPG, PNG and WebP, up to 10 MB. Unsupported/empty images are rejected before upload, HEIC gets an explicit conversion instruction, input selection resets for retry, and storage suffixes follow MIME type. The backend rejects unsupported/empty stored images before an AI request. HEIC conversion is not implemented.

## Checks completed
- Calculation suites: bookkeeping-batch-checks, expense-tax-checks, tax-history-checks and 96 scottish-relief-checks passed.
- Receipt backend sanitisation/auth/ownership tests, now including unsupported and empty uploads without AI calls, passed.
- Browser suites: catchup-visibility, catchup-save, historical-catchup, bookkeeping-batch, tax-payment, expense-tax-browser and new receipt-upload-browser passed.
- Browser services were mocked: no real bank import, financial write, AI scan or email delivery is established by these checks.
- Browser tests used Chromium 153 with touch/mobile viewport emulation. Layout suites were rerun with compiled Tailwind 3.4.17 CSS; initial runs without the app utility CSS failed on pointer/layout placement. The styled runs passed.
- Reviewed screenshots of receipt allocation/evidence and tax-payment views for mobile layout.
- Main 2026/27 Personal Allowance, rUK/Scottish bands, Class 4 rates and student/postgraduate thresholds were checked against current official guidance linked below.
- Example: £16,000 PAYE pay plus £5,000 business profit (England; no other income, reliefs or loans) returns £1,000 additional business Income Tax reserve and no Class 4 on that £5,000. This is an incremental reserve, not the complete Self Assessment settlement.

## Still required
1. Choose and control a sending domain. Set up Resend, verify its DNS records, and configure server-side `RESEND_API_KEY` plus `REPORT_FROM_EMAIL` (keep secrets out of browser code and chat). A mailbox and transactional sending are separate services.
2. Verify real invoice PDF and tax PDF/CSV delivery, attachment opening, spam/bounce/failure handling; separately verify signup and reset emails.
3. Real iPhone Safari and Android Chrome camera/gallery acceptance, permission refusal, interrupted upload and repeat scanning. A browser emulator cannot certify hardware behavior.
4. A live AI scan with a representative non-sensitive receipt, then manual corrections, save, refresh, dashboard and evidence check. AI is fallible; preserve user review.
5. Independent accountant review. Historical 2025/26 estimates remain business-only; year-specific PAYE/reliefs, specialist cases and regular-cost accounting limits in the master checklist remain open.

## Phone acceptance steps
- Open Scan: choose Take photo, photograph a clear receipt, check every extracted field and confirm/save.
- Refresh: verify exactly one expense, the receipt evidence and matching dashboard totals.
- Upload the same image again: Cancel should add nothing. Save anyway should deliberately add one more expense.
- Repeat from Choose image. A raw HEIC should show the conversion instruction without uploading or charging for an AI scan.
- Interrupt a scan/save or deny camera permission; confirm the app remains usable and a retry does not silently duplicate records.

## Sources checked 17 October 2026
- https://www.gov.uk/income-tax-rates
- https://www.gov.uk/scottish-income-tax
- https://www.gov.uk/self-employed-national-insurance-rates
- https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027
- https://resend.com/docs/dashboard/domains/introduction

Master checklist: [launch-checklist.md](launch-checklist.md). Open items remain open; this review does not constitute independent tax, security or legal approval.
