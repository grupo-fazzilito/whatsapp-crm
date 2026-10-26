'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { api } from '@/components/business/api';
import { cn } from '@/lib/utils';
import { API_SCOPES, maskedKey, type ApiScope } from '@/lib/public-api/keys';
import { CodeSample, SecretDialog } from './secret-dialog';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const EXPIRY_DAYS = [0, 30, 90, 365] as const;

const STATUS_CLS = {
  active: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  revoked: 'border-border bg-muted text-muted-foreground',
  expired: 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
} as const;

function keyStatus(k: ApiKey): keyof typeof STATUS_CLS {
  if (k.revoked_at) return 'revoked';
  if (k.expires_at && new Date(k.expires_at).getTime() < Date.now()) return 'expired';
  return 'active';
}

/** Settings → Integrations: the workspace's keys for the public REST API (/api/v1). */
export function ApiKeysCard() {
  const { t, locale } = useI18n();
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const fmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PE', { dateStyle: 'medium' });
  const base = typeof window === 'undefined' ? '/api/v1' : `${window.location.origin}/api/v1`;

  const load = useCallback(async () => {
    try {
      const body = await api<{ keys: ApiKey[] }>('/api/integrations/api-keys');
      setKeys(body.keys);
      setFailed(false);
    } catch {
      setFailed(true);
      setKeys((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load();
  }, [load]);

  const revoke = async () => {
    if (!revoking) return;
    try {
      await api(`/api/integrations/api-keys/${revoking.id}`, { method: 'DELETE' });
      toast.success(t('integrations.keys.revoked_toast'));
      await load();
    } catch {
      toast.error(t('integrations.common.error'));
    }
  };

  // Revoked keys stay listed (audit trail) but after the active ones.
  const sorted = [...(keys ?? [])].sort((a, b) => Number(!!a.revoked_at) - Number(!!b.revoked_at));

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 sm:flex-nowrap">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" aria-hidden />
            {t('integrations.keys.title')}
          </CardTitle>
          <CardDescription>{t('integrations.keys.description')}</CardDescription>
          <a href={`/${locale === 'en' ? 'en' : 'es'}/api-docs`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline">
            {t('integrations.docsLink')}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
        <Button className="shrink-0" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden />
          {t('integrations.keys.create')}
        </Button>
      </CardHeader>
      <CardContent>
        {failed && <p role="alert" className="mb-3 text-sm text-destructive">{t('integrations.common.error')}</p>}
        {!keys ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t('integrations.common.loading')} />
          </div>
        ) : keys.length === 0 ? (
          !failed && <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('integrations.keys.empty')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {sorted.map((k) => {
              const status = keyStatus(k);
              return (
                <li key={k.id} className={cn('flex flex-wrap items-start gap-3 p-3 sm:flex-nowrap', status !== 'active' && 'opacity-70')}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{k.name}</span>
                      <Badge variant="outline" className={STATUS_CLS[status]}>
                        {t(`integrations.keys.${status}`)}
                      </Badge>
                    </div>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">{maskedKey(k.prefix)}</p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <span key={s} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                          {t(`integrations.keys.scopeLabels.${s}`)}
                        </span>
                      ))}
                    </p>
                    <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                      <div className="flex gap-1">
                        <dt>{t('integrations.keys.created')}:</dt>
                        <dd className="text-foreground">{fmt.format(new Date(k.created_at))}</dd>
                      </div>
                      <div className="flex gap-1">
                        <dt>{t('integrations.keys.lastUsed')}:</dt>
                        <dd className="text-foreground">{k.last_used_at ? fmt.format(new Date(k.last_used_at)) : t('integrations.common.never')}</dd>
                      </div>
                      <div className="flex gap-1">
                        <dt>{t('integrations.keys.expires')}:</dt>
                        <dd className="text-foreground">{k.expires_at ? fmt.format(new Date(k.expires_at)) : t('integrations.keys.expiresNever')}</dd>
                      </div>
                    </dl>
                  </div>
                  {status === 'active' && (
                    <Button variant="destructive" size="sm" onClick={() => setRevoking(k)}>
                      <Trash2 className="size-3.5" aria-hidden />
                      {t('integrations.keys.revoke')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <CreateKeyDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(newSecret) => {
          setCreating(false);
          setSecret(newSecret);
          void load();
        }}
      />

      <SecretDialog
        secret={secret}
        title={t('integrations.keys.secretTitle')}
        body={t('integrations.keys.secretBody')}
        label={t('integrations.keys.secretLabel')}
        onClose={() => setSecret(null)}
      >
        <CodeSample
          title={t('integrations.keys.usageTitle')}
          body={t('integrations.keys.usageBody', { base })}
          code={`curl ${base}/me \\\n  -H "Authorization: Bearer $WHASALIA_API_KEY"`}
        />
      </SecretDialog>

      <ConfirmationDialog
        isOpen={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={t('integrations.keys.revokeTitle', { name: revoking?.name ?? '' })}
        description={t('integrations.keys.revokeBody')}
        confirmText={t('integrations.keys.revoke')}
        cancelText={t('integrations.common.cancel')}
        onConfirm={revoke}
        variant="destructive"
      />
    </Card>
  );
}

function CreateKeyDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (secret: string) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Set<ApiScope>>(new Set());
  const [days, setDays] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseId = useId();

  const reset = () => {
    setName('');
    setScopes(new Set());
    setDays(0);
    setError(null);
  };

  const toggle = (s: ApiScope, on: boolean) =>
    setScopes((prev) => {
      const next = new Set(prev);
      if (on) next.add(s);
      else next.delete(s);
      return next;
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError(t('integrations.keys.errors.name_required'));
    if (!scopes.size) return setError(t('integrations.keys.errors.scopes_required'));
    setBusy(true);
    try {
      const body = await api<{ secret: string }>('/api/integrations/api-keys', {
        method: 'POST',
        body: { name: name.trim(), scopes: [...scopes], expires_in_days: days },
      });
      reset();
      onCreated(body.secret);
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      const key = `integrations.keys.errors.${code}`;
      const msg = t(key);
      setError(msg === key ? t('integrations.keys.errors.generic') : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o || busy) return;
        reset();
        onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t('integrations.keys.createTitle')}</DialogTitle>
            <DialogDescription>{t('integrations.keys.createDescription')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <label htmlFor={`${baseId}-name`} className="text-sm font-medium text-foreground">
                {t('integrations.keys.name')}
              </label>
              <Input id={`${baseId}-name`} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder={t('integrations.keys.namePlaceholder')} autoFocus />
            </div>
            <fieldset className="grid gap-1.5">
              <legend className="mb-1.5 text-sm font-medium text-foreground">{t('integrations.keys.scopes')}</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {API_SCOPES.map((s) => (
                  <label key={s} className="flex items-start gap-2 rounded-md border border-border px-2.5 py-2 text-sm text-foreground has-checked:border-primary has-checked:bg-primary/5">
                    <input type="checkbox" checked={scopes.has(s)} onChange={(e) => toggle(s, e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" />
                    <span className="min-w-0">
                      {t(`integrations.keys.scopeLabels.${s}`)}
                      <span className="block font-mono text-[11px] text-muted-foreground">{s}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-1.5">
              <label htmlFor={`${baseId}-expiry`} className="text-sm font-medium text-foreground">
                {t('integrations.keys.expires')}
              </label>
              <select
                id={`${baseId}-expiry`}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {EXPIRY_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d ? t('integrations.keys.expiresDays', { days: d }) : t('integrations.keys.expiresNever')}
                  </option>
                ))}
              </select>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                reset();
                onClose();
              }}
            >
              {t('integrations.common.cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('integrations.keys.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
