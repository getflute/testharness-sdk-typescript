/**
 * Catalog of every public method exposed by `@getflute/sdk`.
 *
 * The harness UI is data-driven from this list — each entry declares the
 * inputs the form should render, whether the call mutates state on the
 * backend, and a brief description so QA knows what they are testing.
 *
 * To add coverage for a new SDK method:
 * 1. Append an entry below.
 * 2. Implement the dispatch case in `app/actions.ts`.
 *
 * That's it — the UI picks it up automatically.
 */

export type ParamType = 'text' | 'number' | 'boolean' | 'select' | 'textarea';

export type ParamSpec = {
  name: string;
  label: string;
  type: ParamType;
  required?: boolean;
  default?: string | number | boolean;
  options?: readonly { value: string; label: string }[];
  description?: string;
  placeholder?: string;
  /** Optional logical group used to render the form in sections. */
  group?: string;
  /** When true, the input renders as a sensitive field (mask in copy). */
  sensitive?: boolean;
};

export type EndpointSpec = {
  id: string;
  namespace: 'settings' | 'transactions' | 'paymentSessions' | 'webhooks' | 'sessions';
  label: string;
  signature: string;
  description: string;
  docsUrl?: string;
  mutating?: boolean;
  implemented: boolean;
  params: readonly ParamSpec[];
  /** Optional contextual notes shown above the form. */
  notes?: string;
  /** When true, render the test-card preset selector inside this form. */
  acceptsTestCard?: boolean;
};

const PRICING_TYPE_OPTIONS = [
  { value: 'Card', label: 'Card' },
  { value: 'Cash', label: 'Cash' },
] as const;

const PAYMENT_SESSION_MODE_OPTIONS = [
  { value: 'Payment', label: 'Payment' },
  { value: 'SaveMethod', label: 'SaveMethod' },
  { value: 'PaymentAndSave', label: 'PaymentAndSave' },
] as const;

const TX_AMOUNT: ParamSpec = {
  name: 'baseAmount',
  label: 'baseAmount (USD)',
  type: 'number',
  required: true,
  default: 10,
  group: 'Amount',
};

const TX_CURRENCY: ParamSpec = {
  name: 'currencyCode',
  label: 'currencyCode',
  type: 'text',
  default: 'USD',
  group: 'Amount',
};

const TX_PROCESSOR_ID: ParamSpec = {
  name: 'paymentProcessorId',
  label: 'paymentProcessorId',
  type: 'text',
  group: 'Routing',
  description:
    'UUID of the merchant payment processor that should handle this transaction. Auto-populated from `settings.getPaymentSettings()` on page load when one default exists; override here to target a specific processor.',
};

const TX_PRICING_TYPE: ParamSpec = {
  name: 'pricingType',
  label: 'pricingType',
  type: 'select',
  group: 'Routing',
  options: PRICING_TYPE_OPTIONS,
  description:
    'Only relevant for dual-pricing merchants. Leave empty when ZCP is "None".',
};

const TX_REFERENCE_ID: ParamSpec = {
  name: 'referenceId',
  label: 'referenceId',
  type: 'text',
  group: 'Routing',
  description: 'ISV-side reference id; participates in duplicate-charge detection.',
};

const TX_CIT: ParamSpec = {
  name: 'customerInitiatedTransaction',
  label: 'customerInitiatedTransaction',
  type: 'boolean',
  default: true,
  group: 'Routing',
  description: 'true = customer-initiated (CIT). false = merchant-initiated (MIT).',
};

const CARD_NUMBER: ParamSpec = {
  name: 'cardNumber',
  label: 'cardNumber',
  type: 'text',
  required: true,
  default: '4111111111111111',
  group: 'Card data',
  sensitive: true,
  description: 'Use a sandbox PAN — never a real card. Pick from the test-card presets above.',
};

const CARD_CVV: ParamSpec = {
  name: 'securityCode',
  label: 'securityCode',
  type: 'text',
  required: true,
  default: '123',
  group: 'Card data',
  sensitive: true,
};

