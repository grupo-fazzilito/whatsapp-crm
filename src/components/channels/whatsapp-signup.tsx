'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Check, CheckCircle2, Cloud, ExternalLink, Info, Loader2, Smartphone, SmartphoneNfc, X } from 'lucide-react';
import { useT } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { apiJson, selectClass, type AgentOption, type ChannelDTO } from './channel-types';

// WhatsApp Embedded Signup (Meta's official onboarding) with the Facebook
// JS SDK. The SDK is loaded only while this dialog is open. Two paths:
//   - standard:    a number that is not on WhatsApp yet (or moved to Cloud API)
//   - coexistence: the number keeps working in the WhatsApp Business app
//                  on the phone (featureType whatsapp_business_app_onboarding)
// https://developers.facebook.com/docs/whatsapp/embedded-signup/implementation
// https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users

type Mode = 'standard' | 'coexistence';

interface SignupConfig {
  available: boolean;
  app_id: string | null;
  config_id: string | null;
  coex_config_id: string | null;
  graph_version: string;
}

interface FbLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}

interface FbSdk {
  init(opts: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(cb: (r: FbLoginResponse) => void, opts: Record<string, unknown>): void;
}

declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js';
const SDK_ID = 'facebook-jssdk';

/** Session info posted by the Embedded Signup popup. Only facebook.com origins are trusted. */
export function parseSignupMessage(origin: string, raw: unknown):
  | { kind: 'finish'; wabaId: string | null; phoneNumberId: string | null; businessId: string | null; event: string }
  | { kind: 'cancel'; step: string | null }
  | { kind: 'error'; message: string }
  | null {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return null;
  }
  if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) return null;
  let data: Record<string, unknown>;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>);
  } catch {
    return null;
  }
  if (!data || data.type !== 'WA_EMBEDDED_SIGNUP') return null;
  const event = String(data.event ?? '');
  const d = (data.data ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? v : null);
  if (event.startsWith('FINISH')) {
    return { kind: 'finish', event, wabaId: s(d.waba_id), phoneNumberId: s(d.phone_number_id), businessId: s(d.business_id) };
  }
  if (event === 'CANCEL' && d.error_message) return { kind: 'error', message: String(d.error_message) };
  if (event === 'CANCEL') return { kind: 'cancel', step: typeof d.current_step === 'string' ? d.current_step : null };
  if (event === 'ERROR') return { kind: 'error', message: String(d.error_message ?? 'Error') };
  return null;
}

function loadSdk(cfg: SignupConfig): Promise<FbSdk> {
  return new Promise((resolve, reject) => {
    const init = () => {
      window.FB!.init({ appId: cfg.app_id!, autoLogAppEvents: true, xfbml: false, version: cfg.graph_version });
      resolve(window.FB!);
    };
    if (window.FB) return init();
    window.fbAsyncInit = init;
    if (!document.getElementById(SDK_ID)) {
      const script = document.createElement('script');
      script.id = SDK_ID;
      script.src = SDK_SRC;
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      script.onerror = () => reject(new Error('sdk'));
      document.body.appendChild(script);
    }
  });
}

interface Result {
  channel: ChannelDTO;
  coexistence: boolean;
  warnings: string[];
}

interface Props {
  agents: AgentOption[];
  onCreated: () => void;
  onManual: () => void;
  onDone: () => void;
}

