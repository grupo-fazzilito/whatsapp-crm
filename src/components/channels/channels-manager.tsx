'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Bot, Loader2, Plus, Radio } from 'lucide-react';
import { useI18n, useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { apiJson, type AgentOption, type ChannelDTO, type ChannelFeatures } from './channel-types';
import { ChannelCard } from './channel-card';
import { mainChannelIds } from '@/lib/billing/accounts-model';
import { ConnectChannelDialog } from './connect-channel-dialog';
import { EditChannelDialog } from './edit-channel-dialog';
import { MetaConnectDialog } from './meta-connect-dialog';
import { WelcomeMenuDialog } from './welcome-menu-dialog';

const noopSubscribe = () => () => {};

/** Free plan: unlimited accounts or not, and when the extra accounts get disconnected. */
interface AccountsPlan {
  unlimited: boolean;
  extra_since: string | null;
  disconnect_on: string | null;
}

const NO_FEATURES: ChannelFeatures = { metaOAuth: false, tiktok: false, tiktokConnect: false, tiktokSandbox: false, platformVerifyToken: false };

export function ChannelsManager() {
  const t = useT();
  const { locale } = useI18n();
  const { can, workspace } = useWorkspace();
  const isAdmin = can('admin');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [channels, setChannels] = useState<ChannelDTO[]>([]);
  const [features, setFeatures] = useState<ChannelFeatures>(NO_FEATURES);
  const [accounts, setAccounts] = useState<AccountsPlan>({ unlimited: true, extra_since: null, disconnect_on: null });
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectOpen, setConnectOpen] = useState(false);
  const [editing, setEditing] = useState<ChannelDTO | null>(null);
  const [deleting, setDeleting] = useState<ChannelDTO | null>(null);
  const [menuChannel, setMenuChannel] = useState<ChannelDTO | null>(null);
  const origin = useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => '',
  );

  const metaReturn = searchParams.get('connect') === 'meta';
  const metaError = searchParams.get('error');

  const load = useCallback(async () => {
    try {
      const [ch, ag] = await Promise.all([
        apiJson<{ channels: ChannelDTO[]; features: ChannelFeatures; accounts?: AccountsPlan }>('/api/channels'),
        apiJson<{ agents: AgentOption[] }>('/api/agents').catch(() => ({ agents: [] as AgentOption[] })),
      ]);
      setChannels(ch.channels);
      setFeatures(ch.features);
      if (ch.accounts) setAccounts(ch.accounts);
      setAgents((ag.agents ?? []).map((a) => ({ id: a.id, name: a.name, enabled: a.enabled })));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (workspace) load();
  }, [workspace, load]);

  // The free plan's limit comes back as the code 'plan_limit'.
  const errorText = (err: unknown) =>
    err instanceof Error ? (err.message === 'plan_limit' ? t('channels.plan.limitError') : err.message) : t('common.error');

  // Free plan: the main account of each service, and what happens to the others.
  const mainIds = mainChannelIds(channels);
  const perType = new Map<string, number>();
  for (const c of channels) perType.set(c.type, (perType.get(c.type) ?? 0) + 1);
  const planFor = (c: ChannelDTO) =>
    accounts.unlimited || (perType.get(c.type) ?? 0) <= 1
      ? null
      : { main: mainIds.has(c.id), disconnectOn: accounts.disconnect_on, disabled: (c.settings as Record<string, unknown> | null)?.plan_disabled === true };
  const disabledCount = accounts.unlimited ? 0 : channels.filter((c) => (c.settings as Record<string, unknown> | null)?.plan_disabled === true).length;
  const hasExtras = !accounts.unlimited && [...perType.values()].some((n) => n > 1);

  const patch = async (id: string, body: Record<string, unknown>, okMsg?: string) => {
    try {
      const { channel } = await apiJson<{ channel: ChannelDTO }>(`/api/channels/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setChannels((list) => list.map((c) => (c.id === id ? channel : c)));
      if (okMsg) toast.success(okMsg);
    } catch (err) {
      toast.error(errorText(err));
      load();
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await apiJson(`/api/channels/${deleting.id}`, { method: 'DELETE' });
      setChannels((list) => list.filter((c) => c.id !== deleting.id));
      toast.success(t('channels.deleted'));
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const clearMetaParams = () => router.replace(pathname, { scroll: false });

  // Back from TikTok's authorization (GET /api/channels/tiktok/oauth/callback).
  const tiktokReturn = searchParams.get('connect') === 'tiktok';
  const tiktokOk = searchParams.get('ok') === '1';
  useEffect(() => {
    if (!tiktokReturn) return;
    if (tiktokOk) toast.success(t('channels.tiktok.connected'));
    else {
      const err = searchParams.get('error');
      const known = ['denied', 'forbidden', 'not_configured', 'state', 'exchange', 'conflict'];
      toast.error(err === 'plan_limit' ? t('channels.plan.limitError') : t(`channels.tiktok.errors.${err && known.includes(err) ? err : 'exchange'}`));
    }
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per return from TikTok
  }, [tiktokReturn]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('channels.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('channels.description')}</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setConnectOpen(true)}>
            <Plus className="size-4" />
            {t('channels.connectButton')}
          </Button>
        )}
      </div>

      {!isAdmin && <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">{t('channels.readOnly')}</p>}

      {hasExtras && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          <p>
            {disabledCount > 0
              ? t('channels.plan.bannerDisabled', { count: disabledCount })
              : accounts.disconnect_on
                ? t('channels.plan.banner', { date: new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PE', { dateStyle: 'long' }).format(new Date(accounts.disconnect_on)) })
                : t('channels.plan.bannerSoon')}
          </p>
          <Link href="/settings?tab=billing" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            {t('channels.plan.subscribe')}
          </Link>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : channels.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Radio className="size-6" />
          </span>
          <h2 className="text-base font-semibold text-foreground">{t('channels.empty.title')}</h2>
          <p className="max-w-md text-sm text-muted-foreground">{t('channels.empty.description')}</p>
          {isAdmin && (
            <Button onClick={() => setConnectOpen(true)}>
              <Plus className="size-4" />
              {t('channels.connectButton')}
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {channels.map((c) => (
              <ChannelCard
                key={c.id}
                channel={c}
                agents={agents}
                isAdmin={isAdmin}
                origin={origin}
                onAgentChange={(agentId) => {
                  setChannels((list) => list.map((x) => (x.id === c.id ? { ...x, ai_agent_id: agentId } : x)));
                  patch(c.id, { ai_agent_id: agentId }, t('channels.agentUpdated'));
                }}
                onEdit={() => setEditing(c)}
                onEditMenu={() => setMenuChannel(c)}
                onToggleStatus={() =>
                  patch(c.id, { status: c.status === 'connected' ? 'disconnected' : 'connected' }, t('channels.saved'))
                }
                onDelete={() => setDeleting(c)}
                plan={planFor(c)}
              />
            ))}
          </div>
          {agents.length === 0 && (
            <div className="flex flex-col items-start gap-2 rounded-md border border-border bg-muted/30 p-4 text-sm sm:flex-row sm:items-center">
              <Bot className="size-4 text-primary" />
              <span className="flex-1 text-muted-foreground">{t('channels.noAgentsYet')}</span>
              <Link href="/agents" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {t('channels.createAgent')}
              </Link>
            </div>
          )}
        </>
      )}

      {isAdmin && (
        <ConnectChannelDialog
          usedTypes={accounts.unlimited ? [] : [...perType.keys()]}
          open={connectOpen}
          onOpenChange={setConnectOpen}
          features={features}
          agents={agents}
          onCreated={load}
        />
      )}

      {isAdmin && metaReturn && (
        <MetaConnectDialog error={metaError} agents={agents} onClose={clearMetaParams} onCreated={load} />
      )}

      {editing && <EditChannelDialog channel={editing} origin={origin} onClose={() => setEditing(null)} onSaved={load} />}

      {menuChannel && (
        <WelcomeMenuDialog
          channel={menuChannel}
          agents={agents}
          readOnly={!isAdmin}
          onClose={() => setMenuChannel(null)}
          onSaved={(saved) => setChannels((list) => list.map((c) => (c.id === saved.id ? saved : c)))}
        />
      )}

      <ConfirmationDialog
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('channels.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('channels.deleteDescription')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="destructive"
        onConfirm={remove}
      />
    </div>
  );
}