const CARD_EXP_MONTH: ParamSpec = {
  name: 'expirationMonth',
  label: 'expirationMonth (1-12)',
  type: 'number',
  required: true,
  default: 12,
  group: 'Card data',
};

const CARD_EXP_YEAR: ParamSpec = {
  name: 'expirationYear',
  label: 'expirationYear (YYYY)',
  type: 'number',
  required: true,
  default: new Date().getFullYear() + 4,
  group: 'Card data',
};

export const ENDPOINTS: readonly EndpointSpec[] = [
  // —— sessions ————————————————————————————————————————————————
  {
    id: 'sessions.token',
    namespace: 'sessions',
    label: 'Get OAuth token',
    signature: 'flute.sessions.authenticate()',
    description:
      'Forces an OAuth handshake against the configured environment and returns the bearer token + expiry. Useful as a smoke test that credentials and network are reachable.',
    implemented: true,
    params: [],
  },

  // —— settings ————————————————————————————————————————————————
  {
    id: 'settings.getPaymentSettings',
    namespace: 'settings',
    label: 'Get payment settings',
    signature: 'flute.settings.getPaymentSettings()',
    description:
      'Returns the merchant payment configuration: available currencies, max amount, ZCP setup, surcharge rates, payment processors, etc. Read-only.',
    implemented: true,
    params: [],
  },

  // —— transactions ————————————————————————————————————————————
  {
    id: 'transactions.list',
    namespace: 'transactions',
    label: 'List transactions',
    signature: 'flute.transactions.list({ page, pageSize })',
    description: 'Paginated list of transactions for the merchant. Read-only.',
    implemented: true,
    params: [
      { name: 'page', label: 'page', type: 'number', default: 1 },
      { name: 'pageSize', label: 'pageSize', type: 'number', default: 25 },
    ],
  },
  {
    id: 'transactions.retrieve',
    namespace: 'transactions',
    label: 'Retrieve transaction',
    signature: 'flute.transactions.retrieve(transactionId)',
    description: 'Fetch a single transaction by id. Read-only.',
    implemented: true,
    params: [
      {
        name: 'transactionId',
        label: 'transactionId',
        type: 'text',
        required: true,
        placeholder: 'e.g. b1c2d3e4-…',
      },
    ],
  },
  {
    id: 'transactions.calculateAmount',
    namespace: 'transactions',
    label: 'Calculate amount',
    signature: 'flute.transactions.calculateAmount({ baseAmount, pricingType, currencyCode, … })',
    description:
      'Pricing helper that respects the merchant ZCP / dual pricing / surcharge / discount config. Read-only.',
    notes:
      'currencyCode is documented as optional in the OpenAPI spec, but the backend currently returns 500 when omitted. The harness sends "USD" by default.',
    implemented: true,
    params: [
      { name: 'baseAmount', label: 'baseAmount (USD)', type: 'number', required: true, default: 10 },
      {
        name: 'pricingType',
        label: 'pricingType',
        type: 'select',
        required: true,
        default: 'Card',
        description:
          'For dual-pricing merchants. Use "Card" to compute the card-side price (with surcharge / dual-pricing card price) or "Cash" for the cash-side price (with cash discount).',
        options: PRICING_TYPE_OPTIONS,
      },
      { name: 'currencyCode', label: 'currencyCode', type: 'text', default: 'USD' },
      { name: 'tipAmount', label: 'tipAmount (optional)', type: 'number' },
    ],
  },
  {
    id: 'transactions.sale',
    namespace: 'transactions',
    label: 'Sale (auto-capture)',
    signature: 'flute.transactions.sale({ baseAmount, transactionDetails: { cardData: { … } } })',
    description:
      'One-shot card charge that goes straight to settlement. Captures funds immediately. Use a sandbox PAN — never a real card. Idempotent on `Idempotency-Key` (auto-generated by the SDK).',
    notes:
      'For tokenised cards, leave the card-data fields empty and pass `paymentMethodId` instead — but the harness does not yet expose that flow (it would need a customer + saved payment method). Use a sandbox PAN here for now.',
    mutating: true,
    implemented: true,
    acceptsTestCard: true,
    params: [
      TX_AMOUNT,
      TX_CURRENCY,
      TX_PROCESSOR_ID,
      TX_PRICING_TYPE,
      TX_REFERENCE_ID,
      TX_CIT,
      CARD_NUMBER,
      CARD_CVV,
      CARD_EXP_MONTH,
      CARD_EXP_YEAR,
    ],
  },
  {
    id: 'transactions.authorize',
    namespace: 'transactions',
    label: 'Authorize (manual capture)',
    signature: 'flute.transactions.authorize({ baseAmount, transactionDetails: { cardData: { … } } })',
    description:
      'Authorize funds without capturing them. Hold remains until you call `capture`, `void`, or it auto-expires (processor-dependent, typically 7-30 days).',
    mutating: true,
    implemented: true,
    acceptsTestCard: true,
    params: [
      TX_AMOUNT,
      TX_CURRENCY,
      TX_PROCESSOR_ID,
      TX_PRICING_TYPE,
      TX_REFERENCE_ID,
      TX_CIT,
      CARD_NUMBER,
      CARD_CVV,
      CARD_EXP_MONTH,
      CARD_EXP_YEAR,
    ],
  },
  {
    id: 'transactions.capture',
    namespace: 'transactions',
    label: 'Capture authorization',
    signature: 'flute.transactions.capture(transactionId, { amount? })',
    description:
      'Capture a previous `authorize`. Leave `amount` empty for a full capture, or pass a smaller amount for a partial capture.',
    mutating: true,
    implemented: true,
    params: [
      {
        name: 'transactionId',
        label: 'transactionId',
        type: 'text',
        required: true,
        placeholder: 'id returned by authorize',
      },
      {
        name: 'amount',
        label: 'amount (optional)',
        type: 'number',
        description: 'Leave empty for a full capture. Must be ≤ originally authorised amount.',
      },
    ],
  },
  {
    id: 'transactions.void',
    namespace: 'transactions',
    label: 'Void / reverse',
    signature: 'flute.transactions.void(transactionId)',
    description:
      'Void a transaction that has not yet settled. The API auto-detects card vs ACH and chooses the correct reversal flow.',
    mutating: true,
    implemented: true,
    params: [
      {
        name: 'transactionId',
        label: 'transactionId',
        type: 'text',
        required: true,
      },
    ],
  },
  {
    id: 'transactions.refund',
    namespace: 'transactions',
    label: 'Refund (settled)',
    signature: 'flute.transactions.refund(transactionId, { amount? })',
    description:
      'Refund a settled card or ACH transaction. Card refunds may be partial; ACH refunds are full only.',
    notes:
      'For unsettled card transactions, prefer `void`. The API rejects refunds on transactions that have not yet settled.',
    mutating: true,
    implemented: true,
    params: [
      {
        name: 'transactionId',
        label: 'transactionId',
        type: 'text',
        required: true,
      },
      {
        name: 'amount',
        label: 'amount (optional)',
        type: 'number',
        description: 'Leave empty for a full refund (or for ACH, which only supports full).',
      },
    ],
  },

  // —— payment sessions ————————————————————————————————————————
  {
    id: 'paymentSessions.create',
    namespace: 'paymentSessions',
    label: 'Create payment session',
    signature: 'flute.paymentSessions.create({ amount, mode, customerId?, … })',
    description:
      'Create a new payment session. Use this when delegating PCI capture to Aurora-hosted UI or to enable duplicate-charge protection.',
    notes:
      'For mode `SaveMethod`, `amount` MUST be 0. For `Payment` and `PaymentAndSave`, `amount` MUST be > 0.',
    mutating: true,
    implemented: true,
    params: [
      { name: 'amount', label: 'amount (USD)', type: 'number', required: true, default: 10 },
      {
        name: 'mode',
        label: 'mode',
        type: 'select',
        default: 'Payment',
        options: PAYMENT_SESSION_MODE_OPTIONS,
      },
      {
        name: 'customerId',
        label: 'customerId',
        type: 'text',
        description: 'Existing customer to attach the saved payment method to. Optional.',
      },
      {
        name: 'referenceId',
        label: 'referenceId',
        type: 'text',
        description: 'ISV reference id, used for duplicate detection.',
      },
      { name: 'tipAmount', label: 'tipAmount (optional)', type: 'number' },
      { name: 'skipAddressVerification', label: 'skipAddressVerification', type: 'boolean' },
    ],
  },
  {
    id: 'paymentSessions.retrieve',
    namespace: 'paymentSessions',
    label: 'Retrieve payment session',
    signature: 'flute.paymentSessions.retrieve(paymentSessionId)',
    description: 'Fetch a payment session by id. Read-only.',
    implemented: true,
    params: [
      {
        name: 'paymentSessionId',
        label: 'paymentSessionId',
        type: 'text',
        required: true,
        placeholder: 'e.g. ps_…',
      },
    ],
  },
  {
    id: 'paymentSessions.cancel',
    namespace: 'paymentSessions',
    label: 'Cancel payment session',
    signature: 'flute.paymentSessions.cancel(paymentSessionId)',
    description: 'Cancel a payment session that has not yet completed.',
    mutating: true,
    implemented: true,
    params: [
      {
        name: 'paymentSessionId',
        label: 'paymentSessionId',
        type: 'text',
        required: true,
      },
    ],
  },

  // —— webhooks ————————————————————————————————————————————————
  {
    id: 'webhooks.verifySignature',
    namespace: 'webhooks',
    label: 'Verify webhook signature',
    signature: 'flute.webhooks.verifySignature({ … })',
    description:
      'Stateless HMAC-SHA256 signature verification for incoming webhook deliveries. Does not call the backend. Use the values from the `Flute-Webhook-*` headers on a real or replayed delivery.',
    notes:
      'Reads FLUTE_WEBHOOK_SECRET from your .env.local by default; you can override it inline. This endpoint never leaves the server.',
    implemented: true,
    params: [
      {
        name: 'signatureHeader',
        label: 'Flute-Webhook-Signature',
        type: 'text',
        required: true,
        placeholder: 'v1,SGVsbG8=',
      },
      { name: 'idHeader', label: 'Flute-Webhook-ID', type: 'text', required: true },
      {
        name: 'timestampHeader',
        label: 'Flute-Webhook-Timestamp',
        type: 'text',
        required: true,
        placeholder: 'unix seconds',
      },
      {
        name: 'rawRequestBody',
        label: 'Raw request body',
        type: 'textarea',
        required: true,
        placeholder: 'paste the exact bytes of the webhook request body',
      },
      {
        name: 'signatureSecret',
        label: 'signatureSecret (override)',
        type: 'text',
        sensitive: true,
        description:
          'Leave empty to use FLUTE_WEBHOOK_SECRET from .env.local. Fill in to test with a different secret.',
      },
      {
        name: 'toleranceSeconds',
        label: 'toleranceSeconds',
        type: 'number',
        default: 300,
        description: 'Replay window. Default 300 (5 min). Use Infinity to disable (not advised).',
      },
    ],
  },
] as const;

export const NAMESPACES: readonly { id: EndpointSpec['namespace']; label: string }[] = [
  { id: 'sessions', label: 'Sessions (auth)' },
  { id: 'settings', label: 'Settings' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'paymentSessions', label: 'Payment Sessions' },
  { id: 'webhooks', label: 'Webhooks' },
] as const;

export function findEndpoint(id: string): EndpointSpec | undefined {
  return ENDPOINTS.find((e) => e.id === id);
}
