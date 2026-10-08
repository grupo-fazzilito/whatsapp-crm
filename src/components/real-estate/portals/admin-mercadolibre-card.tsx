'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, Eye, EyeOff, Loader2, Store, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n/client';

// Admin panel card: the platform's Mercado Libre app (one app for every
// workspace). Same visual language as the AI providers card.

interface MlSettings {
  configured: boolean;
  source: 'panel' | 'env' | null;
  client_id: string;
  secret_hint: string | null;
  site_id: string;
  pkce: boolean;
  redirect_uri: string;
  mock: boolean;
}

const SITES = ['MPE', 'MLA', 'MLM', 'MCO', 'MLC', 'MLU'] as const;

const inputCls =
  'w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors';
const labelCls = 'block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5';
const btnCls = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export function AdminMercadoLibreCard() {
  const t = useT();
  const [s, setS] = useState<MlSettings | null>(null);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [site, setSite] = useState('MPE');
  const [pkce, setPkce] = useState(false);
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const apply = (d: MlSettings) => {
    setS(d);
    setClientId(d.client_id ?? '');
    setSite(d.site_id);
    setPkce(d.pkce);
  };

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/settings/mercadolibre', { cache: 'no-store' }).then(async (res) => {
      if (cancelled) return;
      if (res.ok) apply(await res.json());
      else setMsg({ ok: false, text: t('common.error') });
    });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true);
    setMsg(null);
    const res = await fetch('/api/admin/settings/mercadolibre', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setMsg({ ok: false, text: data.error ?? t('common.error') });
      return;
    }
    apply(data);
    setSecret('');
    setMsg({ ok: true, text: t('portals.admin.saved') });
  };

  if (!s) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <Loader2 className="size-5 animate-spin text-slate-500" aria-label={t('common.loading')} />
      </div>
    );
  }

  const dirty = clientId !== (s.client_id ?? '') || !!secret.trim() || site !== s.site_id || pkce !== s.pkce;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-4" aria-labelledby="ml-app-title">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1">
          <h2 id="ml-app-title" className="text-sm font-bold text-white flex items-center gap-2">
            <Store className="size-4 text-emerald-400" aria-hidden /> {t('portals.admin.title')}
          </h2>
          <p className="mt-1 text-xs text-slate-400">{t('portals.admin.subtitle')}</p>
        </div>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[11px] font-medium',
            s.source === 'panel' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : s.source === 'env' ? 'border-sky-500/30 bg-sky-500/10 text-sky-300' : 'border-slate-700 bg-slate-800 text-slate-400',
          )}
        >
          {s.source === 'panel' ? t('portals.admin.statusPanel') : s.source === 'env' ? t('portals.admin.statusEnv') : t('portals.admin.statusNone')}
          {s.secret_hint ? ` · ${s.secret_hint}` : ''}
        </span>
        <a href="https://developers.mercadolibre.com.pe/devcenter" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300">
          {t('portals.admin.devcenter')} <ExternalLink className="size-3" aria-hidden />
        </a>
      </div>

      <div>
        <p className={labelCls}>{t('portals.admin.redirectUri')}</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 break-all rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-200">{s.redirect_uri}</code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(s.redirect_uri);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className={cn(btnCls, 'border border-slate-700 text-slate-200 hover:bg-slate-800')}
            aria-label={t('portals.admin.copyRedirect')}
          >
            {copied ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">{t('portals.admin.redirectHelp')}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ml-client-id" className={labelCls}>{t('portals.admin.clientId')}</label>
          <input id="ml-client-id" inputMode="numeric" autoComplete="off" value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputCls + ' font-mono'} />
        </div>
        <div>
          <label htmlFor="ml-secret" className={labelCls}>{s.secret_hint ? t('portals.admin.replaceSecret') : t('portals.admin.secret')}</label>
          <div className="relative">
            <input
              id="ml-secret"
              type={show ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              className={inputCls + ' pr-10 font-mono'}
            />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? t('portals.admin.hide') : t('portals.admin.show')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        <div>
          <label htmlFor="ml-site" className={labelCls}>{t('portals.admin.site')}</label>
          <select id="ml-site" value={site} onChange={(e) => setSite(e.target.value)} className={inputCls}>
            {SITES.map((x) => (
              <option key={x} value={x}>{t(`portals.admin.sites.${x}`)}</option>
            ))}
          </select>
        </div>
        <label className="flex items-start gap-2 self-end pb-2 text-sm text-slate-300">
          <input type="checkbox" checked={pkce} onChange={(e) => setPkce(e.target.checked)} className="mt-0.5 size-4 accent-emerald-500" />
          <span>{t('portals.admin.pkce')}</span>
        </label>
      </div>

      {s.mock && <p className="text-xs text-amber-300">{t('portals.admin.mock')}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => save({ client_id: clientId.trim() || null, ...(secret.trim() ? { client_secret: secret.trim() } : {}), site_id: site, pkce })}
          className={cn(btnCls, 'bg-emerald-600 text-white hover:bg-emerald-500')}
        >
          {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {t('admin.settings.save')}
        </button>
        {s.source === 'panel' && (
          <button
            type="button"
            onClick={() => window.confirm(t('portals.admin.removeConfirm')) && save({ client_id: null, client_secret: null })}
            className={cn(btnCls, 'text-red-300 hover:bg-red-500/10')}
          >
            <Trash2 className="size-3.5" aria-hidden /> {t('portals.admin.remove')}
          </button>
        )}
        {msg && (
          <span role="status" className={cn('text-xs', msg.ok ? 'text-emerald-300' : 'text-red-300')}>
            {msg.text}
          </span>
        )}
      </div>
    </section>
  );
}
