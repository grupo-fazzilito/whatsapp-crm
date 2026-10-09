'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, BookOpenText, Bot, FlaskConical, Loader2, Pencil, Settings2 } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { CHANNEL_STYLE } from '@/components/channels/channel-types';
import type { ChannelType } from '@/lib/channels/types';
import { AGENT_TEMPLATES } from '@/lib/agents/templates';
import { AgentEditor } from './agent-editor';
import { AgentTraining } from './agent-training';
import { AgentTestChat } from './agent-test-chat';
import { AGENT_TONES, type AiAgent } from './types';

const TABS = ['training', 'test', 'settings'] as const;
type Tab = (typeof TABS)[number];

interface ChannelRef {
  id: string;
  name: string;
  type: string;
  display_handle: string | null;
}

/** One agent: training, test chat (per channel) and settings. */
export function AgentWorkspace({ agentId }: { agentId: string }) {
  const { t, locale } = useI18n();
  const { can, workspace } = useWorkspace();
  const isAdmin = can('admin');
  const router = useRouter();
  const search = useSearchParams();
  const [agent, setAgent] = useState<AiAgent | null>(null);
  const [all, setAll] = useState<AiAgent[]>([]);
  const [channels, setChannels] = useState<ChannelRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const q = search.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(q ?? '') ? (q as Tab) : 'training';
  const setTab = (next: Tab) => {
    const p = new URLSearchParams(search.toString());
    p.set('tab', next);
    router.replace(`/agents/${agentId}?${p.toString()}`, { scroll: false });
  };
  const template = AGENT_TEMPLATES.find((x) => x.key === search.get('template'));
  const trainingExample = template?.text[locale === 'en' ? 'en' : 'es'].training || undefined;

  const load = useCallback(async () => {
    const [one, list] = await Promise.all([
      fetch(`/api/agents/${agentId}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/agents', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null]);
    setAgent((one?.agent as AiAgent) ?? null);
    setChannels((one?.channels as ChannelRef[]) ?? []);
    setAll((list?.agents as AiAgent[]) ?? []);
    setLoading(false);
  }, [agentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    if (workspace) void load();
  }, [workspace, load]);

  const toggle = async (enabled: boolean) => {
    if (!agent) return;
    setAgent({ ...agent, enabled });
    const res = await fetch(`/api/agents/${agent.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
    if (!res.ok) void load();
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16" role="status">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t('common.loading')} />
      </div>
    );
  }
  if (!agent) {
    return (
      <div className="space-y-4">
        <Link href="/agents" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> {t('agents.page.back')}
        </Link>
        <p className="text-sm text-muted-foreground">{t('agents.page.notFound')}</p>
      </div>
    );
  }

  const toneLabel = (AGENT_TONES as readonly string[]).includes(agent.tone) ? t(`agents.tone.${agent.tone}`) : agent.tone;

  return (
    <div className="space-y-6">
      <Link href="/agents" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
        <ArrowLeft className="size-4" aria-hidden /> {t('agents.page.back')}
      </Link>

      <div className="flex flex-wrap items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden>
          <Bot className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold text-foreground">{agent.name}</h1>
          <p className="text-sm text-muted-foreground">
            {toneLabel} · {t(`agents.language.${agent.language}`)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {agent.skills.map((s) => (
              <Badge key={s} variant="secondary">
                {t(`agents.skill.${s}`)}
              </Badge>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Switch checked={agent.enabled} disabled={!isAdmin} onCheckedChange={toggle} />
          {t('agents.field.enabled')}
        </label>
      </div>

      {!agent.enabled && <p className="rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{t('agents.page.disabled')}</p>}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="h-10 w-fit max-w-full gap-1 overflow-x-auto">
          <TabsTrigger value="training">
            <BookOpenText className="size-4" aria-hidden /> {t('agents.page.tabs.training')}
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="test">
              <FlaskConical className="size-4" aria-hidden /> {t('agents.page.tabs.test')}
            </TabsTrigger>
          )}
          <TabsTrigger value="settings">
            <Settings2 className="size-4" aria-hidden /> {t('agents.page.tabs.settings')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="training" className="mt-6">
          <AgentTraining key={agent.id + (agent.updated_at ?? '')} agent={agent} readOnly={!isAdmin} placeholder={trainingExample} onSaved={setAgent} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="test" className="mt-6">
            <AgentTestChat agent={agent} />
          </TabsContent>
        )}

        <TabsContent value="settings" className="mt-6 space-y-6">
          <section className="grid gap-4 rounded-xl border border-border p-5 sm:grid-cols-2">
            {[
              [t('agents.field.description'), agent.description],
              [t('agents.field.persona'), agent.persona],
              [t('agents.field.instructions'), agent.instructions],
              [t('agents.field.greeting'), agent.greeting_message],
            ].map(([label, value]) => (
              <div key={label as string}>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm text-foreground">{(value as string | null) || '—'}</p>
              </div>
            ))}
            <div className="sm:col-span-2">
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden />
                {isAdmin ? t('agents.page.configure') : t('agents.view')}
              </Button>
            </div>
          </section>

          <section className="rounded-xl border border-border p-5">
            <h2 className="text-sm font-semibold text-foreground">{t('agents.page.channels')}</h2>
            {channels.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {t('agents.page.noChannels')}{' '}
                <Link href="/channels" className="text-primary underline-offset-2 hover:underline">
                  {t('agents.page.assign')}
                </Link>
              </p>
            ) : (
              <ul className="mt-3 flex flex-wrap gap-2">
                {channels.map((c) => {
                  const style = CHANNEL_STYLE[c.type as ChannelType];
                  return (
                    <li key={c.id} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm text-foreground">
                      {style && (
                        <span className={cn('flex size-5 items-center justify-center rounded-full', style.tile)} aria-hidden>
                          <style.icon className="size-3" />
                        </span>
                      )}
                      {c.name}
                      {c.display_handle && <span className="text-xs text-muted-foreground">{c.display_handle}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </TabsContent>
      </Tabs>

      {editing && (
        <AgentEditor
          agent={agent}
          allAgents={all}
          readOnly={!isAdmin}
          onClose={() => setEditing(false)}
          onSaved={(a) => {
            setAgent({ ...a, training_context: a.training_context ?? agent.training_context });
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}
