'use server';

import { createFluteClient } from '@/lib/flute';
import { findEndpoint } from '@/lib/endpoints';
import {
  FluteApiError,
  FluteAuthenticationError,
  FluteConfigurationError,
  FluteError,
  FluteNetworkError,
  FluteRateLimitError,
  FluteValidationError,
  FluteWebhookError,
  verifyWebhookSignature,
} from '@getflute/sdk';

export type SerializedError = {
  name: string;
  message: string;
  code?: string;
  status?: number;
  correlationId?: string;
  payload?: unknown;
};

export type RunResult = {
  ok: boolean;
  durationMs: number;
  endpointId: string;
  startedAt: string;
  data?: unknown;
  error?: SerializedError;
};

export type RunInput = {
  endpointId: string;
  params: Record<string, unknown>;
};

export async function runEndpoint(input: RunInput): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const endpoint = findEndpoint(input.endpointId);

  if (!endpoint) {
    return {
      ok: false,
      durationMs: 0,
      endpointId: input.endpointId,
      startedAt,
      error: { name: 'UnknownEndpoint', message: `No endpoint with id "${input.endpointId}"` },
    };
  }

  if (!endpoint.implemented) {
    return {
      ok: false,
      durationMs: 0,
      endpointId: input.endpointId,
      startedAt,
      error: {
        name: 'NotImplemented',
        message: `${endpoint.label} is not yet wired in the harness MVP. See the endpoint card for context.`,
      },
    };
  }

  try {
    const data = await dispatch(input.endpointId, input.params);
    return {
      ok: true,
      durationMs: Math.round(performance.now() - start),
      endpointId: input.endpointId,
      startedAt,
      data,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      durationMs: Math.round(performance.now() - start),
      endpointId: input.endpointId,
      startedAt,
      error: serializeError(err),
    };
  }
}

