// Quick probe to confirm the harness wiring talks to live UAT.
// Reads .env.local, builds a Flute client the same way the Server Action
// does, then exercises three read-only endpoints. NOT used by the UI.
//
//   node scripts/probe.mjs
//
// This is intentionally a separate script (not tsx, no compile step) so
// we can run it against the published SDK from `node_modules` directly.

import { readFile } from 'node:fs/promises';
import { Flute, Environment, getVersion } from '@getflute/sdk';

async function loadDotenv() {
  const text = await readFile('.env.local', 'utf8').catch(() => '');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

await loadDotenv();

const env = (process.env.FLUTE_ENV ?? 'sandbox').toLowerCase();
const isProduction = ['production', 'prod', 'live'].includes(env);
const flute = new Flute({
  clientId: process.env.FLUTE_CLIENT_ID,
  clientSecret: process.env.FLUTE_CLIENT_SECRET,
  environment: isProduction ? Environment.Production : Environment.Sandbox,
  userAgentSuffix: 'testharness-sdk-typescript/probe',
});

console.log(`SDK version: ${getVersion()}`);
console.log(`baseUrls: ${JSON.stringify(flute.baseUrls)}`);

let pass = 0;
let fail = 0;

async function step(label, fn) {
  process.stdout.write(`→ ${label}… `);
  const t0 = performance.now();
  try {
    const data = await fn();
    const ms = Math.round(performance.now() - t0);
    console.log(`OK (${ms} ms)`);
    if (data !== undefined) console.log('   ', JSON.stringify(data).slice(0, 120) + '…');
    pass++;
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    console.log(`FAIL (${ms} ms) — ${err?.name ?? 'Error'}: ${err?.message ?? err}`);
    fail++;
  }
}

await step('sessions.authenticate()', async () => {
  const t = await flute.sessions.authenticate();
  return { tokenType: t.tokenType, expiresInSeconds: Math.round((t.expiresAt - Date.now()) / 1000) };
});

await step('settings.getPaymentSettings()', async () => {
  const s = await flute.settings.getPaymentSettings();
  return { availableCurrencies: s.availableCurrencies, maxTransactionAmount: s.maxTransactionAmount };
});

await step('transactions.list({ pageSize: 5 })', async () => {
  const r = await flute.transactions.list({ pageSize: 5 });
  return { total: r.total, items: r.items.length };
});

await step('transactions.calculateAmount({ baseAmount: 10, pricingType: "Card" })', async () => {
  const r = await flute.transactions.calculateAmount({
    baseAmount: 10,
    pricingType: 'Card',
    currencyCode: 'USD',
  });
  return r;
});

console.log('');
console.log(`${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
