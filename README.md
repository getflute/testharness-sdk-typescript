# testharness-sdk-typescript

Visual test harness for [`@getflute/sdk`](https://www.npmjs.com/package/@getflute/sdk).

QA opens this app in a browser, picks an SDK method from the sidebar,
fills in inputs, clicks **Run**, and inspects the formatted response.
The harness is data-driven from a single endpoint catalog
(`lib/endpoints.ts`), so adding coverage for a new SDK method is a
one-file change plus a dispatch case.

## Stack

- Next.js 16 (app router)
- React 19, TypeScript
- Tailwind CSS v4 + shadcn/ui
- Server Actions for SDK calls — `clientSecret` never reaches the
  browser
- `@getflute/sdk` from npm

## Architecture in one paragraph

The page is a Server Component that reads `process.env.FLUTE_*` and
passes a redacted config snapshot to the client `<Harness>`. The
sidebar and forms are rendered from `ENDPOINTS` in `lib/endpoints.ts`.
Submitting the form calls the `runEndpoint` Server Action
(`app/actions.ts`), which constructs a `Flute` client with the env
credentials, dispatches to the right SDK method, and returns a
serialised result. The browser only ever sees the response payload —
credentials and access tokens stay on the Node side.

## Setup

```bash
git clone https://github.com/getflute/testharness-sdk-typescript.git
cd testharness-sdk-typescript
npm install
cp .env.local.example .env.local
# fill in FLUTE_CLIENT_ID and FLUTE_CLIENT_SECRET (Flute sandbox credentials)
npm run dev
# open http://localhost:3000
```

## Configuration

`.env.local` is the only knob. Restart `npm run dev` after editing.

| Variable              | Required | Purpose                                                                                                            |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `FLUTE_ENV`           | optional | `sandbox` (default) / `uat` / `dev` / `staging` → sandbox base URLs. `production` / `prod` / `live` → production.  |
| `FLUTE_CLIENT_ID`     | yes      | OAuth 2.0 client id issued by Flute.                                                                               |
| `FLUTE_CLIENT_SECRET` | yes      | OAuth 2.0 client secret. Stays server-side.                                                                        |
| `FLUTE_WEBHOOK_SECRET`| optional | Default secret used by the `webhooks.verifySignature` simulator.                                                   |

Credentials are masked in the top bar (`abcd…wxyz`). The full secret
never crosses the network boundary into the client bundle.

## Endpoint coverage

All public methods of `@getflute/sdk@^0.2.0` are wired:

| Endpoint                                        | Mutating | Notes                                                                                  |
| ----------------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `flute.sessions.authenticate()`                 | no       | OAuth handshake.                                                                       |
| `flute.settings.getPaymentSettings()`           | no       | Drives the merchant snapshot in the top bar.                                           |
| `flute.transactions.list({ page, pageSize })`   | no       |                                                                                        |
| `flute.transactions.retrieve(id)`               | no       |                                                                                        |
| `flute.transactions.calculateAmount({ … })`     | no       | `currencyCode` defaults to `USD` (backend returns 500 when omitted).                   |
| `flute.transactions.sale({ … })`                | **yes**  | Card data form + sandbox preset. Click Run twice to confirm.                           |
| `flute.transactions.authorize({ … })`           | **yes**  | Same shape as sale; complete with `capture`.                                           |
| `flute.transactions.capture(id, { amount? })`   | **yes**  | Optional partial amount.                                                               |
| `flute.transactions.void(id)`                   | **yes**  | Reverse pre-settlement.                                                                |
| `flute.transactions.refund(id, { amount? })`    | **yes**  | Optional partial amount; ACH refunds are full-only.                                    |
| `flute.paymentSessions.create({ … })`           | **yes**  | Returns a `checkoutUrl` (see "PCI-safe flow" below).                                   |
| `flute.paymentSessions.retrieve(id)`            | no       |                                                                                        |
| `flute.paymentSessions.cancel(id)`              | **yes**  |                                                                                        |
| `flute.webhooks.verifySignature({ … })`         | n/a      | Stateless. Uses `FLUTE_WEBHOOK_SECRET` unless overridden.                              |

### Mutating endpoint UX

- The Run button on a mutating endpoint is **two-stage**: click once
  to arm, click again to execute. Editing any field re-disarms it.
- In `production`, the button switches to red and the label reads
  "Run (REAL CHARGE — click again to confirm)".
- The top of the page shows a banner whenever a mutating endpoint is
  selected, repeating the environment context and warning when the
  merchant has no payment processors configured (in which case `sale`
  / `authorize` will fail with HTTP 400 "No active Card processor
  found").

### PCI-safe flow (recommended for QA)

If the merchant has a real card processor configured, **prefer this
flow over typing PANs**:

1. `paymentSessions.create({ amount, mode: 'Payment' })` — returns
   `id` + `checkoutUrl`.
2. Click "open checkoutUrl ↗" in the response panel — the hosted
   checkout opens in a new tab with PCI-grade card capture.
3. Complete the payment in that tab.
4. Back in the harness, run `paymentSessions.retrieve(id)` to inspect
   the resulting transaction. The session payload exposes the
   underlying `transactionDetails.transactionId`, which you can feed
   into `transactions.{retrieve,capture,void,refund}`.

This path keeps card data out of the harness entirely — the only
thing that ever touches the harness server is `amount` and `mode`.

### Test cards (for direct `sale` / `authorize`)

The harness ships a curated preset selector with sandbox-safe PANs
and **auto-picks a default based on the merchant's processors**
(visible as badges in the top bar):

- Merchant has the internal sandbox-card processor → defaults to
  `4111111111111111` (generic approve), and exposes the full `4000…`
  family (approve, decline, insufficient funds, expired, stolen, CVV
  mismatch, timeout, etc.).
- Merchant has TSYS sandbox and no internal sandbox-card processor →
  defaults to `4012000098765439` with CVV `999` (the canonical TSYS
  sandbox approve card).
- Mixed or unknown → uses the catalog default; pick a preset
  manually.

`4111111111111111` is **rejected** by TSYS sandbox (it only behaves
on the internal sandbox-card processor). If you see "Declined" with
TSYS, switch to the TSYS preset.

When the merchant has **no processor configured**, `sale` /
`authorize` return HTTP 400 with body
`{"Details": "No active Card processor found for merchant"}`. The
harness surfaces that string in the error pill.

Important: `sale` / `authorize` always come back HTTP 200, even on a
processor decline. Read `transactionStatus` (`Approved` / `Declined`
/ `Failed`) and `processorResponse.responseCode` in the response
panel to know what the gateway actually did.

## Adding a new endpoint

1. Append an `EndpointSpec` to `ENDPOINTS` in `lib/endpoints.ts`.
2. Add a `case '<id>':` to the `dispatch` switch in `app/actions.ts`.
3. Done — the sidebar, form, and run button are derived
   automatically.

## Scripts

```bash
npm run dev       # Next.js dev server on http://localhost:3000
npm run build     # production build
npm run start     # serve the production build
npm run lint      # ESLint
npm run typecheck # tsc --noEmit
npm run probe     # CLI probe of read-only endpoints (sanity check)
```

## Security model

- `clientSecret` never crosses the Server / Client boundary. The
  factory lives in a `'server-only'` module and is invoked
  exclusively from the Server Action.
- Form values typed by QA are forwarded to the server for the
  duration of the request; nothing is persisted on disk.
- Access tokens minted by `sessions.authenticate()` are surfaced as a
  redacted preview, never the full JWT.
- The harness is intended to run on a developer / QA workstation. Do
  not deploy it to a public URL with real production credentials.

## Roadmap

- Per-call history with replay (`localStorage`).
- "Copy as curl" button on every response card.
- Light / dark theme toggle.
- E2E test: spin a mock backend with `msw` and assert the harness
  wires every endpoint correctly.

## License

MIT — see [LICENSE](./LICENSE) (TODO: add LICENSE file mirroring the
SDK's).