async function dispatch(endpointId: string, raw: Record<string, unknown>): Promise<unknown> {
  switch (endpointId) {
    case 'sessions.token': {
      const flute = createFluteClient();
      const token = await flute.sessions.authenticate();
      return {
        accessTokenPreview: previewToken(token.accessToken),
        tokenType: token.tokenType,
        expiresAt: token.expiresAt,
        expiresInSeconds: Math.max(0, Math.round((token.expiresAt - Date.now()) / 1000)),
        scope: token.scope ?? null,
      };
    }

    case 'settings.getPaymentSettings': {
      const flute = createFluteClient();
      return await flute.settings.getPaymentSettings();
    }

    case 'transactions.list': {
      const flute = createFluteClient();
      // `pageIndex`, not `page`, and zero-based. The API ignores unknown
      // query parameters rather than rejecting them, so the old spelling
      // silently returned page 0 for every request.
      const pageIndex = numberOrUndefined(raw.pageIndex);
      const pageSize = numberOrUndefined(raw.pageSize);
      return await flute.transactions.list({
        ...(pageIndex !== undefined ? { pageIndex } : {}),
        ...(pageSize !== undefined ? { pageSize } : {}),
      });
    }

    case 'transactions.retrieve': {
      const flute = createFluteClient();
      const id = stringRequired(raw.transactionId, 'transactionId');
      return await flute.transactions.retrieve(id);
    }

    case 'transactions.calculateAmount': {
      const flute = createFluteClient();
      const baseAmount = numberRequired(raw.baseAmount, 'baseAmount');
      const pricingType = stringRequired(raw.pricingType, 'pricingType');
      const currencyCode = stringOrFallback(raw.currencyCode, 'USD');
      const tipAmount = numberOrUndefined(raw.tipAmount);
      return await flute.transactions.calculateAmount({
        baseAmount,
        pricingType: pricingType as 'Card' | 'Cash',
        currencyCode,
        ...(tipAmount !== undefined ? { tipAmount } : {}),
      });
    }

    case 'transactions.sale':
    case 'transactions.authorize': {
      const flute = createFluteClient();
      const params = buildCardTransactionParams(raw);
      return endpointId === 'transactions.sale'
        ? await flute.transactions.sale(params)
        : await flute.transactions.authorize(params);
    }

    case 'transactions.capture': {
      const flute = createFluteClient();
      const id = stringRequired(raw.transactionId, 'transactionId');
      const captureAmount = numberOrUndefined(raw.captureAmount);
      return await flute.transactions.capture(
        id,
        captureAmount !== undefined ? { captureAmount } : undefined,
      );
    }

    case 'transactions.void': {
      const flute = createFluteClient();
      const id = stringRequired(raw.transactionId, 'transactionId');
      return await flute.transactions.void(id);
    }

    case 'transactions.refund': {
      const flute = createFluteClient();
      const id = stringRequired(raw.transactionId, 'transactionId');
      const reversalAmount = numberOrUndefined(raw.reversalAmount);
      return await flute.transactions.refund(
        id,
        reversalAmount !== undefined ? { reversalAmount } : undefined,
      );
    }

    case 'paymentSessions.create': {
      const flute = createFluteClient();
      const amount = numberRequired(raw.amount, 'amount');
      const mode = stringOrUndefined(raw.mode);
      const customerId = stringOrUndefined(raw.customerId);
      const referenceId = stringOrUndefined(raw.referenceId);
      const tipAmount = numberOrUndefined(raw.tipAmount);
      const skipAddressVerification = booleanOrUndefined(raw.skipAddressVerification);
      return await flute.paymentSessions.create({
        amount,
        ...(mode !== undefined
          ? { mode: mode as 'Payment' | 'SaveMethod' | 'PaymentAndSave' }
          : {}),
        ...(customerId !== undefined ? { customerId } : {}),
        ...(referenceId !== undefined ? { referenceId } : {}),
        ...(tipAmount !== undefined ? { tipAmount } : {}),
        ...(skipAddressVerification !== undefined ? { skipAddressVerification } : {}),
      });
    }

    case 'paymentSessions.retrieve': {
      const flute = createFluteClient();
      const id = stringRequired(raw.paymentSessionId, 'paymentSessionId');
      return await flute.paymentSessions.retrieve(id);
    }

    case 'paymentSessions.cancel': {
      const flute = createFluteClient();
      const id = stringRequired(raw.paymentSessionId, 'paymentSessionId');
      await flute.paymentSessions.cancel(id);
      return { cancelled: true, paymentSessionId: id };
    }

    case 'webhooks.verifySignature': {
      const signatureHeader = stringRequired(raw.signatureHeader, 'signatureHeader');
      const idHeader = stringRequired(raw.idHeader, 'idHeader');
      const timestampHeader = stringRequired(raw.timestampHeader, 'timestampHeader');
      const rawRequestBody = stringRequired(raw.rawRequestBody, 'rawRequestBody');
      const overrideSecret = stringOrUndefined(raw.signatureSecret);
      const signatureSecret = overrideSecret ?? process.env.FLUTE_WEBHOOK_SECRET ?? '';
      if (!signatureSecret) {
        throw new Error(
          'No webhook secret available: set FLUTE_WEBHOOK_SECRET in .env.local or pass `signatureSecret` in the form.',
        );
      }
      const toleranceSeconds = numberOrUndefined(raw.toleranceSeconds);
      const valid = verifyWebhookSignature(
        { signatureHeader, idHeader, timestampHeader, rawRequestBody, signatureSecret },
        toleranceSeconds !== undefined ? { toleranceSeconds } : undefined,
      );
      return {
        valid,
        usedSecretFrom: overrideSecret ? 'form override' : 'FLUTE_WEBHOOK_SECRET env var',
        signedPayloadPreview: `${idHeader}.${timestampHeader}.${truncate(rawRequestBody, 64)}`,
      };
    }

    default:
      throw new Error(`Endpoint not wired in dispatch: ${endpointId}`);
  }
}

