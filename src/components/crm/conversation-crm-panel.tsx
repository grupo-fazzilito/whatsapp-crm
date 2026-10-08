'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ExternalLink, Handshake, ListTodo, Loader2, Plus, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { createClient } from '@/lib/supabase/client';
import { formatMoney, moneyLocale } from '@/lib/workspace/countries';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CRM_CHANGED_EVENT, TASK_SELECT, sortTasks, type TaskRow } from '@/lib/crm/tasks';
import { CompleteTaskDialog } from '@/components/tasks/complete-task-dialog';
import { DueBadge, PriorityChip } from '@/components/tasks/task-ui';
import { CloseDealDialog, type CloseStatus } from './close-deal-dialog';
import { CreateDealDialog } from './create-deal-dialog';
import { CreateTaskDialog } from './create-task-dialog';

interface PanelDeal {
  id: string;
  title: string;
  value: number;
  currency: string | null;
  stage: { name: string; color: string } | null;
  pipeline: { name: string } | null;
}

export interface ConversationCrmPanelProps {
  conversationId?: string | null;
  contactId: string | null | undefined;
  /** Prefills the deal title (fetched when omitted). */
  contactName?: string | null;
  className?: string;
}

const MAX_ROWS = 20;

/**
 * Compact CRM block for the inbox's conversation sidebar: the contact's open
 * deals (won / lost quick actions) and open tasks (complete in one click),
 * plus "+ Negocio" / "+ Tarea".
 */
