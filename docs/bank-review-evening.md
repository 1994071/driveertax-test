# Bank statement review — paused for evening, 22 October 2026

Yohan approved the visual direction in IMG_2970.png, IMG_2971.png and IMG_2972.png, following IMG_2965–IMG_2968. The source images remain in the conversation. Do not copy screenshots with account details into the public repository.

## Requested result

- Full-page dark navy workspace, compact Earnavik header and separate Import PDF/CSV action.
- Statement card with actual account nickname, filename, date range, parsed payment count and grouped-merchant count.
- All / Income / Expenses / Check tabs with counts and retained selections.
- Merchant cards with coloured icons, combined totals, category dropdowns, dates and checkboxes.
- Repeated merchants such as Shell bundled visually, expandable to inspect or exclude individual dated payments.
- Select All Available plus a clear Save to Books action. Ambiguous, personal, salary/transfer/refund and duplicate candidates require individual review; bulk selection must not silently approve them.
- Preserve each original transaction date, owner isolation, exact-file and row duplicate checks, PDF balance/completeness guards and existing atomic save/undo.
- Keep upload limits/disclosure available without dominating the review. Compact loading/error/retry states.

## Accuracy requirements

The reference designs are visual inspiration. Do not copy unsupported claims such as HMRC Ready, HMRC Allowable or Bank Sync Ready. A platform bank payout is not proof of gross fares. Show selected business expenses, not total allowable tax deductions, unless the existing tax-review logic supports the claim. No invented balance, bank connection, dates or sample transactions in production.

## Current checkpoint

Branch: feature/bank-transactions-screen, based on main dea373a657505014837b6f9f1f9f38387be5ebb8 (PR53 merchant grouping).

Incomplete local draft: bank-workspace.css, a simplified upload shell in index.html, and the public asset build list. The referenced optional configureBankWorkspace hook and redesigned review controls are **not implemented**. No tests or deployment have been performed for this draft. Complete the JS integration, add phone/browser tests (320/390 px, filters, categories, safe bulk selection, original dates, errors, stale-account handling), visually inspect, then publish only when ready. Do not merge this checkpoint as a finished change.

User asked to pause and keep these designs for the evening. Resume with the user.
