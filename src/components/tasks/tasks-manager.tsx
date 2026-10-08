'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Check, CheckCircle2, ListTodo, Loader2, MessageSquare, Plus, RotateCcw, Search, User } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, LoadingBlock, PageHeader, selectClass } from '@/components/business/shared';
import { cn } from '@/lib/utils';
import {
  TASK_SELECT,
  TASK_VIEWS,
  groupByDue,
  inView,
  presetDue,
  type DuePreset,
  type TaskRow,
  type TaskView,
} from '@/lib/crm/tasks';
import { useMembers } from '@/components/crm/use-members';
import { CompleteTaskDialog } from './complete-task-dialog';
import { TaskSheet } from './task-sheet';
import { DueBadge, PriorityChip } from './task-ui';

type Scope = 'mine' | 'all';
const OPEN_LIMIT = 500;
const DONE_LIMIT = 100;
const SCOPE_KEY = 'tasks:scope';
const QUICK_PRESETS: DuePreset[] = ['today', 'tomorrow', 'next_week', 'none'];

const cleanSearch = (s: string) => s.trim().toLocaleLowerCase();

export function TasksManager() {
  const { t, locale } = useI18n();
  const { workspace, can } = useWorkspace();
  const { members, meId, loading: membersLoading } = useMembers();
  const isAdmin = can('admin');
  const wsId = workspace?.id;

  const [scope, setScope] = useState<Scope>('mine');
  const [view, setView] = useState<TaskView>('open');
  const [open, setOpen] = useState<TaskRow[] | null>(null);
  const [done, setDone] = useState<TaskRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [completing, setCompleting] = useState<TaskRow | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Quick add
  const [newTitle, setNewTitle] = useState('');
  const [newDue, setNewDue] = useState<DuePreset>('today');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (window.localStorage.getItem(SCOPE_KEY) === 'all') setScope('all');
    } catch {
      /* storage blocked */
    }
    const id = new URLSearchParams(window.location.search).get('task');
    if (id) setSelected(id);
    // Re-evaluate overdue / today every minute.
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const effectiveScope: Scope = isAdmin ? scope : 'mine';
  const changeScope = (s: Scope) => {
    setScope(s);
    try {
      window.localStorage.setItem(SCOPE_KEY, s);
    } catch {
      /* storage blocked */
    }
  };

  const openTask = useCallback((id: string | null) => {
    setSelected(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('task', id);
    else url.searchParams.delete('task');
    window.history.replaceState(null, '', url);
  }, []);

  const load = useCallback(async () => {
    if (!wsId || (effectiveScope === 'mine' && !meId)) return;
    const db = createClient();
    let qOpen = db.from('tasks').select(TASK_SELECT).eq('workspace_id', wsId).eq('status', 'open');
    if (effectiveScope === 'mine') qOpen = qOpen.eq('assignee_user_id', meId!);
    const { data, error } = await qOpen.order('due_at', { ascending: true, nullsFirst: false }).limit(OPEN_LIMIT);
    if (error) {
      toast.error(error.message);
      setOpen([]);
    } else setOpen((data ?? []) as TaskRow[]);

    if (view === 'done') {
      let qDone = db.from('tasks').select(TASK_SELECT).eq('workspace_id', wsId).eq('status', 'done');
      if (effectiveScope === 'mine') qDone = qDone.eq('assignee_user_id', meId!);
      const res = await qDone.order('completed_at', { ascending: false }).limit(DONE_LIMIT);
      setDone((res.data ?? []) as TaskRow[]);
    }
  }, [wsId, effectiveScope, meId, view]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Realtime: any task change in the workspace refreshes the list.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    if (!wsId) return;
    const db = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = db
      .channel(`tasks-page:${wsId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `workspace_id=eq.${wsId}` }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => loadRef.current(), 400);
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      db.removeChannel(channel);
    };
  }, [wsId]);

  const matches = useCallback(
    (task: TaskRow) => {
      const s = cleanSearch(query);
      if (!s) return true;
      return [task.title, task.description, task.contact?.name, task.contact?.phone, task.deal?.title].some((v) => v?.toLocaleLowerCase().includes(s));
    },
    [query],
  );

  const counts = useMemo(() => {
    const c: Record<TaskView, number> = { open: 0, overdue: 0, today: 0, upcoming: 0, done: 0 };
    for (const task of open ?? []) for (const v of TASK_VIEWS) if (v !== 'done' && inView(task, v, now)) c[v]++;
    return c;
  }, [open, now]);

  const visible = useMemo(() => {
    if (view === 'done') return (done ?? []).filter(matches);
    return (open ?? []).filter((task) => inView(task, view, now) && matches(task));
  }, [view, open, done, now, matches]);
  const groups = useMemo(() => (view === 'done' ? [] : groupByDue(visible, now)), [view, visible, now]);

  const memberName = (uid: string | null) => (uid ? members.find((m) => m.userId === uid)?.name ?? '—' : t('crm.tasks.unassigned'));

  const quickAdd = async () => {
    if (!wsId || !newTitle.trim()) return;
    setAdding(true);
    const { error } = await createClient()
      .from('tasks')
      .insert({
        workspace_id: wsId,
        title: newTitle.trim().slice(0, 300),
        due_at: presetDue(newDue)?.toISOString() ?? null,
        assignee_user_id: meId,
      });
    setAdding(false);
    if (error) {
      toast.error(t('crm.tasks.errors.createFailed'));
      return;
    }
    setNewTitle('');
    toast.success(t('crm.tasks.toast.created'));
    load();
  };

  const reopen = async (task: TaskRow) => {
    const { error } = await createClient().from('tasks').update({ status: 'open', result: null }).eq('id', task.id).eq('workspace_id', task.workspace_id);
    if (error) toast.error(t('crm.tasks.errors.saveFailed'));
    else toast.success(t('crm.tasks.toast.reopened'));
    load();
  };

  const dateTime = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const loading = open === null || (view === 'done' && done === null) || (membersLoading && !meId);

  const renderTask = (task: TaskRow) => {
    const isDone = task.status === 'done';
    return (
      <li key={task.id} className="flex items-start gap-3 rounded-xl border border-border bg-card p-3">
        {isDone ? (
          <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-400" />
        ) : (
          <button
            type="button"
            onClick={() => setCompleting(task)}
            aria-label={t('crm.tasks.actions.completeFor', { title: task.title })}
            className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/50 text-transparent transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Check className="size-3.5" />
          </button>
        )}
        <div className="grid min-w-0 flex-1 gap-1">
          <button
            type="button"
            onClick={() => openTask(task.id)}
            className={cn(
              'text-left text-sm font-medium break-words hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isDone && 'text-muted-foreground line-through',
            )}
          >
            {task.title}
          </button>
          {isDone && task.result && <p className="line-clamp-2 text-xs text-muted-foreground">{task.result}</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {isDone ? (
              task.completed_at && (
                <span className="text-xs text-muted-foreground">{t('crm.tasks.doneAt', { date: dateTime.format(new Date(task.completed_at)) })}</span>
              )
            ) : (
              <DueBadge dueAt={task.due_at} />
            )}
            <PriorityChip priority={task.priority} />
            {task.contact && (
              <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <User aria-hidden className="size-3.5" />
                <span className="truncate">{task.contact.name || task.contact.phone}</span>
              </span>
            )}
            {task.deal && <span className="truncate text-xs text-muted-foreground">{t('crm.tasks.dealLabel', { title: task.deal.title })}</span>}
            {effectiveScope === 'all' && <span className="text-xs text-muted-foreground">{t('crm.tasks.assignedTo', { name: memberName(task.assignee_user_id) })}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {task.conversation_id && (
            <Link
              href={`/inbox?c=${task.conversation_id}`}
              aria-label={t('crm.tasks.openChatFor', { title: task.title })}
              title={t('crm.tasks.openChat')}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MessageSquare className="size-4" />
            </Link>
          )}
          {isDone && (
            <Button type="button" variant="ghost" size="icon" onClick={() => reopen(task)} aria-label={t('crm.tasks.actions.reopenFor', { title: task.title })}>
              <RotateCcw className="size-4" />
            </Button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('crm.tasks.title')}
        description={t('crm.tasks.description')}
        actions={
          isAdmin ? (
            <div role="group" aria-label={t('crm.tasks.scope.label')} className="inline-flex rounded-lg border border-border p-0.5">
              {(['mine', 'all'] as Scope[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={effectiveScope === s}
                  onClick={() => changeScope(s)}
                  className={cn(
                    'inline-flex h-8 items-center rounded-md px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    effectiveScope === s ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(`crm.tasks.scope.${s}`)}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />

      {/* Quick add */}
      <form
        className="grid gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          quickAdd();
        }}
      >
        <label className="sr-only" htmlFor="quick-task-title">
          {t('crm.tasks.quick.label')}
        </label>
        <Input
          id="quick-task-title"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder={t('crm.tasks.quick.placeholder')}
          maxLength={300}
          className="h-9"
        />
        <label className="sr-only" htmlFor="quick-task-due">
          {t('crm.tasks.fields.due')}
        </label>
        <select id="quick-task-due" className={cn(selectClass, 'sm:w-40')} value={newDue} onChange={(e) => setNewDue(e.target.value as DuePreset)}>
          {QUICK_PRESETS.map((p) => (
            <option key={p} value={p}>
              {t(`crm.tasks.presets.${p}`)}
            </option>
          ))}
        </select>
        <Button type="submit" size="lg" disabled={adding || !newTitle.trim() || !meId}>
          {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {t('crm.tasks.quick.add')}
        </Button>
      </form>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label={t('crm.tasks.views.label')} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {TASK_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                view === v ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`crm.tasks.views.${v}`)}
              {v !== 'done' && counts[v] > 0 && (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[11px] font-semibold leading-4 tabular-nums',
                    v === 'overdue' ? 'bg-red-600 text-white' : 'bg-muted text-foreground',
                  )}
                >
                  {counts[v]}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('crm.tasks.search')}
            aria-label={t('crm.tasks.search')}
            className="h-9 pl-8"
          />
        </div>
      </div>

      {loading ? (
        <LoadingBlock />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<ListTodo className="size-5" />}
          title={query ? t('crm.tasks.empty.filtered') : t(`crm.tasks.empty.${view}`)}
          description={!query && view === 'open' ? t('crm.tasks.empty.hint') : undefined}
        />
      ) : view === 'done' ? (
        <ul className="grid gap-2">{visible.map(renderTask)}</ul>
      ) : (
        <div className="grid gap-5">
          {groups.map((g) => (
            <section key={g.bucket} aria-labelledby={`tasks-group-${g.bucket}`} className="grid gap-2">
              <h2
                id={`tasks-group-${g.bucket}`}
                className={cn(
                  'flex items-center gap-2 text-xs font-semibold uppercase tracking-wide',
                  g.bucket === 'overdue' ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground',
                )}
              >
                {t(`crm.tasks.groups.${g.bucket}`)}
                <span className="tabular-nums">({g.tasks.length})</span>
              </h2>
              <ul className="grid gap-2">{g.tasks.map(renderTask)}</ul>
            </section>
          ))}
        </div>
      )}

      <TaskSheet taskId={selected} onOpenChange={(o) => !o && openTask(null)} onChanged={load} />
      <CompleteTaskDialog task={completing} onOpenChange={(o) => !o && setCompleting(null)} onCompleted={() => load()} />
    </div>
  );
}
