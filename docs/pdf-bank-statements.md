# PDF bank statement imports

Supports single-account GBP current-account bank statements, including downloaded and scanned PDFs. Limits: 5 MB, 10 pages, 200 transactions. Existing CSV support remains 2 MB / 500 rows. Password-protected, corrupt, multi-account, foreign-currency and credit-card documents are rejected. An image renamed to PDF is rejected by its contents. Standalone photo/JPG statements are not supported by this picker.

The user selects a PDF, sees disclosure that OpenAI will process it, then explicitly chooses Read PDF statement. The existing OPENAI_API_KEY server secret is reused. The authenticated parse-bank-statement Edge Function bounds the upload, validates PDF structure/page count, enforces a per-user quota, and asks for structured rows using the Responses API's input_file support. It requests store:false and never logs statement contents, uploads to public storage or writes financial records. This does not mean the provider has zero retention; applicable provider data controls still apply.

The user checks/corrects dates, descriptions, signed amounts and optional balances. When both balances are supplied, opening + all signed transactions must equal closing to the penny before review. Missing balances require explicit manual checking. Neither arithmetic nor a model's completeness flag proves that OCR is accurate. Every accepted transaction still requires row approval using the existing bank importer; salary, transfers and existing matches default to Skip. PDF and CSV share the same owner/account/date/description/direction/occurrence fingerprints and idempotent commit RPC. Keep the same account nickname for overlapping imports. Balances are never inserted as income or expenses.

The source PDF is processed but not retained in Earnavik's evidence storage. Keep the original. Saved records use the original filename in import history and support the existing undo safeguards.

Validation: mocked-provider tests cover exact-penny balance checks, malformed/oversized/over-page PDFs, auth/quota failures, incomplete responses and preview-only output. Phone browser tests cover explicit read consent, corrections, approval gates, CSV fallback, network retry and account-switch isolation. Rollback-only database fixtures verify cross-format duplicate suppression. A real bank PDF still needs end-to-end device testing; only screenshots were supplied during this change.

Deployment: apply supabase/schema/bank_pdf_limits.sql and deploy supabase/functions/parse-bank-statement with verify_jwt=false (the handler validates getUser itself, supporting current JWT keys). Publish the frontend build, which now includes bank-pdf-workspace.js. Until frontend publication is verified, do not describe PDF uploads as live.

Official references checked 21 October 2026:
- https://developers.openai.com/api/docs/guides/file-inputs
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://pdf-lib.js.org/docs/api/classes/pdfdocument
