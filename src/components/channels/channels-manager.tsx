'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Bot, Loader2, Plus, Radio } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { createClient } from '@/lib/supabase/client';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { apiJson, type AgentOption, type ChannelDTO, type ChannelFeatures } from './channel-types';
import { ChannelCard } from './channel-card';
import { ConnectChannelDialog } from './connect-channel-dialog';
import { EditChannelDialog } from './edit-channel-dialog';
import { MetaConnectDialog } from './meta-connect-dialog';
import { WelcomeMenuDialog } from './welcome-menu-dialog';

const noopSubscribe = () => () => {};

const NO_FEATURES: ChannelFeatures = { metaOAuth: false, tiktok: false, platformVerifyToken: false };

export function ChannelsManager() {
  const t = useT();
  const { can, workspace } = useWorkspace();
  const isAdmin = can('admin');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [channels, setChannels] = useState<ChannelDTO[]>([]);
  const [features, setFeatures] = useState<ChannelFeatures>(NO_FEATURES);
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
        apiJson<{ channels: ChannelDTO[]; features: ChannelFeatures }>('/api/channels'),
        createClient().from('ai_agents').select('id, name, enabled').order('created_at', { ascending: true }),
      ]);
      setChannels(ch.channels);
      setFeatures(ch.features);
      setAgents((ag.data as AgentOption[]) ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (workspace) load();
  }, [workspace, load]);

  const patch = async (id: string, body: Record<string, unknown>, okMsg?: string) => {
    try {
      const { channel } = await apiJson<{ channel: ChannelDTO }>(`/api/channels/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setChannels((list) => list.map((c) => (c.id === id ? channel : c)));
      if (okMsg) toast.success(okMsg);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
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
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  };

  const clearMetaParams = () => router.replace(pathname, { scroll: false });

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
