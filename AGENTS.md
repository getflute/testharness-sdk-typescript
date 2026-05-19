<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file
structure may all differ from your training data. Read the relevant
guide in `node_modules/next/dist/docs/` before writing any code. Heed
deprecation notices.
<!-- END:nextjs-agent-rules -->

# Flute SDK Test Harness — Agent Guide

A visual test harness for [`@getflute/sdk`](https://www.npmjs.com/package/@getflute/sdk).
Built for QA, used in a browser.

## Mental model

- The page is a Server Component (`app/page.tsx`) that reads
  `process.env.FLUTE_*` and passes a redacted snapshot to the client.
- The client component (`app/_components/Harness.tsx`) renders the
  sidebar, form, and response viewer from a single catalog.
- All SDK calls go through one Server Action (`app/actions.ts`,
  function `runEndpoint`). It instantiates a `Flute` client,
  dispatches to the right method, and returns a serialised result.
- The `clientSecret` never crosses the Server / Client boundary.
  Don't import `@/lib/flute` from a `'use client'` file.

## Source of truth

`lib/endpoints.ts` declares every endpoint the harness exposes. The
sidebar, form, and dispatch are all driven from this file.

To add a new endpoint:

1. Append an `EndpointSpec` to `ENDPOINTS` with `implemented: true`,
   the field shape, and any caveats.
2. Add a `case '<id>':` in the `dispatch` switch in `app/actions.ts`.
3. Do not edit the UI — the sidebar and form pick up the new entry
   automatically.

## SDK contract reminders (apply here too)

These are inherited from `@getflute/sdk@^0.2.0` and were validated
against live UAT by `scripts/probe.mjs` and
`scripts/probe-mutating.mjs`:

- `transactions.calculateAmount` requires `currencyCode` even though
  the spec marks it optional. The harness sends `'USD'` by default to
  avoid the 500.
- `StoredToken.expiresAt` is a UNIX **millisecond** timestamp.
- Webhook verification reads `Flute-Webhook-{Signature,ID,Timestamp}`
  and the **raw** request body. Never re-stringify JSON before
  passing it in.
- `paymentSessions.create` returns more than the SDK types declare.
  The runtime response contains `id`, `checkoutUrl`, and
  `checkoutUrlShort`; only `id` is in `CreatePaymentSessionResponse`.
  The harness reads the extra fields straight off the runtime
  object — do **not** add a stricter type that would erase them.
- `transactions.{sale,authorize}` fail with HTTP 400 + body
  `{"Details":"No active Card processor found for merchant"}` when
  the merchant has no payment processors. Surface
  `error.payload.Details` to the user — it's the most useful field.
- `FluteApiError` exposes `httpStatus` (NOT `statusCode`) and
  `correlationId`. Backend error code lives in `payload.ErrorCode`
  (e.g. `V0000`). The harness's `serializeError` reads both.
- `transactions.sale` / `authorize` always return HTTP 200 — even on
  a processor decline. Inspect `transactionStatus` (`"Approved"` /
  `"Declined"` / `"Failed"`) and `processorResponse.responseCode` to
  know what actually happened. The harness shows the full envelope
  so QA can read both.
- TSYS sandbox accepts **`4012000098765439` with CVV `999`** as the
  canonical approve PAN. `4111111111111111` is rejected by TSYS
  (it's only honored by the internal sandbox-card processor). The
  harness auto-defaults to the right preset by inspecting
  `availablePaymentProcessors[].type`.

If any of these change, also update the SDK's `AGENTS.md` so both
docs stay in sync.

## Common intents → code locations

| If the user asks…                | Edit                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| "Add endpoint X"                 | `lib/endpoints.ts` (catalog) + `app/actions.ts` (dispatch)                                                           |
| "Show response status code"      | `app/_components/Harness.tsx`, `ResponsePanel`                                                                       |
| "Add a credentials override UI"  | New form in `Harness.tsx` + a server action that re-creates the client with override values; do **not** persist any. |
| "Run mutating endpoints"         | Already wired (`sale`, `authorize`, `capture`, `void`, `refund`, `paymentSessions.create`/`cancel`).                 |
| "Save and replay calls"          | Persist `runId → result` to `localStorage` in `Harness.tsx`. Server side does not need changes.                      |
| "Light / dark mode toggle"       | shadcn supports it via `next-themes`; wire `<ThemeProvider>` in `app/layout.tsx`.                                    |

## Things to avoid

- Don't import the SDK from a Client Component. Use Server Actions.
- Don't log the `clientSecret`, the access token, or full request
  payloads with PAN/CVV. The SDK redacts those internally; do not
  bypass that by stringifying its inputs in the harness.
- Don't add network calls outside the SDK (no direct `fetch` to
  Flute endpoints). The whole point is to exercise the SDK exactly
  as a customer integration would.
- Don't deploy this harness to a public URL with production
  credentials. It's a developer / QA tool, not a tenant-facing app.

## Local-only invariants

- `node_modules` is git-ignored.
- `.env.local` is git-ignored. Never commit credentials.
