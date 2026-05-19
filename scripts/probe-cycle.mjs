// Full mutating-endpoint cycle against UAT.
//
//   Cycle A: sale → retrieve → void
//   Cycle B: authorize → retrieve → capture → refund (partial)
//
// Each step prints status + relevant response fields. Failures are
// reported but do not stop subsequent steps so we always get a complete
// picture.

import { readFile } from 'node:fs/promises';
import { Flute, Environment, FluteApiError } from '@getflute/sdk';

const text = await readFile('.env.local', 'utf8');
for (const line of text.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  process.env[trimmed.slice(0, eq).trim()] ??= trimmed
    .slice(eq + 1)
    .trim()
    .replace(/^["']|["']$/g, '');
}

const flute = new Flute({
  clientId: process.env.FLUTE_CLIENT_ID,
  clientSecret: process.env.FLUTE_CLIENT_SECRET,
  environment: ['production', 'prod', 'live'].includes((process.env.FLUTE_ENV ?? '').toLowerCase())
    ? Environment.Production
    : Environment.Sandbox,
});

const NEXT_YEAR = new Date().getFullYear() + 4;
// Pick the test card based on what the merchant has wired:
//   - SandboxCard processor → 4111111111111111 (generic approve) or one of the 4000… scenarios.
//   - Tsys processor (sandbox keys) → 4012000098765439 with CVV 999.
const TEST_PAN = process.env.PROBE_PAN ?? '4012000098765439';
const TEST_CVV = process.env.PROBE_CVV ?? '999';
const SANDBOX_APPROVE = {
  cardNumber: TEST_PAN,
  securityCode: TEST_CVV,
  expirationMonth: 12,
  expirationYear: NEXT_YEAR,
};

console.log(`Using PAN ${TEST_PAN} (CVV ${TEST_CVV}). Override with PROBE_PAN / PROBE_CVV env vars.`);
console.log('');

let pass = 0;
let fail = 0;

async function step(label, fn) {
  process.stdout.write(`→ ${label}… `);
  const t0 = performance.now();
  try {
    const data = await fn();
    const ms = Math.round(performance.now() - t0);
    console.log(`OK (${ms} ms)`);
    if (data !== undefined) {
      const text = typeof data === 'string' ? data : JSON.stringify(data);
      console.log('   ', text.length > 220 ? text.slice(0, 220) + '…' : text);
    }
    pass++;
    return data;
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    const status = err instanceof FluteApiError ? err.httpStatus ?? '' : '';
    const detail = err?.payload?.Details ? ` — ${err.payload.Details}` : '';
    console.log(`FAIL (${ms} ms) — ${err?.name ?? 'Error'}${status ? ` [${status}]` : ''}: ${err?.message ?? err}${detail}`);
    fail++;
    return null;
  }
}

console.log('===== Cycle A: sale → retrieve → void =====');

const saleResult = await step('transactions.sale({ baseAmount: 1.00, sandbox PAN })', async () => {
  return await flute.transactions.sale({
    baseAmount: 1,
    currencyCode: 'USD',
    customerInitiatedTransaction: true,
    transactionDetails: { cardData: { paymentMethodDetails: SANDBOX_APPROVE } },
  });
});

const saleId = saleResult?.transactionId ?? null;

if (saleId) {
  await step(`transactions.retrieve("${saleId}")`, async () => {
    const r = await flute.transactions.retrieve(saleId);
    return {
      id: r.id,
      status: r.status,
      processedAmount: r.processedAmount,
      transactionType: r.transactionEvents?.[0]?.type,
    };
  });

  await step(`transactions.void("${saleId}")`, async () => {
    const r = await flute.transactions.void(saleId);
    return {
      transactionStatus: r.transactionStatus,
      processedAmount: r.processedAmount,
      processorResponse: r.processorResponse?.responseCode,
    };
  });
}

console.log('');
console.log('===== Cycle B: authorize → retrieve → capture → refund =====');

const authResult = await step('transactions.authorize({ baseAmount: 2.00, sandbox PAN })', async () => {
  return await flute.transactions.authorize({
    baseAmount: 2,
    currencyCode: 'USD',
    customerInitiatedTransaction: true,
    transactionDetails: { cardData: { paymentMethodDetails: SANDBOX_APPROVE } },
  });
});

const authId = authResult?.transactionId ?? null;

if (authId) {
  await step(`transactions.retrieve("${authId}")`, async () => {
    const r = await flute.transactions.retrieve(authId);
    return { id: r.id, status: r.status, processedAmount: r.processedAmount };
  });

  await step(`transactions.capture("${authId}")  (full)`, async () => {
    const r = await flute.transactions.capture(authId);
    return {
      transactionStatus: r.transactionStatus,
      processedAmount: r.processedAmount,
      processorResponse: r.processorResponse?.responseCode,
    };
  });

  // Refunds usually require a settled transaction; this likely fails on
  // UAT immediately after capture, but we surface the exact reason.
  await step(`transactions.refund("${authId}", { amount: 1.00 })  (partial, may need settlement)`, async () => {
    const r = await flute.transactions.refund(authId, { amount: 1 });
    return {
      transactionStatus: r.transactionStatus,
      processedAmount: r.processedAmount,
      processorResponse: r.processorResponse?.responseCode,
    };
  });
}

console.log('');
console.log(`${pass}/${pass + fail} passed`);
process.exit(0);
