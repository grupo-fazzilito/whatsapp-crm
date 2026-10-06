'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { History, Loader2, RotateCcw } from 'lucide-react';
import { useI18n, useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { EmptyState, INTENTS, LoadingBlock, PageHeader, selectClass, type AgentRef } from '../shared';

const PAGE = 50;

interface LogRow {
  id: string;
  created_at: string;
  user_message: string | null;
  ai_response: string | null;
  detected_intent: string | null;
  confidence_score: number | null;
  conversation_id: string | null;
  contact: { name: string | null; phone: string | null } | null;
  agent: { name: string } | null;
  channel: { name: string; type: string } | null;
}

const INTENT_STYLE: Record<string, string> = {
  handover: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  emergency: 'bg-destructive/10 text-destructive',
  booking: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  cancel_booking: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
  transfer: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
};

export function AiLogs() {
  const t = useT();
  const { locale } = useI18n();
  const { workspace } = useWorkspace();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [agents, setAgents] = useState<AgentRef[]>([]);
  const [filters, setFilters] = useState({ agent: '', intent: '', from: '', to: '' });
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (offset: number) => {
      let q = createClient()
        .from('ai_chat_logs')
        .select(
          'id, created_at, user_message, ai_response, detected_intent, confidence_score, conversation_id, contact:contacts(name, phone), agent:ai_agents(name), channel:channels(name, type)',
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (filters.agent) q = q.eq('ai_agent_id', filters.agent);
      if (filters.intent) q = q.eq('detected_intent', filters.intent);
      // Date filters use the viewer's local day boundaries.
      if (filters.from) q = q.gte('created_at', new Date(`${filters.from}T00:00:00`).toISOString());
      if (filters.to) q = q.lt('created_at', new Date(new Date(`${filters.to}T00:00:00`).getTime() + 86_400_000).toISOString());
      const { data, error } = await q;
      if (error) toast.error(error.message);
      return (data as unknown as LogRow[]) ?? [];
    },
    [filters],
  );

  useEffect(() => {
    if (!workspace) return;
    let alive = true;
    fetchPage(0).then((list) => {
      if (!alive) return;
      setRows(list);
      setHasMore(list.length === PAGE);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [workspace, fetchPage]);

  useEffect(() => {
    if (!workspace) return;
    createClient()
      .from('ai_agents')
      .select('id, name')
      .order('created_at', { ascending: true })
      .then(({ data }) => setAgents((data as AgentRef[]) ?? []));
  }, [workspace]);

  const loadMore = async () => {
    setMore(true);
    const list = await fetchPage(rows.length);
    setRows((r) => [...r, ...list]);
    setHasMore(list.length === PAGE);
    setMore(false);
  };

  const setFilter = (k: keyof typeof filters, v: string) => {
    setLoading(true);
    setFilters((f) => ({ ...f, [k]: v }));
  };
  const filtered = filters.agent || filters.intent || filters.from || filters.to;
  const fmt = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
  const intentLabel = (i: string | null) => (i ? ((INTENTS as readonly string[]).includes(i) ? t(`business.intent.${i}`) : i) : '—');

  return (
    <div className="space-y-6">
      <PageHeader title={t('business.logs.title')} description={t('business.logs.description')} />

      <Card>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="lg-agent">{t('business.logs.agent')}</Label>
            <select id="lg-agent" className={selectClass} value={filters.agent} onChange={(e) => setFilter('agent', e.target.value)}>
              <option value="">{t('business.logs.allAgents')}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lg-intent">{t('business.logs.intent')}</Label>
            <select id="lg-intent" className={selectClass} value={filters.intent} onChange={(e) => setFilter('intent', e.target.value)}>
              <option value="">{t('business.logs.allIntents')}</option>
              {INTENTS.map((i) => (
                <option key={i} value={i}>
                  {t(`business.intent.${i}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lg-from">{t('business.logs.from')}</Label>
            <Input id="lg-from" type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lg-to">{t('business.logs.to')}</Label>
            <Input id="lg-to" type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
          </div>
          <Button variant="outline" disabled={!filtered} onClick={() => {
              setLoading(true);
              setFilters({ agent: '', intent: '', from: '', to: '' });
            }}>
            <RotateCcw className="size-4" />
            {t('business.logs.reset')}
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<History className="size-6" />}
          title={filtered ? t('business.common.noResults') : t('business.logs.emptyTitle')}
          description={filtered ? undefined : t('business.logs.emptyDescription')}
        />
      ) : (
        <div className="grid gap-2">
          {rows.map((r) => {
            const open = expanded === r.id;
            const who = r.contact?.name || r.contact?.phone || t('business.logs.unknownContact');
            return (
              <Card key={r.id} className="py-0">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : r.id)}
                  className="grid w-full gap-1 px-4 py-3 text-left"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="tabular-nums">{fmt(r.created_at)}</span>
                    <span className="font-medium text-foreground">{who}</span>
                    {r.agent && <span>· {r.agent.name}</span>}
                    {r.channel && <span>· {r.channel.name}</span>}
                    <span className="ml-auto flex items-center gap-2">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 font-medium',
                          INTENT_STYLE[r.detected_intent ?? ''] ?? 'bg-muted text-muted-foreground',
                        )}
                      >
                        {intentLabel(r.detected_intent)}
                      </span>
                      {r.confidence_score != null && (
                        <span className="tabular-nums" title={t('business.logs.confidence')}>
                          {Math.round(Number(r.confidence_score) * 100)}%
                        </span>
                      )}
                    </span>
                  </div>
                  <p className={cn('text-sm text-foreground', !open && 'line-clamp-1')}>
                    <span className="text-muted-foreground">{t('business.logs.customerSaid')}: </span>
                    {r.user_message || '—'}
                  </p>
                  <p className={cn('text-sm text-foreground', !open && 'line-clamp-1')}>
                    <span className="text-muted-foreground">{t('business.logs.aiReplied')}: </span>
                    {r.ai_response || '—'}
                  </p>
                </button>
                {open && r.conversation_id && (
                  <div className="border-t border-border px-4 py-2">
                    <Link href={`/inbox?c=${r.conversation_id}`} className="text-xs text-primary underline-offset-2 hover:underline">
                      {t('business.logs.openConversation')}
                    </Link>
                  </div>
                )}
              </Card>
            );
          })}
          {hasMore && (
            <Button variant="outline" className="justify-self-center" onClick={loadMore} disabled={more}>
              {more && <Loader2 className="size-4 animate-spin" />}
              {t('business.logs.loadMore')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
