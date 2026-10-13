# Clear selected records

Entry: account/profile → Clear selected records / start fresh.

No default selection. Preview counts come from the authenticated account. Users choose income, expenses plus receipts, receipt images only, mileage, invoices/credits, drafts, catch-up totals, regular costs or tax reserves. A second review and exact DELETE confirmation are required. Selection changes invalidate confirmation.

Dependencies: paid invoice links require selecting invoices before income; retained catch-up totals block clearing income/expenses/mileage. Expense deletion includes purchase VAT and receipts; FK cascades remove related VAT classifications. Financial changes invalidate saved VAT return reviews. Deleting invoices alone keeps recorded paid income, as stated in the preview. Login/profile, custom categories, tax/VAT settings and invoice counters remain.

Security: all functions are SECURITY INVOKER with an empty search_path, explicit auth.uid ownership filters and authenticated-only execute. Existing RLS remains enforced. Table names are fixed whitelists. The deletion function locks a snapshot of the owner's records and rejects a changed snapshot; deletes are restricted to snapshot IDs, so later inserts are not swept up. Database deletion is transactional.

Receipt storage: file paths are placed in an owner-protected cleanup queue in the same transaction as record removal. The client removes private receipt objects through Storage API, then removes successful queue entries. Failed/uncertain cleanup leaves durable entries and a visible retry action. No direct SQL deletion from storage.objects. This feature does not recall customer copies or withdraw previously submitted tax information.

Verification: clear-records-db.sql uses two temporary auth accounts inside a rolled-back transaction. It checks selection isolation, no cross-account effects, stale-preview rejection, exact confirmation, invalid choices, receipt-only preservation, cleanup queue isolation, VAT purchase dependencies, paid-invoice and catch-up guards, retained VAT settings and invoice counters, drafts/regular costs/reserve removal. Browser checks cover no defaults, dependency explanations, review/confirmation, duplicate submits, stale errors and storage retry. Mobile layout inspected at 390px.

No real account records were cleared during implementation.
