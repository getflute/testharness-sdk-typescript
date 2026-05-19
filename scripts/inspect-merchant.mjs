// Inspects which payment processor the configured merchant uses.
// Helps decide which test PANs make sense in the harness UI.
import { readFile } from 'node:fs/promises';
import { Flute, Environment } from '@getflute/sdk';

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

const settings = await flute.settings.getPaymentSettings();
console.log(JSON.stringify(settings, null, 2));