export function ConversationCrmPanel({ conversationId, contactId, contactName, className }: ConversationCrmPanelProps) {
  const { t, locale } = useI18n();
  const { workspace } = useWorkspace();
  const wsId = workspace?.id;
  const [deals, setDeals] = useState<PanelDeal[] | null>(null);
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [dealOpen, setDealOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskForDeal, setTaskForDeal] = useState<string | null>(null);
  const [closing, setClosing] = useState<{ deal: PanelDeal; status: CloseStatus } | null>(null);
  const [completing, setCompleting] = useState<TaskRow | null>(null);

  const load = useCallback(async () => {
    if (!wsId || !contactId) return;
    const db = createClient();
    const [d, tk] = await Promise.all([
      db
        .from('deals')
        .select('id, title, value, currency, stage:pipeline_stages(name, color), pipeline:pipelines(name)')
        .eq('workspace_id', wsId)
        .eq('contact_id', contactId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS),
      db.from('tasks').select(TASK_SELECT).eq('workspace_id', wsId).eq('contact_id', contactId).eq('status', 'open').limit(MAX_ROWS),
    ]);
    setDeals((d.data ?? []) as unknown as PanelDeal[]);
    setTasks(sortTasks((tk.data ?? []) as TaskRow[]));
  }, [wsId, contactId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeals(null);
    setTasks(null);
    load();
  }, [load]);

  // Live task updates (someone completes / adds a task for this contact).
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    // Deals / tasks created from other CRM widgets on the page (e.g. a header "Crear negocio" button).
    const onChange = () => loadRef.current();
    window.addEventListener(CRM_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CRM_CHANGED_EVENT, onChange);
  }, []);
  useEffect(() => {
    if (!wsId || !contactId) return;
    const db = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = db
      .channel(`crm-panel:${contactId}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `contact_id=eq.${contactId}` }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => loadRef.current(), 300);
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      db.removeChannel(channel);
    };
  }, [wsId, contactId]);

  if (!contactId) return null;

  const money = (n: number, cur: string | null) =>
    formatMoney(Number(n || 0), cur || workspace?.currency || 'USD', moneyLocale({ locale, country: workspace?.country }));

  const sectionTitle = 'flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground';

  return (
    <div className={cn('grid gap-4 text-sm', className)}>
      {/* Deals */}
      <section aria-labelledby={`crm-deals-${contactId}`} className="grid gap-2">
        <div className={sectionTitle}>
          <h3 id={`crm-deals-${contactId}`} className="flex items-center gap-1.5">
            <Handshake aria-hidden className="size-3.5" />
            {t('crm.panel.deals')}
            {deals && deals.length > 0 && <span className="tabular-nums">({deals.length})</span>}
          </h3>
          <Button type="button" variant="ghost" size="xs" onClick={() => setDealOpen(true)} aria-label={t('crm.deals.create.button')}>
            <Plus className="size-3" />
            {t('crm.panel.add')}
          </Button>
        </div>
        {deals === null ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={t('crm.common.loading')} />
        ) : deals.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('crm.panel.noDeals')}</p>
        ) : (
          <ul className="grid gap-1.5">
            {deals.map((d) => (
              <li key={d.id} className="grid gap-1 rounded-lg border border-border bg-card p-2">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/pipelines?deal=${d.id}`}
                    className="min-w-0 flex-1 truncate font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={d.title}
                  >
                    {d.title}
                  </Link>
                  <span className="shrink-0 font-semibold tabular-nums">{money(d.value, d.currency)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: d.stage?.color ?? '#94a3b8' }} />
                    <span className="truncate">
                      {d.stage?.name ?? '—'}
                      {d.pipeline?.name ? ` · ${d.pipeline.name}` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => {
                        setTaskForDeal(d.id);
                        setTaskOpen(true);
                      }}
                      aria-label={t('crm.panel.taskForDeal', { title: d.title })}
                      title={t('crm.tasks.create.button')}
                    >
                      <ListTodo />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="text-emerald-700 hover:text-emerald-800 dark:text-emerald-400"
                      onClick={() => setClosing({ deal: d, status: 'won' })}
                      aria-label={t('crm.deals.actions.wonFor', { title: d.title })}
                      title={t('crm.deals.actions.won')}
                    >
                      <ThumbsUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="text-red-700 hover:text-red-800 dark:text-red-400"
                      onClick={() => setClosing({ deal: d, status: 'lost' })}
                      aria-label={t('crm.deals.actions.lostFor', { title: d.title })}
                      title={t('crm.deals.actions.lost')}
                    >
                      <ThumbsDown />
                    </Button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Tasks */}
      <section aria-labelledby={`crm-tasks-${contactId}`} className="grid gap-2">
        <div className={sectionTitle}>
          <h3 id={`crm-tasks-${contactId}`} className="flex items-center gap-1.5">
            <ListTodo aria-hidden className="size-3.5" />
            {t('crm.panel.tasks')}
            {tasks && tasks.length > 0 && <span className="tabular-nums">({tasks.length})</span>}
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              setTaskForDeal(null);
              setTaskOpen(true);
            }}
            aria-label={t('crm.tasks.create.button')}
          >
            <Plus className="size-3" />
            {t('crm.panel.add')}
          </Button>
        </div>
        {tasks === null ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={t('crm.common.loading')} />
        ) : tasks.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('crm.panel.noTasks')}</p>
        ) : (
          <ul className="grid gap-1.5">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-start gap-2 rounded-lg border border-border bg-card p-2">
                <button
                  type="button"
                  onClick={() => setCompleting(task)}
                  aria-label={t('crm.tasks.actions.completeFor', { title: task.title })}
                  className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-muted-foreground/50 text-transparent hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Check className="size-3" />
                </button>
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <Link
                    href={`/tasks?task=${task.id}`}
                    className="line-clamp-2 break-words hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {task.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <DueBadge dueAt={task.due_at} />
                    <PriorityChip priority={task.priority} />
                    {task.deal && <span className="truncate text-xs text-muted-foreground">· {task.deal.title}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link href="/tasks" className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline">
          {t('crm.panel.allTasks')}
          <ExternalLink aria-hidden className="size-3" />
        </Link>
      </section>

      <CreateDealDialog
        open={dealOpen}
        onOpenChange={setDealOpen}
        conversationId={conversationId}
        contactId={contactId}
        contactName={contactName}
      />
      <CreateTaskDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        conversationId={conversationId}
        contactId={contactId}
        dealId={taskForDeal}
      />
      <CloseDealDialog
        deal={closing?.deal ?? null}
        status={closing?.status ?? null}
        onOpenChange={(o) => !o && setClosing(null)}
        onDone={() => undefined}
      />
      <CompleteTaskDialog task={completing} onOpenChange={(o) => !o && setCompleting(null)} onCompleted={() => undefined} />
    </div>
  );
}
