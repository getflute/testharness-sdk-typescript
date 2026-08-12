import 'server-only';
import {
  Flute,
  Environment,
  type FluteConfig,
  type PaymentSettings,
  getVersion,
} from '@getflute/sdk';

export type HarnessEnvironment = 'sandbox' | 'production';

export type HarnessCredentials = {
  environment: HarnessEnvironment;
  clientId: string;
  clientSecret: string;
};

export type HarnessConfigStatus =
  | {
      ready: true;
      environment: HarnessEnvironment;
      clientIdMasked: string;
      sdkVersion: string;
      hasWebhookSecret: boolean;
    }
  | {
      ready: false;
      missing: string[];
      sdkVersion: string;
    };

const SANDBOX_ALIASES = new Set(['sandbox', 'uat', 'dev', 'development', 'staging', 'stage']);
const PRODUCTION_ALIASES = new Set(['production', 'prod', 'live']);

function detectEnv(raw: string | undefined): HarnessEnvironment {
  const value = (raw ?? 'sandbox').toLowerCase().trim();
  if (PRODUCTION_ALIASES.has(value)) return 'production';
  if (SANDBOX_ALIASES.has(value)) return 'sandbox';
  return 'sandbox';
}

function maskCredential(value: string): string {
  if (value.length <= 8) return '•'.repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function getCredentialsFromEnv(): HarnessCredentials | null {
  const { FLUTE_CLIENT_ID, FLUTE_CLIENT_SECRET } = process.env;
  if (!FLUTE_CLIENT_ID || !FLUTE_CLIENT_SECRET) return null;
  return {
    environment: detectEnv(process.env.FLUTE_ENV),
    clientId: FLUTE_CLIENT_ID,
    clientSecret: FLUTE_CLIENT_SECRET,
  };
}

export function describeConfig(): HarnessConfigStatus {
  const sdkVersion = getVersion();
  const credentials = getCredentialsFromEnv();
  if (!credentials) {
    const missing: string[] = [];
    if (!process.env.FLUTE_CLIENT_ID) missing.push('FLUTE_CLIENT_ID');
    if (!process.env.FLUTE_CLIENT_SECRET) missing.push('FLUTE_CLIENT_SECRET');
    return { ready: false, missing, sdkVersion };
  }
  return {
    ready: true,
    environment: credentials.environment,
    clientIdMasked: maskCredential(credentials.clientId),
    sdkVersion,
    hasWebhookSecret: Boolean(process.env.FLUTE_WEBHOOK_SECRET),
  };
}

export function createFluteClient(): Flute {
  const credentials = getCredentialsFromEnv();
  if (!credentials) {
    throw new Error(
      'Flute credentials not configured. Copy .env.local.example to .env.local and fill in FLUTE_CLIENT_ID + FLUTE_CLIENT_SECRET, then restart `npm run dev`.',
    );
  }
  const config: FluteConfig = {
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    environment:
      credentials.environment === 'production' ? Environment.Production : Environment.Sandbox,
    userAgentSuffix: 'testharness-sdk-typescript',
    ...(readBaseUrlOverrides() ?? {}),
  };
  return new Flute(config);
}

export type MerchantSnapshot = {
  ok: true;
  companyName: string | null;
  mccCode: string | null;
  defaultProcessorId: string | null;
  processors: Array<{
    id: string;
    name: string | null;
    type: 'Tsys' | 'Ach' | 'SandboxCard' | 'SandboxAch' | string;
    isDefault: boolean;
  }>;
  zeroCostProcessingOption: string | null;
  isTipsEnabled: boolean;
  rawSettings: PaymentSettings;
};

export type MerchantSnapshotError = {
  ok: false;
  message: string;
};

/**
 * Best-effort fetch of the merchant payment configuration for the
 * top-bar. Used to:
 * - show the merchant name + processors,
 * - auto-suggest `paymentProcessorId` for sale/authorize forms,
 * - warn QA when the merchant has no processors configured.
 *
 * Returns an error envelope rather than throwing so the page does not
 * fail to render when credentials are wrong or the network is down.
 */
export async function fetchMerchantSnapshot(): Promise<MerchantSnapshot | MerchantSnapshotError> {
  if (!getCredentialsFromEnv()) {
    return { ok: false, message: 'No credentials configured.' };
  }
  try {
    const flute = createFluteClient();
    const settings = await flute.settings.getPaymentSettings();
    const processors = (settings.availablePaymentProcessors ?? []).map((p) => ({
      // The wire fields are `paymentProcessorId` / `processorName`. Reading
      // `id` / `name` left every row blank, so the processor list rendered
      // empty and the auto-suggested paymentProcessorId was an empty string —
      // QA had to paste the GUID by hand.
      id: String(p.paymentProcessorId ?? ''),
      name: p.processorName ?? null,
      type: String(p.type ?? ''),
      isDefault: Boolean(p.isDefault),
    }));
    return {
      ok: true,
      companyName: settings.companyName ?? null,
      mccCode: settings.mccCode ?? null,
      defaultProcessorId:
        processors.find((p) => p.isDefault)?.id ?? processors[0]?.id ?? null,
      processors,
      zeroCostProcessingOption: settings.zeroCostProcessingOption ?? null,
      isTipsEnabled: Boolean(settings.isTipsEnabled),
      rawSettings: settings,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }
}

/**
 * Host overrides, applied on top of whatever `FLUTE_ENV` selects.
 *
 * Required for internal rings. From `@getflute/sdk@0.3.0` onward
 * `environment: 'sandbox'` resolves to the public Flute sandbox, which does
 * not know internal credentials — the OAuth handshake fails with
 * `invalid_client` and every call in the harness returns a bare 401.
 *
 * Each is optional and independent; anything omitted keeps the SDK default.
 */
function readBaseUrlOverrides(): Pick<FluteConfig, 'baseUrls'> | undefined {
  const isvApi = process.env.FLUTE_ISV_API_URL?.trim();
  const payIntApi = process.env.FLUTE_PAY_INT_API_URL?.trim();
  const oauth = process.env.FLUTE_OAUTH_URL?.trim();
  if (!isvApi && !payIntApi && !oauth) return undefined;
  return {
    baseUrls: {
      ...(isvApi ? { isvApi } : {}),
      ...(payIntApi ? { payIntApi } : {}),
      ...(oauth ? { oauth } : {}),
    },
  };
}
