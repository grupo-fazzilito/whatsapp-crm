'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useT } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { CHANNEL_STYLE, apiJson, selectClass, type AgentOption } from './channel-types';

interface CandidatePage {
  id: string;
  name: string;
  connected: 'here' | 'elsewhere' | null;
  instagram: { id: string; username: string | null; connected: 'here' | 'elsewhere' | null } | null;
}

interface Props {
  /** Error code from the OAuth callback redirect, if any. */
  error: string | null;
  agents: AgentOption[];
  onClose: () => void;
  onCreated: () => void;
}

/** Shown after Facebook Login redirects back to /channels?connect=meta. */
export function MetaConnectDialog({ error, agents, onClose, onCreated }: Props) {
  const t = useT();
  const [loading, setLoading] = useState(!error);
  const [pages, setPages] = useState<CandidatePage[]>([]);
  const [pageIds, setPageIds] = useState<string[]>([]);
  const [igIds, setIgIds] = useState<string[]>([]);
  const [purpose, setPurpose] = useState('');
  const [agentId, setAgentId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (error) return;
    let cancelled = false;
    apiJson<{ pages: CandidatePage[] }>('/api/channels/meta/connect')
      .then((d) => {
        if (cancelled) return;
        setPages(d.pages);
        setPageIds(d.pages.filter((p) => !p.connected).map((p) => p.id));
        setIgIds(d.pages.flatMap((p) => (p.instagram && !p.instagram.connected ? [p.instagram.id] : [])));
      })
      .catch(() => setPages([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [error]);

  const toggle = (list: string[], set: (v: string[]) => void, id: string, on: boolean) =>
    set(on ? [...list, id] : list.filter((x) => x !== id));

  const cancel = () => {
    fetch('/api/channels/meta/connect', { method: 'DELETE' }).catch(() => null);
    onClose();
  };

  const submit = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/channels/meta/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageIds, instagramIds: igIds, purpose: purpose || null, ai_agent_id: agentId || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && !data.created?.length) throw new Error(data.error ?? data.errors?.[0]?.error ?? t('common.error'));
      if (data.created?.length) toast.success(t('channels.meta.createdCount', { count: data.created.length }));
      for (const e of data.errors ?? []) toast.error(e.error);
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const Messenger = CHANNEL_STYLE.messenger;
  const Instagram = CHANNEL_STYLE.instagram;
  const noneLeft = pages.length > 0 && pageIds.length + igIds.length === 0;

  return (
    <Dialog open onOpenChange={(o) => !o && cancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('channels.meta.pickTitle')}</DialogTitle>
          <DialogDescription>{error ? t(`channels.meta.error.${error}`) : t('channels.meta.pickDescription')}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? null : pages.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('channels.meta.expired')}</p>
        ) : (
          <div className="grid gap-4">
            <ul className="divide-y divide-border rounded-md border border-border">
              {pages.map((p) => (
                <li key={p.id} className="grid gap-2 p-3">
                  <p className="text-sm font-medium text-foreground">{p.name}</p>
                  <Choice
                    icon={<Messenger.icon className="size-3.5" />}
                    tile={Messenger.tile}
                    label={t('channels.type.messenger')}
                    connected={p.connected}
                    checked={pageIds.includes(p.id)}
                    onChange={(on) => toggle(pageIds, setPageIds, p.id, on)}
                  />
                  {p.instagram ? (
                    <Choice
                      icon={<Instagram.icon className="size-3.5" />}
                      tile={Instagram.tile}
                      label={p.instagram.username ? `Instagram @${p.instagram.username}` : t('channels.type.instagram')}
                      connected={p.instagram.connected}
                      checked={igIds.includes(p.instagram.id)}
                      onChange={(on) => toggle(igIds, setIgIds, p.instagram!.id, on)}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">{t('channels.meta.noInstagram')}</p>
                  )}
                </li>
              ))}
            </ul>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="meta-purpose">{t('channels.form.purpose')}</Label>
                <Input id="meta-purpose" value={purpose} maxLength={80} placeholder={t('channels.form.purposePlaceholder')} onChange={(e) => setPurpose(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="meta-agent">{t('channels.form.agent')}</Label>
                <select id="meta-agent" className={selectClass} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="">{t('channels.noAgent')}</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={cancel}>
            {error || pages.length === 0 ? t('channels.done.close') : t('common.cancel')}
          </Button>
          {!error && pages.length > 0 && (
            <Button type="button" disabled={saving || noneLeft} onClick={submit}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {t('channels.meta.connectSelected')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Choice({
  icon,
  tile,
  label,
  connected,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  tile: string;
  label: string;
  connected: 'here' | 'elsewhere' | null;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const t = useT();
  return (
    <label className={cn('flex items-center gap-2 text-sm', connected && 'opacity-60')}>
      <input
        type="checkbox"
        className="size-4 accent-[var(--primary)]"
        disabled={!!connected}
        checked={checked && !connected}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={cn('flex size-6 items-center justify-center rounded-md', tile)}>{icon}</span>
      <span className="flex-1 text-foreground">{label}</span>
      {connected && (
        <span className="text-xs text-muted-foreground">
          {connected === 'here' ? t('channels.meta.alreadyHere') : t('channels.meta.alreadyElsewhere')}
        </span>
      )}
    </label>
  );
}
