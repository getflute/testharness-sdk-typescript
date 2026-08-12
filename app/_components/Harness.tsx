'use client';

import { useMemo, useState, useTransition } from 'react';
import { runEndpoint, type RunResult } from '@/app/actions';
import {
  ENDPOINTS,
  NAMESPACES,
  findEndpoint,
  type EndpointSpec,
  type ParamSpec,
} from '@/lib/endpoints';
import type { HarnessConfigStatus, MerchantSnapshot, MerchantSnapshotError } from '@/lib/flute';
import { TEST_CARDS, type TestCard } from '@/lib/test-cards';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Merchant = MerchantSnapshot | MerchantSnapshotError | null;

type Props = {
  config: HarnessConfigStatus;
  merchant: Merchant;
};

const BOOLEAN_OPTIONS = [
  { value: 'true', label: 'true' },
  { value: 'false', label: 'false' },
] as const;

export default function Harness({ config, merchant }: Props) {
  const firstImplemented = useMemo(() => ENDPOINTS.find((e) => e.implemented), []);
  const [selectedId, setSelectedId] = useState<string>(firstImplemented?.id ?? ENDPOINTS[0].id);

  const defaultProcessorId =
    merchant && merchant.ok ? (merchant.defaultProcessorId ?? '') : '';

  // A Dual Pricing merchant has two prices per transaction and the gateway
  // refuses to guess — omitting `pricingType` fails with `CardPrice must be
  // provided for ZCP option DualPricing`. Prefill it so the forms work out of
  // the box, and leave it empty elsewhere where it is meaningless.
  const defaultPricingType =
    merchant && merchant.ok && merchant.zeroCostProcessingOption === 'DualPricing' ? 'Card' : '';

  /**
   * Pick a sensible test-card default based on what the merchant has:
   *   - TSYS only → 4012000098765439 (CVV 999)
   *   - SandboxCard → 4111111111111111 (generic approve)
   *   - mixed / unknown → leave the catalog default ('4111111111111111')
   */
  const defaultTestCard: TestCard | null = useMemo(() => {
    if (!merchant?.ok) return null;
    const types = new Set(merchant.processors.map((p) => p.type));
    const hasSandbox = types.has('SandboxCard');
    const hasTsys = types.has('Tsys');
    if (hasTsys && !hasSandbox) {
      return TEST_CARDS.find((c) => c.id === 'tsys-sandbox') ?? null;
    }
    if (hasSandbox) {
      return TEST_CARDS.find((c) => c.id === 'sandbox-approve') ?? null;
    }
    return null;
  }, [merchant]);

  const [paramsByEndpoint, setParamsByEndpoint] = useState<Record<string, Record<string, string>>>(
    () => {
      const init: Record<string, Record<string, string>> = {};
      for (const ep of ENDPOINTS) {
        const fields: Record<string, string> = {};
        for (const p of ep.params) {
          if (p.name === 'paymentProcessorId' && defaultProcessorId) {
            fields[p.name] = defaultProcessorId;
          } else if (p.name === 'pricingType' && defaultPricingType) {
            fields[p.name] = defaultPricingType;
          } else if (defaultTestCard && ep.acceptsTestCard) {
            switch (p.name) {
              case 'cardNumber':
                fields[p.name] = defaultTestCard.cardNumber;
                break;
              case 'securityCode':
                fields[p.name] = defaultTestCard.securityCode;
                break;
              case 'expirationMonth':
                fields[p.name] = String(defaultTestCard.expirationMonth);
                break;
              case 'expirationYear':
                fields[p.name] = String(defaultTestCard.expirationYear);
                break;
              default:
                fields[p.name] = p.default !== undefined ? String(p.default) : '';
            }
          } else {
            fields[p.name] = p.default !== undefined ? String(p.default) : '';
          }
        }
        init[ep.id] = fields;
      }
      return init;
    },
  );
  const [results, setResults] = useState<Record<string, RunResult | undefined>>({});
  const [armed, setArmed] = useState<string | null>(null);
  const [lastTransactionId, setLastTransactionId] = useState<string>('');
  const [lastPaymentSessionId, setLastPaymentSessionId] = useState<string>('');
  const [isPending, startTransition] = useTransition();

  const selected = findEndpoint(selectedId)!;
  const result = results[selectedId];
  const params = paramsByEndpoint[selectedId] ?? {};

  function setParam(name: string, value: string) {
    setParamsByEndpoint((prev) => ({
      ...prev,
      [selectedId]: { ...prev[selectedId], [name]: value },
    }));
    if (armed === selectedId) setArmed(null);
  }

  function applyTestCard(cardId: string) {
    const card = TEST_CARDS.find((c) => c.id === cardId);
    if (!card) return;
    setParamsByEndpoint((prev) => ({
      ...prev,
      [selectedId]: {
        ...prev[selectedId],
        cardNumber: card.cardNumber,
        securityCode: card.securityCode,
        expirationMonth: String(card.expirationMonth),
        expirationYear: String(card.expirationYear),
      },
    }));
  }

  const isProduction = config.ready && config.environment === 'production';
  const requiresArming = selected.mutating === true;
  const isArmed = armed === selectedId;
  const cannotRun = !config.ready || !selected.implemented || isPending;

  function onRun() {
    if (requiresArming && !isArmed) {
      setArmed(selectedId);
      return;
    }
    startTransition(async () => {
      const res = await runEndpoint({ endpointId: selectedId, params });
      setResults((prev) => ({ ...prev, [selectedId]: res }));
      setArmed(null);
      if (res.ok && res.data && typeof res.data === 'object') {
        const obj = res.data as Record<string, unknown>;
        if (typeof obj.transactionId === 'string' && obj.transactionId) {
          setLastTransactionId(obj.transactionId);
        }
        if (
          (selectedId === 'paymentSessions.create' ||
            selectedId === 'paymentSessions.retrieve') &&
          typeof obj.id === 'string' &&
          obj.id
        ) {
          setLastPaymentSessionId(obj.id);
        }
      }
    });
  }

  function lastIdFor(paramName: string): string {
    if (paramName === 'transactionId') return lastTransactionId;
    if (paramName === 'paymentSessionId') return lastPaymentSessionId;
    return '';
  }

  return (
    <div className="grid grid-cols-[280px_minmax(0,1fr)] min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Sidebar selectedId={selectedId} onSelect={setSelectedId} />
      <div className="flex flex-col">
        <TopBar config={config} merchant={merchant} />
        {selected.mutating && config.ready && (
          <MutatingBanner merchant={merchant} isProduction={isProduction} />
        )}
        <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 max-w-[1600px] w-full mx-auto">
          <RequestPanel
            endpoint={selected}
            params={params}
            onChange={setParam}
            onRun={onRun}
            onApplyTestCard={applyTestCard}
            isPending={isPending}
            disabled={cannotRun}
            isArmed={isArmed}
            requiresArming={requiresArming}
            isProduction={isProduction}
            lastIdFor={lastIdFor}
          />
          <ResponsePanel result={result} endpoint={selected} />
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="border-r bg-white dark:bg-zinc-900 dark:border-zinc-800">
      <div className="px-4 pt-5 pb-3">
        <div className="font-semibold text-sm tracking-tight">Flute SDK</div>
        <div className="text-xs text-zinc-500 mt-0.5">Test harness</div>
      </div>
      <Separator />
      <ScrollArea className="h-[calc(100vh-72px)]">
        <nav className="p-2 space-y-4">
          {NAMESPACES.map((ns) => {
            const endpoints = ENDPOINTS.filter((e) => e.namespace === ns.id);
            if (endpoints.length === 0) return null;
            return (
              <div key={ns.id}>
                <div className="px-2 py-1 text-[11px] font-medium tracking-wide uppercase text-zinc-500">
                  {ns.label}
                </div>
                <div className="flex flex-col">
                  {endpoints.map((ep) => (
                    <button
                      key={ep.id}
                      onClick={() => onSelect(ep.id)}
                      className={`text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 transition-colors ${
                        selectedId === ep.id
                          ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50'
                          : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                      }`}
                    >
                      <span className="flex-1 truncate">{ep.label}</span>
                      {!ep.implemented && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                          soon
                        </Badge>
                      )}
                      {ep.mutating && ep.implemented && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] py-0 px-1.5 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                        >
                          mut
                        </Badge>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      </ScrollArea>
    </aside>
  );
}

function TopBar({ config, merchant }: { config: HarnessConfigStatus; merchant: Merchant }) {
  return (
    <div className="border-b bg-white dark:bg-zinc-900 dark:border-zinc-800">
      <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="font-mono text-xs">
            sdk v{config.sdkVersion}
          </Badge>
          {config.ready ? (
            <>
              <Badge
                className={
                  config.environment === 'production'
                    ? 'bg-rose-600 hover:bg-rose-600 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-600 text-white'
                }
              >
                {config.environment.toUpperCase()}
              </Badge>
              <span className="text-xs text-zinc-500 font-mono">
                clientId: {config.clientIdMasked}
              </span>
              {config.hasWebhookSecret && (
                <Badge variant="secondary" className="text-[10px]">
                  webhook secret loaded
                </Badge>
              )}
              {merchant?.ok && merchant.companyName && (
                <Badge variant="outline" className="text-xs">
                  {merchant.companyName}
                </Badge>
              )}
              {merchant?.ok && merchant.processors.length === 0 && (
                <Badge
                  variant="outline"
                  className="text-xs font-mono bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                >
                  no processors
                </Badge>
              )}
              {merchant?.ok &&
                merchant.processors.map((p) => (
                  <Badge
                    key={p.id}
                    variant="outline"
                    className="text-[10px] font-mono"
                    title={`id: ${p.id}`}
                  >
                    {p.type}
                    {p.name ? ` · ${p.name}` : ''}
                    {p.isDefault ? ' · default' : ''}
                  </Badge>
                ))}
            </>
          ) : (
            <Badge variant="destructive">credentials missing</Badge>
          )}
        </div>
        <div className="flex-1" />
        <a
          href="https://www.npmjs.com/package/@getflute/sdk"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          @getflute/sdk on npm ↗
        </a>
      </div>
      {!config.ready && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border-t border-amber-200 dark:border-amber-900 px-6 py-2 text-sm text-amber-900 dark:text-amber-200">
          Missing env vars: <span className="font-mono">{config.missing.join(', ')}</span>. Copy{' '}
          <code className="font-mono">.env.local.example</code> to{' '}
          <code className="font-mono">.env.local</code>, fill in the credentials, and restart{' '}
          <code className="font-mono">npm run dev</code>.
        </div>
      )}
      {merchant && !merchant.ok && (
        <div className="bg-rose-50 dark:bg-rose-950/40 border-t border-rose-200 dark:border-rose-900 px-6 py-2 text-sm text-rose-900 dark:text-rose-200">
          Could not load merchant settings: {merchant.message}
        </div>
      )}
    </div>
  );
}

function MutatingBanner({
  merchant,
  isProduction,
}: {
  merchant: Merchant;
  isProduction: boolean;
}) {
  const noProcessors = merchant?.ok && merchant.processors.length === 0;
  return (
    <div
      className={
        isProduction
          ? 'bg-rose-100 border-y border-rose-300 dark:bg-rose-950/60 dark:border-rose-900 px-6 py-2 text-sm text-rose-900 dark:text-rose-100'
          : 'bg-amber-50 border-y border-amber-200 dark:bg-amber-950/40 dark:border-amber-900 px-6 py-2 text-sm text-amber-900 dark:text-amber-100'
      }
    >
      <div className="max-w-[1600px] mx-auto flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium">
          {isProduction ? '⚠ Production environment.' : 'Sandbox environment.'}
        </span>
        <span>
          {isProduction
            ? 'Mutating endpoints will create real transactions on real cards. Click Run twice to confirm.'
            : 'Mutating endpoints create real records on the sandbox merchant. Click Run twice to confirm.'}
        </span>
        {noProcessors && (
          <span>
            • This merchant has no payment processors configured, so{' '}
            <code className="font-mono">sale</code>/<code className="font-mono">authorize</code>{' '}
            will fail. <code className="font-mono">paymentSessions.*</code> still works.
          </span>
        )}
      </div>
    </div>
  );
}

function RequestPanel({
  endpoint,
  params,
  onChange,
  onRun,
  onApplyTestCard,
  isPending,
  disabled,
  isArmed,
  requiresArming,
  isProduction,
  lastIdFor,
}: {
  endpoint: EndpointSpec;
  params: Record<string, string>;
  onChange: (name: string, value: string) => void;
  onRun: () => void;
  onApplyTestCard: (cardId: string) => void;
  isPending: boolean;
  disabled: boolean;
  isArmed: boolean;
  requiresArming: boolean;
  isProduction: boolean;
  lastIdFor: (paramName: string) => string;
}) {
  const noParams = endpoint.params.length === 0;
  const grouped = useMemo(() => groupParams(endpoint.params), [endpoint.params]);
  const buttonLabel = isPending
    ? 'Running…'
    : requiresArming && !isArmed
      ? isProduction
        ? 'Run (REAL CHARGE — click again to confirm)'
        : 'Run (click again to confirm)'
      : 'Run';
  const buttonClasses = requiresArming
    ? isProduction
      ? 'bg-rose-700 hover:bg-rose-800 text-white'
      : 'bg-amber-600 hover:bg-amber-700 text-white'
    : '';
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start gap-2 flex-wrap">
          <CardTitle className="text-base">{endpoint.label}</CardTitle>
          <Badge variant="outline" className="font-mono text-[10px]">
            {endpoint.namespace}
          </Badge>
          {endpoint.mutating && (
            <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              mutating
            </Badge>
          )}
          {!endpoint.implemented && <Badge variant="secondary">coming soon</Badge>}
        </div>
        <code className="block text-xs font-mono text-zinc-600 dark:text-zinc-400 mt-1">
          {endpoint.signature}
        </code>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">{endpoint.description}</p>
        {endpoint.notes && (
          <div className="mt-2 text-xs rounded-md bg-zinc-100 dark:bg-zinc-800 px-3 py-2 text-zinc-700 dark:text-zinc-300">
            <span className="font-medium">Note:</span> {endpoint.notes}
          </div>
        )}
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4">
        {endpoint.acceptsTestCard && (
          <TestCardPicker onApply={onApplyTestCard} cardNumber={params.cardNumber ?? ''} />
        )}
        {noParams ? (
          <div className="rounded-md border border-dashed border-zinc-200 dark:border-zinc-800 p-4 text-sm text-zinc-500">
            No parameters — just click <span className="font-medium">Run</span>.
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {grouped.map(({ group, items }) => (
              <fieldset
                key={group ?? 'default'}
                className={
                  group
                    ? 'rounded-md border border-zinc-200 dark:border-zinc-800 p-4 grid gap-3'
                    : 'grid gap-3'
                }
              >
                {group && (
                  <legend className="px-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                    {group}
                  </legend>
                )}
                {items.map((p) => (
                  <ParamField
                    key={p.name}
                    spec={p}
                    value={params[p.name] ?? ''}
                    onChange={(v) => onChange(p.name, v)}
                    suggestion={lastIdFor(p.name)}
                  />
                ))}
              </fieldset>
            ))}
          </div>
        )}
        <div className="mt-auto pt-2 flex items-center gap-3 flex-wrap">
          <Button
            onClick={onRun}
            disabled={disabled}
            size="lg"
            className={buttonClasses}
          >
            {buttonLabel}
          </Button>
          <span className="text-xs text-zinc-500">
            {endpoint.implemented
              ? 'Server-side call via Server Action'
              : 'Disabled (not yet wired)'}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function groupParams(params: readonly ParamSpec[]) {
  const groups: Array<{ group: string | undefined; items: ParamSpec[] }> = [];
  for (const p of params) {
    const key = p.group;
    let entry = groups.find((g) => g.group === key);
    if (!entry) {
      entry = { group: key, items: [] };
      groups.push(entry);
    }
    entry.items.push(p);
  }
  return groups;
}

function TestCardPicker({
  onApply,
  cardNumber,
}: {
  onApply: (id: string) => void;
  cardNumber: string;
}) {
  const matched = TEST_CARDS.find((c) => c.cardNumber === cardNumber);
  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3 grid gap-2 bg-zinc-50/60 dark:bg-zinc-900/40">
      <div className="flex items-center gap-2">
        <Label className="text-xs font-medium">Test card preset</Label>
        {matched && (
          <Badge variant="secondary" className="text-[10px]">
            {matched.processor}
          </Badge>
        )}
      </div>
      <Select value={matched?.id ?? ''} onValueChange={(v) => onApply(v ?? '')}>
        <SelectTrigger>
          <SelectValue placeholder="Pick a sandbox / TSYS test card…" />
        </SelectTrigger>
        <SelectContent className="max-h-[420px]">
          {TEST_CARDS.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {matched && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Expected: {matched.expected}
        </p>
      )}
      {!matched && cardNumber && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Not a known test PAN. Behaviour depends on the merchant&apos;s processor — only use values
          you know are sandbox-safe.
        </p>
      )}
    </div>
  );
}

function ParamField({
  spec,
  value,
  onChange,
  suggestion,
}: {
  spec: ParamSpec;
  value: string;
  onChange: (v: string) => void;
  suggestion?: string;
}) {
  const id = `param-${spec.name}`;
  const optionList =
    spec.type === 'boolean'
      ? BOOLEAN_OPTIONS.map((o) => ({ value: o.value, label: o.label }))
      : (spec.options ?? []);
  const showSuggestion = Boolean(suggestion) && suggestion !== value;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs flex items-center gap-2">
        <span className="font-mono">{spec.label}</span>
        {spec.required && <span className="text-rose-600">*</span>}
        <span className="text-zinc-400 font-normal">{spec.type}</span>
        {spec.sensitive && (
          <Badge variant="outline" className="text-[10px] py-0 px-1.5">
            sensitive
          </Badge>
        )}
        {showSuggestion && (
          <button
            type="button"
            onClick={() => onChange(suggestion!)}
            className="ml-auto text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:hover:bg-emerald-900/60 transition-colors"
            title={suggestion}
          >
            use last · {suggestion!.slice(0, 8)}…
          </button>
        )}
      </Label>
      {spec.type === 'select' || spec.type === 'boolean' ? (
        <Select value={value || ''} onValueChange={(v) => onChange(v ?? '')}>
          <SelectTrigger id={id}>
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {optionList.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : spec.type === 'textarea' ? (
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={spec.placeholder}
          rows={5}
          className="font-mono text-xs"
        />
      ) : (
        <Input
          id={id}
          type={spec.type === 'number' ? 'number' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={spec.placeholder}
          className="font-mono"
        />
      )}
      {spec.description && <p className="text-xs text-zinc-500">{spec.description}</p>}
    </div>
  );
}

function ResponsePanel({
  result,
  endpoint,
}: {
  result: RunResult | undefined;
  endpoint: EndpointSpec;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <CardTitle className="text-base">Response</CardTitle>
          {result && (
            <>
              <Badge
                className={
                  result.ok
                    ? 'bg-emerald-600 hover:bg-emerald-600 text-white'
                    : 'bg-rose-600 hover:bg-rose-600 text-white'
                }
              >
                {result.ok ? 'OK' : 'ERROR'}
              </Badge>
              {result.error?.status !== undefined && (
                <Badge variant="outline" className="font-mono">
                  {result.error.status}
                </Badge>
              )}
              <Badge variant="outline" className="font-mono">
                {result.durationMs} ms
              </Badge>
              <span className="text-xs text-zinc-500">
                {new Date(result.startedAt).toLocaleTimeString()}
              </span>
            </>
          )}
        </div>
        {!result && (
          <p className="text-xs text-zinc-500 mt-1">
            No response yet. Configure inputs and click Run.
          </p>
        )}
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3">
        {result?.error && <ErrorBlock error={result.error} />}
        {result?.ok && endpoint.id === 'paymentSessions.create' && (
          <CheckoutShortcut data={result.data} />
        )}
        {result && <JsonBlock value={result.ok ? result.data : result.error?.payload ?? null} />}
        {result?.ok && endpoint.id === 'webhooks.verifySignature' && (
          <p className="text-xs text-zinc-500">
            <code>valid: false</code> means the signature did not match. <code>valid: true</code>{' '}
            confirms an authentic, in-tolerance delivery.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function CheckoutShortcut({ data }: { data: unknown }) {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  const checkoutUrl = typeof obj.checkoutUrl === 'string' ? obj.checkoutUrl : null;
  const checkoutUrlShort = typeof obj.checkoutUrlShort === 'string' ? obj.checkoutUrlShort : null;
  if (!checkoutUrl && !checkoutUrlShort) return null;
  return (
    <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-sm flex flex-wrap items-center gap-2">
      <span className="text-emerald-900 dark:text-emerald-200 font-medium">
        Hosted checkout ready —
      </span>
      {checkoutUrl && (
        <a
          href={checkoutUrl}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs underline text-emerald-900 dark:text-emerald-200 hover:no-underline break-all"
        >
          open checkoutUrl ↗
        </a>
      )}
      {checkoutUrlShort && (
        <a
          href={checkoutUrlShort}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs underline text-emerald-900 dark:text-emerald-200 hover:no-underline break-all"
        >
          short ↗
        </a>
      )}
    </div>
  );
}

function ErrorBlock({
  error,
}: {
  error: NonNullable<RunResult['error']>;
}) {
  return (
    <div className="rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 p-3 text-sm">
      <div className="font-mono text-rose-900 dark:text-rose-200 font-medium">
        {error.name}
        {error.code ? ` · ${error.code}` : ''}
      </div>
      <div className="text-rose-800 dark:text-rose-300 mt-1">{error.message}</div>
      {error.correlationId && (
        <div className="mt-2 text-xs">
          correlationId:{' '}
          <code className="font-mono">{error.correlationId}</code>
        </div>
      )}
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text === undefined) text = 'undefined';
  return (
    <ScrollArea className="rounded-md border bg-zinc-950 dark:bg-black text-zinc-100 max-h-[60vh]">
      <pre className="text-xs font-mono p-4 leading-relaxed whitespace-pre-wrap break-all">
        {text}
      </pre>
    </ScrollArea>
  );
}
