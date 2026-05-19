/**
 * Curated list of sandbox / UAT test cards.
 *
 * These come from the Aurora monorepo and are documented in
 * `arise-backend/Arise.Integration.Sandbox/.../CardScenarioResolver.cs`
 * (the internal Arise sandbox processor) and `Arise.Aspire/CLAUDE.md`
 * (TSYS sandbox).
 *
 * They behave deterministically only when the merchant is wired to:
 *   - `SandboxCard` processor → the `4000…` family below.
 *   - `Tsys` (sandbox keys)   → the `4012000098765439` row below.
 *
 * On other processors the SDK simply forwards the PAN; behaviour is
 * undefined. The harness prints a warning when the merchant has no
 * processors configured at all.
 */

export type TestCard = {
  id: string;
  label: string;
  processor: 'SandboxCard' | 'Tsys' | 'Generic';
  cardNumber: string;
  securityCode: string;
  expirationMonth: number;
  expirationYear: number;
  expected: string;
};

const NEXT_YEAR = new Date().getFullYear() + 4;

export const TEST_CARDS: readonly TestCard[] = [
  {
    id: 'sandbox-approve',
    label: 'SandboxCard · Approve (generic Visa)',
    processor: 'SandboxCard',
    cardNumber: '4111111111111111',
    securityCode: '123',
    expirationMonth: 12,
    expirationYear: NEXT_YEAR,
    expected: 'Approval (response code 00, "Approved")',
  },
  {
    id: 'sandbox-approve-l3',
    label: 'SandboxCard · Approve (Visa Commercial L3)',
    processor: 'SandboxCard',
    cardNumber: '4000000030010005',
    securityCode: '123',
    expirationMonth: 12,
    expirationYear: NEXT_YEAR,
    expected: 'Approval, CardType=Visa, CommercialCardLevel=Level3',
  },
  {
    id: 'sandbox-decline-do-not-honor',
    label: 'SandboxCard · Decline · Do not honor',
    processor: 'SandboxCard',
    cardNumber: '4000000010050005',
    securityCode: '123',
    expirationMonth: 12,
    expirationYear: NEXT_YEAR,
    expected: 'Decline (response code 05, "Do not honor")',
  },
  {
    id: 'sandbox-decline-insufficient',
    label: 'SandboxCard · Decline · Insufficient funds',
    processor: 'SandboxCard',
    cardNumber: '4000000010510008',
    securityCode: '123',
    expirationMonth: 12,
    expirationYear: NEXT_YEAR,
    expected: 'Decline (response code 51, "Insufficient funds")',
  },
  {
    id: 'sandbox-decline-invalid',
    label: 'SandboxCard · Decline · Invalid card number',
    processor: 'SandboxCard',
    cardNumber: '4000000010140004',
    securityCode: '123',
    expirationMonth: 12,
    expirationYear: NEXT_YEAR,
    expected: 'Decline (response code 14, "Invalid card number")',
  },
  {
    id: 'sandbox-decline-expired',
    label: 'SandboxCard · Decline · Expired card',
    processor: 'SandboxCard',
    cardNumber: '4000000010540005',
    securityCode: '123',
    expirationMonth: 12,
    expirationYear: NEXT_YEAR,
    expected: 'Decline (response code 54, "Expired card")',
  },
  {
    id: 'sandbox-decline-pickup',
    label: 'SandboxCard · Decline · Pickup card (lost)',
    processor: 'SandboxCard',
    cardNumber: '4000000010040006',
    securityCode: '123',
    expirationMonth: 12,
    expirationYear: NEXT_YEAR,
    expected: 'Decline (response code 04, "Pickup card (lost)")',
  },
  {
    id: 'sandbox-decline-stolen',
    label: 'SandboxCard · Decline · Stolen card',
    processor: 'SandboxCard',
    cardNumber: '4000000010430009',
    securityCode: '123',
    expirationMonth: 12,
    expirationYear: NEXT_YEAR,
    expected: 'Decline (response code 43, "Stolen card")',
  },
  {
    id: 'sandbox-decline-restricted',
    label: 'SandboxCard · Decline · Card restricted',
    processor: 'SandboxCard',
    cardNumber: '4000000010620005',
    securityCode: '123',
    expirationMonth: 12,
    expirationYear: NEXT_YEAR,
    expected: 'Decline (response code 62, "Card restricted")',
  },
  {
    id: 'sandbox-decline-not-permitted',
    label: 'SandboxCard · Decline · Transaction not permitted',
    processor: 'SandboxCard',
    cardNumber: '4000000010570002',
    securityCode: '123',
    expirationMonth: 12,
    expirationYear: NEXT_YEAR,
    expected: 'Decline (response code 57, "Transaction not permitted")',
  },
  {
    id: 'sandbox-decline-cvv',
    label: 'SandboxCard · Decline · CVV mismatch',
    processor: 'SandboxCard',
    cardNumber: '4000000010990008',
    securityCode: '123',
    expirationMonth: 12,
    expirationYear: NEXT_YEAR,
    expected: 'Decline (response code 05, "CVV mismatch")',
  },
  {
    id: 'sandbox-error-timeout',
    label: 'SandboxCard · Error · Timeout / no response',
    processor: 'SandboxCard',
    cardNumber: '4000000020910008',
    securityCode: '123',
    expirationMonth: 12,
    expirationYear: NEXT_YEAR,
    expected: 'Error (response code 91, "Timeout / no response")',
  },
  {
    id: 'sandbox-error-system',
    label: 'SandboxCard · Error · System error',
    processor: 'SandboxCard',
    cardNumber: '4000000020960003',
    securityCode: '123',
    expirationMonth: 12,
    expirationYear: NEXT_YEAR,
    expected: 'Error (response code 96, "System error")',
  },
  {
    id: 'sandbox-error-referral',
    label: 'SandboxCard · Decline · Referral required',
    processor: 'SandboxCard',
    cardNumber: '4000000020010007',
    securityCode: '123',
    expirationMonth: 12,
    expirationYear: NEXT_YEAR,
    expected: 'Decline (response code 01, "Referral required")',
  },
  {
    id: 'sandbox-error-reenter',
    label: 'SandboxCard · Error · Re-enter transaction',
    processor: 'SandboxCard',
    cardNumber: '4000000020190007',
    securityCode: '123',
    expirationMonth: 12,
    expirationYear: NEXT_YEAR,
    expected: 'Error (response code 19, "Re-enter transaction")',
  },
  {
    id: 'tsys-sandbox',
    label: 'TSYS Sandbox · Test card (CVV 999)',
    processor: 'Tsys',
    cardNumber: '4012000098765439',
    securityCode: '999',
    expirationMonth: 12,
    expirationYear: NEXT_YEAR,
    expected:
      'Behaviour depends on the merchant TSYS sandbox config. AVS often returns "No Match" — disable AVS in the merchant or use a card scenario configured for AVS pass.',
  },
];

export const TEST_CARDS_BY_ID = Object.fromEntries(TEST_CARDS.map((c) => [c.id, c])) as Record<
  TestCard['id'],
  TestCard
>;
