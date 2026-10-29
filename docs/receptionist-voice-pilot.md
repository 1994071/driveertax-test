# Earnavik receptionist voice pilot

First implementation: Tools → Customers & work → Open receptionist pilot.

## Implemented

- Business name, services and service area; sample greeting.
- Offline scripted enquiry for checking the workflow without a voice account.
- A separate browser microphone test using OpenAI Realtime WebRTC. The server combines the browser SDP and server-owned session settings at `/v1/realtime/calls`; the standard API key never reaches the browser.
- Conversational AI instructed to disclose it is AI, ask one question at a time, collect name/number/enquiry/location/callback time and read back details for confirmation.
- `capture_enquiry` displays a draft only. Text uses DOM textContent. There are no database writes, calendar actions, calls, messages or invoices created.
- Verified Supabase user lookup on the server and an explicit tester ID allowlist. No service-role key. Disabled by default and no paid service provisioned by this change.
- Native request rate limit, bounded request body, no-store responses, server-side settings and generic upstream errors.
- Stop/close/account change/page exit/hidden tab release microphone tracks and close the peer connection. Late microphone permission results are released. Browser test timer ends after three minutes.
- Microphone Permissions-Policy is limited to the same origin; permission still requires a user gesture and browser approval.

## Activate a private test

Set these through Netlify environment variables with Functions scope and redeploy the pilot branch:

- `OPENAI_API_KEY`: project API key with Realtime access, stored securely through hosting settings, never in code or chat.
- `RECEPTIONIST_VOICE_ENABLED=true`
- `RECEPTIONIST_PILOT_USER_IDS`: comma-separated Supabase user IDs invited to test. Do not use emails or user-editable profile metadata.
- Optional `RECEPTIONIST_REALTIME_MODEL`: default `gpt-realtime-2.1`, matching the official WebRTC guide checked 29 October 2026. Confirm model availability and usage costs for the selected API project before testing.

No environment values have been configured or keys purchased by this change. No live API call has been made. The configured Supabase project and publishable key match the existing app. If the app changes project, update the server configuration alongside it.

The browser test sends microphone audio and the entered business profile to OpenAI while connected. Use fictional enquiry details. No audio is recorded by app code, and the draft is not persisted in Earnavik. This does not promise that a provider keeps no logs; review provider retention/settings before customer use.

The three-minute browser timer is a convenience, not a tamper-resistant provider spending cap. Keep the allowlist small and set provider usage controls before activation. Public rollout requires durable per-user quotas and server-side call lifecycle control.

## Verification and remaining work

`node tests/receptionist-checks.cjs` covers workflow rendering, HTML injection handling, no-config and unauthorized users, bounded payloads, session construction, generic errors, repeated start, delayed microphone cleanup, explicit stop and account-change clearing. All services are mocked. Full repository checks and static build also run.

Before claiming working live voice: configure an API project, deploy a private pilot, test real audio on mobile Safari and Chrome, interruption, denied microphone, blocked autoplay, network loss, summary accuracy, close/sign-out cleanup and service limits. A real browser microphone/provider test has not been performed in this environment.

Before answering real phone calls: connect a phone/SIP provider and number or forwarding, validate incoming webhooks and caller routing, store tenant-owned business profiles and enquiries with RLS, add reliable server-side tool handling and call termination, billing/quotas, business hours and escalation rules, and an enquiry inbox. Enquiry capture currently produces only an on-screen draft. No phone line, saved call history, SMS notifications or booking/calendar integration exists in this pilot.

## Official references

- https://developers.openai.com/api/docs/guides/voice-webrtc
- https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/create
- https://supabase.com/docs/reference/javascript/auth-getuser
- https://docs.netlify.com/build/functions/overview/