function buildCardTransactionParams(raw: Record<string, unknown>) {
  const baseAmount = numberRequired(raw.baseAmount, 'baseAmount');
  const currencyCode = stringOrFallback(raw.currencyCode, 'USD');
  const paymentProcessorId = stringOrUndefined(raw.paymentProcessorId);
  const pricingType = stringOrUndefined(raw.pricingType);
  const referenceId = stringOrUndefined(raw.referenceId);
  const isCustomerInitiatedTransaction = booleanOrUndefined(raw.isCustomerInitiatedTransaction);

  const cardNumber = stringRequired(raw.cardNumber, 'cardNumber').replace(/\s+/g, '');
  const securityCode = stringRequired(raw.securityCode, 'securityCode').trim();
  const expirationMonth = numberRequired(raw.expirationMonth, 'expirationMonth');
  const expirationYear = numberRequired(raw.expirationYear, 'expirationYear');

  if (expirationMonth < 1 || expirationMonth > 12) {
    throw new Error('expirationMonth must be between 1 and 12');
  }
  if (expirationYear < 2000 || expirationYear > 2100) {
    throw new Error('expirationYear must be a 4-digit calendar year');
  }
  if (!/^\d{12,19}$/.test(cardNumber)) {
    throw new Error('cardNumber must be 12-19 digits with no separators');
  }

  return {
    baseAmount,
    currencyCode,
    ...(paymentProcessorId !== undefined ? { paymentProcessorId } : {}),
    ...(pricingType !== undefined ? { pricingType: pricingType as 'Card' | 'Cash' } : {}),
    ...(referenceId !== undefined ? { referenceId } : {}),
    ...(isCustomerInitiatedTransaction !== undefined ? { isCustomerInitiatedTransaction } : {}),
    transactionDetails: {
      cardData: {
        paymentMethodDetails: {
          cardNumber,
          securityCode,
          expirationMonth,
          expirationYear,
        },
      },
    },
  };
}

function previewToken(token: string): string {
  if (token.length <= 16) return '•'.repeat(token.length);
  return `${token.slice(0, 8)}…${token.slice(-4)} (${token.length} chars)`;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}… (+${value.length - max} more chars)`;
}

function numberOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function numberRequired(value: unknown, name: string): number {
  const n = numberOrUndefined(value);
  if (n === undefined) throw new Error(`${name} is required and must be a number`);
  return n;
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function stringOrFallback(value: unknown, fallback: string): string {
  return stringOrUndefined(value) ?? fallback;
}

function stringRequired(value: unknown, name: string): string {
  const s = stringOrUndefined(value);
  if (!s) throw new Error(`${name} is required`);
  return s;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}

function serializeError(err: unknown): SerializedError {
  if (
    err instanceof FluteApiError ||
    err instanceof FluteAuthenticationError ||
    err instanceof FluteValidationError ||
    err instanceof FluteRateLimitError ||
    err instanceof FluteNetworkError ||
    err instanceof FluteConfigurationError ||
    err instanceof FluteWebhookError ||
    err instanceof FluteError
  ) {
    const anyErr = err as unknown as Record<string, unknown>;
    const payload = (anyErr.payload ?? anyErr.body) as Record<string, unknown> | undefined;
    const codeFromTop = typeof anyErr.code === 'string' ? (anyErr.code as string) : undefined;
    const codeFromPayload =
      payload && typeof payload.ErrorCode === 'string' ? (payload.ErrorCode as string) : undefined;
    const statusFromTop =
      typeof anyErr.httpStatus === 'number'
        ? (anyErr.httpStatus as number)
        : typeof anyErr.statusCode === 'number'
          ? (anyErr.statusCode as number)
          : typeof anyErr.status === 'number'
            ? (anyErr.status as number)
            : undefined;
    const statusFromPayload =
      payload && typeof payload.StatusCode === 'number' ? (payload.StatusCode as number) : undefined;
    const messageFromPayload =
      payload && typeof payload.Details === 'string' ? (payload.Details as string) : undefined;
    return {
      name: err.name,
      message: messageFromPayload
        ? `${err.message.replace(/\.$/, '')} — ${messageFromPayload}`
        : err.message,
      code: codeFromTop ?? codeFromPayload,
      status: statusFromTop ?? statusFromPayload,
      correlationId:
        typeof anyErr.correlationId === 'string' ? (anyErr.correlationId as string) : undefined,
      payload,
    };
  }
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return { name: 'Unknown', message: String(err) };
}
