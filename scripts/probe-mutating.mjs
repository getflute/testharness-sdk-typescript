// Probe of the mutating-endpoint surface. Exercises:
//
//   - paymentSessions.create   (should work even without processors)
//   - paymentSessions.retrieve (round-trips the id we just created)
//   - paymentSessions.cancel   (closes the session)
//   - transactions.sale        (expected to fail when no processor configured)
//
// This script does NOT go through the harness UI — it imports the SDK
// directly the same way the Server Action does. It's a pre-flight check
// that the wiring + types match what the backend actually accepts.

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

let pass = 0;
let fail = 0;

async function step(label, fn) {
  process.stdout.write(`→ ${label}… `);
  const t0 = performance.now();
  try {
    const data = await fn();
    const ms = Math.round(performance.now() - t0);
    console.log(`OK (${ms} ms)`);
    if (data !== undefined) console.log('   ', JSON.stringify(data).slice(0, 160));
    pass++;
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    const status = err instanceof FluteApiError ? err.statusCode ?? '' : '';
    console.log(`FAIL (${ms} ms) — ${err?.name ?? 'Error'}${status ? ` [${status}]` : ''}: ${err?.message ?? err}`);
    fail++;
  }
}

let createdSessionId = null;

await step('paymentSessions.create({ amount: 1, mode: "Payment" })', async () => {
  const r = await flute.paymentSessions.create({ amount: 1, mode: 'Payment' });
  createdSessionId = r.id;
  console.log('   [full response keys]:', Object.keys(r).join(', '));
  return r;
});

if (createdSessionId) {
  await step('paymentSessions.retrieve(id)', async () => {
    const r = await flute.paymentSessions.retrieve(createdSessionId);
    return { status: r.status, mode: r.mode };
  });
  await step('paymentSessions.cancel(id)', async () => {
    await flute.paymentSessions.cancel(createdSessionId);
    return { cancelled: true };
  });
}

try {
  await flute.transactions.sale({
    baseAmount: 1,
    currencyCode: 'USD',
    transactionDetails: {
      cardData: {
        paymentMethodDetails: {
          cardNumber: '4111111111111111',
          securityCode: '123',
          expirationMonth: 12,
          expirationYear: new Date().getFullYear() + 4,
        },
      },
    },
  });
  console.log('→ transactions.sale: unexpectedly succeeded');
} catch (err) {
  console.log('→ transactions.sale (expected to fail): inspecting error envelope');
  console.log('   name:', err?.name);
  console.log('   message:', err?.message);
  console.log('   statusCode:', err?.statusCode);
  console.log('   correlationId:', err?.correlationId);
  console.log('   code:', err?.code);
  console.log('   payload:', JSON.stringify(err?.payload, null, 2));
  console.log('   keys:', Object.keys(err ?? {}).join(', '));
}

console.log('');
console.log(`${pass}/${pass + fail} passed (failures expected for transactions.sale on a processor-less merchant)`);
process.exit(0);