export function WhatsAppSignup({ agents, onCreated, onManual, onDone }: Props) {
  const t = useT();
  const [cfg, setCfg] = useState<SignupConfig | null>(null);
  const [sdk, setSdk] = useState<FbSdk | null>(null);
  const [sdkError, setSdkError] = useState(false);
  const [mode, setMode] = useState<Mode>('coexistence');
  const [agentId, setAgentId] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  // Pieces of one attempt: the code (FB.login callback) and the session info (postMessage).
  const attempt = useRef<{ code: string | null; session: { wabaId: string | null; phoneNumberId: string | null; businessId: string | null } | null; mode: Mode; sent: boolean } | null>(null);
  const waitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiJson<SignupConfig>('/api/channels/meta/embedded')
      .then(async (c) => {
        if (cancelled) return;
        setCfg(c);
        if (!c.available) return;
        try {
          const fb = await loadSdk(c);
          if (!cancelled) setSdk(fb);
        } catch {
          if (!cancelled) setSdkError(true);
        }
      })
      .catch(() => !cancelled && setCfg({ available: false, app_id: null, config_id: null, coex_config_id: null, graph_version: '' }));
    return () => {
      cancelled = true;
    };
  }, []);

  const fail = useCallback(
    (message: string) => {
      if (waitTimer.current) clearTimeout(waitTimer.current);
      attempt.current = null;
      setBusy(false);
      setStatus(null);
      toast.error(message);
    },
    [],
  );

  const submit = useCallback(async () => {
    const a = attempt.current;
    if (!a || a.sent || !a.code || !a.session?.wabaId) return;
    a.sent = true;
    if (waitTimer.current) clearTimeout(waitTimer.current);
    setStatus(t('metawa.signup.finishing'));
    try {
      const data = await apiJson<Result>('/api/channels/meta/embedded', {
        method: 'POST',
        body: JSON.stringify({
          code: a.code,
          waba_id: a.session.wabaId,
          phone_number_id: a.session.phoneNumberId,
          business_id: a.session.businessId,
          mode: a.mode,
          ai_agent_id: agentId || null,
          pin: a.mode === 'standard' && pin ? pin : null,
        }),
      });
      setResult(data);
      onCreated();
      toast.success(t('channels.connected', { name: data.channel.name }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      attempt.current = null;
      setBusy(false);
      setStatus(null);
    }
  }, [agentId, onCreated, pin, t]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = parseSignupMessage(event.origin, event.data);
      if (!msg || !attempt.current) return;
      if (msg.kind === 'finish') {
        attempt.current.session = { wabaId: msg.wabaId, phoneNumberId: msg.phoneNumberId, businessId: msg.businessId };
        void submit();
      } else if (msg.kind === 'cancel') {
        fail(t('metawa.signup.cancelled'));
      } else {
        fail(t('metawa.signup.metaError', { message: msg.message }));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [fail, submit, t]);

  useEffect(() => () => {
    if (waitTimer.current) clearTimeout(waitTimer.current);
  }, []);

  const launch = () => {
    if (!sdk || !cfg?.available) return;
    if (mode === 'standard' && pin && !/^\d{6}$/.test(pin)) {
      toast.error(t('metawa.signup.pinInvalid'));
      return;
    }
    attempt.current = { code: null, session: null, mode, sent: false };
    setBusy(true);
    setStatus(t('metawa.signup.inPopup'));
    const extras: Record<string, unknown> = { setup: {}, sessionInfoVersion: '3' };
    if (mode === 'coexistence') extras.featureType = 'whatsapp_business_app_onboarding';
    // Must run inside the click handler or browsers block the popup.
    sdk.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!attempt.current) return;
        if (!code) return fail(t('metawa.signup.cancelled'));
        attempt.current.code = code;
        if (attempt.current.session) return void submit();
        // The code lives 30 s: if the session info never arrives, stop waiting.
        setStatus(t('metawa.signup.finishing'));
        waitTimer.current = setTimeout(() => {
          if (attempt.current && !attempt.current.sent) fail(t('metawa.signup.noSession'));
        }, 15_000);
      },
      {
        config_id: mode === 'coexistence' ? cfg.coex_config_id ?? cfg.config_id : cfg.config_id,
        response_type: 'code',
        override_default_response_type: true,
        extras,
      },
    );
  };

  if (result) {
    const sync = (result.channel.settings?.coexistence_sync ?? {}) as Record<string, { request_id?: string; error?: string } | string>;
    return (
      <div className="grid gap-3" role="status">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          {t('metawa.signup.doneTitle', { number: result.channel.display_handle ?? result.channel.external_id })}
        </p>
        {result.coexistence ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>{t('metawa.signup.doneCoex1')}</li>
            <li>{typeof sync.history === 'object' && sync.history?.error ? t('metawa.signup.historyFailed') : t('metawa.signup.doneCoex2')}</li>
            <li>{t('metawa.signup.doneCoex3')}</li>
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('metawa.signup.doneStandard')}</p>
        )}
        {result.channel.status === 'error' && result.channel.status_detail && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-200">{result.channel.status_detail}</p>
        )}
        <p className="text-xs text-muted-foreground">{t('metawa.signup.payment')}</p>
        <Button type="button" onClick={onDone} className="justify-self-end">
          {t('channels.done.close')}
        </Button>
      </div>
    );
  }

  if (!cfg) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
      </p>
    );
  }

  if (!cfg.available) {
    // Same button as when it works, disabled, so it's clear where connecting happens.
    return (
      <div className="grid gap-3">
        <Button type="button" disabled className="h-10 bg-[#25D366] text-white hover:bg-[#1ebe5b]">
          {t('metawa.signup.connect')}
        </Button>
        <p role="note" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          {t('metawa.signup.notAvailable')}
        </p>
        <button type="button" className="justify-self-start text-xs text-muted-foreground underline underline-offset-2" onClick={onManual}>
          {t('metawa.signup.manual')}
        </button>
      </div>
    );
  }

  const options: { id: Mode; icon: typeof Smartphone; title: string; body: string; key: 'coex' | 'new' }[] = [
    { id: 'coexistence', icon: SmartphoneNfc, title: t('metawa.signup.coexTitle'), body: t('metawa.signup.coexBody'), key: 'coex' },
    { id: 'standard', icon: Cloud, title: t('metawa.signup.newTitle'), body: t('metawa.signup.newBody'), key: 'new' },
  ];
  const points = (key: 'coex' | 'new', kind: 'Pros' | 'Cons') => [1, 2, 3].map((n) => t(`metawa.signup.${key}${kind}.${n}`));

  return (
    <div className="grid gap-4">
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium text-foreground">{t('metawa.signup.question')}</legend>
        {options.map((o) => (
          <label
            key={o.id}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors focus-within:ring-2 focus-within:ring-ring',
              mode === o.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent',
            )}
          >
            <input type="radio" name="wa-mode" value={o.id} checked={mode === o.id} onChange={() => setMode(o.id)} className="mt-1 size-4 accent-primary" />
            <o.icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{o.title}</span>
              <span className="block text-xs text-muted-foreground">{o.body}</span>
              {mode === o.id && (
                <span className="mt-2 grid gap-2 sm:grid-cols-2">
                  {(['Pros', 'Cons'] as const).map((kind) => (
                    <span key={kind} className="block">
                      <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {kind === 'Pros' ? t('metawa.signup.pros') : t('metawa.signup.cons')}
                      </span>
                      <span className="mt-1 grid gap-1">
                        {points(o.key, kind).map((p) => (
                          <span key={p} className="flex gap-1.5 text-xs text-foreground">
                            {kind === 'Pros' ? (
                              <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                            ) : (
                              <X className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                            )}
                            <span>{p}</span>
                          </span>
                        ))}
                      </span>
                    </span>
                  ))}
                </span>
              )}
            </span>
          </label>
        ))}
      </fieldset>

      {mode === 'coexistence' ? (
        <div className="flex gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{t('metawa.signup.coexReq')}</p>
        </div>
      ) : (
        <div className="grid gap-1.5">
          <Label htmlFor="wa-pin">{t('metawa.signup.pin')}</Label>
          <Input
            id="wa-pin"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            aria-describedby="wa-pin-help"
          />
          <p id="wa-pin-help" className="text-xs text-muted-foreground">
            {t('metawa.signup.pinHelp')}
          </p>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="wa-agent">{t('channels.form.agent')}</Label>
        <select id="wa-agent" className={selectClass} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          <option value="">{t('channels.noAgent')}</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.enabled ? '' : ` (${t('channels.agentDisabled')})`}
            </option>
          ))}
        </select>
      </div>

      {sdkError && (
        <p role="alert" className="text-sm text-destructive">
          {t('metawa.signup.sdkError')}
        </p>
      )}

      <button
        type="button"
        onClick={launch}
        disabled={!sdk || busy}
        aria-describedby={status ? 'wa-signup-hint wa-signup-status' : 'wa-signup-hint'}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#25D366] px-4 text-sm font-medium text-white hover:bg-[#1ebe5b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {busy || !sdk ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ExternalLink className="size-4" aria-hidden />}
        {t('metawa.signup.connect')}
      </button>
      <p id="wa-signup-hint" className="text-xs text-muted-foreground">
        {t('metawa.signup.connectHint')}
      </p>
      <p id="wa-signup-status" aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
        {status ?? ''}
      </p>

      <button type="button" className="justify-self-start text-xs text-muted-foreground underline underline-offset-2" onClick={onManual}>
        {t('metawa.signup.manual')}
      </button>
    </div>
  );
}
