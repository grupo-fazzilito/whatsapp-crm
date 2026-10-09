'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowRightLeft, BookOpenText, Bot, Eye, FlaskConical, Loader2, Plus, Trash2 } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { cn } from '@/lib/utils';
import { CHANNEL_STYLE } from '@/components/channels/channel-types';
import type { ChannelType } from '@/lib/channels/types';
import { CreateAgentDialog } from './create-agent-dialog';
import { AGENT_TONES, transferTargetsOf, type AgentChannelRef, type AiAgent } from './types';

/** PATCH/DELETE an agent; returns the error message, or null when it worked. */
async function agentRequest(url: string, init: RequestInit): Promise<string | null> {
  try {
    const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } });
    if (res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return body.error ?? `HTTP ${res.status}`;
  } catch (err) {
    return err instanceof Error ? err.message : 'error';
  }
}

export function AgentsManager() {
  const t = useT();
  const { can, workspace } = useWorkspace();
  const isAdmin = can('admin');
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [channels, setChannels] = useState<AgentChannelRef[]>([]);
  const [loading, setLoading] = useState(true);
  const search = useSearchParams();
  // /agents?new=1 (from the getting-started checklist) opens the template menu.
  const [creating, setCreating] = useState(() => search.get('new') === '1');
  const [deleting, setDeleting] = useState<AiAgent | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/agents', { cache: 'no-store' }).catch(() => null);
      const body = ((await res?.json().catch(() => null)) ?? {}) as { agents?: AiAgent[]; channels?: AgentChannelRef[]; error?: string };
      if (!res?.ok) toast.error(body.error ?? (res ? `HTTP ${res.status}` : 'Network error'));
      setAgents(body.agents ?? []);
      setChannels(body.channels ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (workspace) load();
  }, [workspace, load]);

  const toggleEnabled = async (agent: AiAgent, enabled: boolean) => {
    setAgents((list) => list.map((a) => (a.id === agent.id ? { ...a, enabled } : a)));
    const error = await agentRequest(`/api/agents/${agent.id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
    if (error) {
      toast.error(error);
      load();
    }
  };

  const remove = async () => {
    if (!deleting) return;
    const error = await agentRequest(`/api/agents/${deleting.id}`, { method: 'DELETE' });
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t('agents.deleted'));
    load();
  };

  const toneLabel = (tone: string) => ((AGENT_TONES as readonly string[]).includes(tone) ? t(`agents.tone.${tone}`) : tone);
  const usedBy = (id: string) => channels.filter((c) => c.ai_agent_id === id);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('agents.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('agents.description')}</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            {t('agents.new')}
          </Button>
        )}
      </div>

      {!isAdmin && <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">{t('agents.readOnly')}</p>}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Bot className="size-6" />
          </span>
          <h2 className="text-base font-semibold text-foreground">{t('agents.empty.title')}</h2>
          <p className="max-w-md text-sm text-muted-foreground">{t('agents.empty.description')}</p>
          {isAdmin && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              {t('agents.new')}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => {
            const used = usedBy(a.id);
            const isRouter = a.skills.includes('router');
            const targets = transferTargetsOf(a, agents);
            return (
              <Card key={a.id} className={cn('flex flex-col', !a.enabled && 'opacity-75')}>
                <CardContent className="flex flex-1 flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden>
                      <Bot className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-foreground">
                        <Link href={`/agents/${a.id}`} className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                          {a.name}
                        </Link>
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {toneLabel(a.tone)} · {t(`agents.language.${a.language}`)}
                      </p>
                    </div>
                    <Switch
                      checked={a.enabled}
                      disabled={!isAdmin}
                      aria-label={t('agents.field.enabled')}
                      onCheckedChange={(v) => toggleEnabled(a, v)}
                    />
                  </div>

                  {(a.description || a.persona) && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">{a.description || a.persona}</p>
                  )}

                  {a.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {a.skills.map((s) => (
                        <Badge key={s} variant="secondary">
                          {t(`agents.skill.${s}`)}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {(isRouter || a.transfer_agent_ids?.length > 0) && (
                    <div className="grid gap-1.5">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <ArrowRightLeft className="size-3.5" />
                        {isRouter ? t('routing.agent.routesTo') : t('routing.agent.transfersTo')}
                      </span>
                      {targets.length === 0 ? (
                        <span className="text-xs text-muted-foreground">{t('routing.agent.noTargets')}</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {isRouter && !a.transfer_agent_ids?.length && (
                            <span className="text-xs text-muted-foreground">{t('routing.agent.allAgents')}:</span>
                          )}
                          {targets.map((x) => (
                            <span key={x.id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                              <Bot className="size-3" />
                              {x.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-auto grid gap-1.5 border-t border-border pt-3">
                    <span className="text-xs font-medium text-muted-foreground">{t('agents.usedBy')}</span>
                    {used.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {t('agents.notUsed')}{' '}
                        <Link href="/channels" className="text-primary underline-offset-2 hover:underline">
                          {t('agents.assignInChannels')}
                        </Link>
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {used.map((c) => {
                          const style = CHANNEL_STYLE[c.type as ChannelType];
                          return (
                            <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-foreground">
                              {style && (
                                <span className={cn('flex size-4 items-center justify-center rounded-full', style.tile)}>
                                  <style.icon className="size-2.5" />
                                </span>
                              )}
                              {c.name}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-1">
                    {isAdmin ? (
                      <>
                        <Link href={`/agents/${a.id}?tab=training`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                          <BookOpenText className="size-3.5" />
                          {t('agents.page.tabs.training')}
                        </Link>
                        <Link href={`/agents/${a.id}?tab=test`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                          <FlaskConical className="size-3.5" />
                          {t('agents.page.tabs.test')}
                        </Link>
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleting(a)}>
                          <Trash2 className="size-3.5" />
                          {t('common.delete')}
                        </Button>
                      </>
                    ) : (
                      <Link href={`/agents/${a.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                        <Eye className="size-3.5" />
                        {t('agents.view')}
                      </Link>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreateAgentDialog open={creating} onOpenChange={setCreating} />

      <ConfirmationDialog
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('agents.deleteTitle', { name: deleting?.name ?? '' })}
        description={
          deleting && usedBy(deleting.id).length > 0
            ? t('agents.deleteDescriptionUsed', { count: usedBy(deleting.id).length })
            : t('agents.deleteDescription')
        }
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="destructive"
        onConfirm={remove}
      />
    </div>
  );
}
